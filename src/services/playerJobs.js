import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { classifyError, errorCode } from '../utils/errors.js';
import { normalizeWire, toWire } from './transferState.js';

/**
 * Voice-only second bot — the hand-off between the two bots (one database, two processes).
 *
 *   PRIMARY (owns every slash command and panel)         SECONDARY (BOT_ROLE=secondary, no commands at all)
 *   ─────────────────────────────────────────────         ──────────────────────────────────────────────────
 *   member asks for a recitation, the primary is          polls PlayerJob every 1.5s, claims a job atomically,
 *   busy in another room → dispatchJob() + waitForJob()   joins the member's room, starts the recitation, posts ITS
 *   and tells the member what happened                    OWN panel (its buttons are answered by the secondary)
 *
 * Nothing here trusts the database blindly: the worker re-checks everything with Discord itself (it is in that server, the room is a
 * normal voice room, the member who asked is really in it, the bot may join and speak) and never runs a job older than JOB_MAX_AGE_MS.
 * Pure helpers are exported for tests; everything that touches Discord / the session manager goes through `deps`.
 */

export const JOB_MAX_AGE_MS = 45_000;
const POLL_MS        = 1_500;
const WAIT_MS        = 25_000;
const WAIT_STEP_MS   = 500;
const SNOWFLAKE      = /^\d{17,20}$/;

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Validate/clean an intent coming from anywhere (a command, or a database document). Unknown or malformed → plain "join". */
export function normalizeIntent(raw) {
  const kind = raw?.kind;
  if (kind === 'recite') {
    const surah = raw.surah === null || raw.surah === undefined ? null : Number(raw.surah);
    if (surah !== null && !(Number.isInteger(surah) && surah >= 1 && surah <= 114)) return { kind: 'join' };
    return { kind, surah, reciter: text(raw.reciter, 120), reciterId: text(String(raw.reciterId ?? ''), 20) };
  }
  if (kind === 'live') {
    const station = text(raw.station, 300);
    return station ? { kind, station } : { kind: 'join' };
  }
  if (kind === 'move') return raw.requireEmpty === true ? { kind, requireEmpty: true } : { kind };                         // the worker moves ITS OWN session to the member's room
  if (kind === 'resume') {                                      // the worker joins and continues a copy of another bot's session
    const state = normalizeWire(raw.state);
    return state ? { kind, state } : { kind: 'join' };
  }
  return { kind: 'join' };
}

/** A job is only valid with real snowflakes; anything else is dropped without running. */
export function isValidJob(job, now = Date.now()) {
  return !!job
    && ['targetBotId', 'guildId', 'voiceChannelId', 'userId'].every(k => SNOWFLAKE.test(String(job[k] ?? '')))
    && (job.textChannelId === null || job.textChannelId === undefined || SNOWFLAKE.test(String(job.textChannelId)))
    && now - new Date(job.createdAt ?? 0).getTime() <= JOB_MAX_AGE_MS;
}

const jobModel = async () => {
  const { default: mongoose } = await import('mongoose');
  if (mongoose.connection.readyState !== 1) return null;
  return (await import('../models/PlayerJob.js')).PlayerJob;
};

// ── PRIMARY side ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Ask `targetBotId` to serve this member. → { id } | { busy: true } (a job for this server is already open) | null (no database).
 */
export async function dispatchJob({ targetBotId, guildId, voiceChannelId, textChannelId = null, userId, lang = 'ar', fromBotId = null, intent }) {
  const PlayerJob = await jobModel();
  if (!PlayerJob) return null;
  const fresh = new Date(Date.now() - JOB_MAX_AGE_MS);
  // One open request per server and bot: a member hammering /recite must not queue a pile of joins.
  if (await PlayerJob.exists({ targetBotId, guildId, status: { $in: ['pending', 'claimed'] }, createdAt: { $gt: fresh } })) return { busy: true };
  const doc = await PlayerJob.create({
    targetBotId, fromBotId, guildId, voiceChannelId, textChannelId, userId,
    lang: lang === 'ar' ? 'ar' : 'en',
    intent: normalizeIntent(intent)
  });
  return { id: doc._id };
}

/**
 * Wait for the worker's answer. → the finished job ({ status: 'done'|'failed', error, panel }) or { status: 'timeout' } / { status: 'cancelled' }.
 * On timeout a job that nobody claimed is cancelled, so it can never start playing minutes later.
 */
export async function waitForJob(id, { timeoutMs = WAIT_MS, stepMs = WAIT_STEP_MS, sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  const PlayerJob = await jobModel();
  if (!PlayerJob) return { status: 'timeout' };
  for (let waited = 0; waited <= timeoutMs; waited += stepMs) {
    const doc = await PlayerJob.findById(id).lean();
    if (!doc) return { status: 'cancelled' };
    if (doc.status === 'done' || doc.status === 'failed' || doc.status === 'cancelled') {
      return { ...doc, error: doc.error ? { ...doc.error, vars: doc.error.vars instanceof Map ? Object.fromEntries(doc.error.vars) : (doc.error.vars ?? {}) } : null };
    }
    await sleep(stepMs);
  }
  const cancelled = await PlayerJob.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'cancelled', finishedAt: new Date() } });
  if (cancelled.modifiedCount) return { status: 'cancelled' };
  const now = await PlayerJob.findById(id).lean();           // somebody took it: is it still being worked on, or did it just finish?
  if (now?.status === 'done' || now?.status === 'failed') return { ...now, error: now.error ? { ...now.error, vars: now.error.vars instanceof Map ? Object.fromEntries(now.error.vars) : (now.error.vars ?? {}) } : null };
  return { status: 'timeout', claimed: now?.status === 'claimed' };
}

// ── SECONDARY side ───────────────────────────────────────────────────────────────────────────────────────────────────

async function realDeps() {
  const sm   = await import('../managers/sessionManager.js');
  const q    = await import('./quranService.js');
  const st   = await import('./stationService.js');
  const pr   = await import('../utils/panelRegistry.js');
  const { Blacklist } = await import('../models/Blacklist.js');
  const { SURAHS, getSurahByNumber } = await import('../data/surahs.js');
  const tr   = await import('../managers/sessionTransfer.js');
  return {
    getSession: sm.getSession, createAndJoin: sm.createAndJoin, enqueue: sm.enqueue, playNext: sm.playNext,
    clearQueue: sm.clearQueue, skipSession: sm.skipSession, playRadio: sm.playRadio,
    findReciterById: q.findReciterById, findReciter: q.findReciter, findDefaultReciter: q.findDefaultReciter, getPlayableUrls: q.getPlayableUrls,
    resolveStation: st.resolveStation, stationIsLive: st.stationIsLive,
    syncPanel: pr.syncPanel, sendVoicePanel: pr.sendVoicePanel,
    pauseSession: sm.pauseSession, resumeSession: sm.resumeSession, toggleLoop: sm.toggleLoop, setVolume: sm.setVolume, destroySession: sm.destroySession,
    isBanned: (guildId) => Blacklist.isBanned(guildId),
    surahs: SURAHS, surahByNumber: getSurahByNumber,
    moveSession: tr.moveSession, applyState: tr.applyState, exportSession: tr.exportSession
  };
}

const fail = (key, vars = {}) => ({ ok: false, error: { key, vars } });

/**
 * Execute one job. Never throws: → { ok: true, panel } | { ok: false, error: { key, vars } | { code } }.
 * The checks mirror requireVoiceChannel() of the primary, but run against THIS bot's own permissions.
 */
export async function executeJob(job, client, deps) {
  try {
    if (!isValidJob(job)) return fail('busy');                                  // stale or malformed: never run it
    const guild = client.guilds.cache.get(job.guildId);
    if (!guild) return fail('bot_no_access');
    if (await deps.isBanned(guild.id)) return fail('bot_no_access');

    const vc = guild.channels.cache.get(job.voiceChannelId);
    if (!vc?.isVoiceBased?.()) return fail('not_in_voice');
    if (vc.type === ChannelType.GuildStageVoice) return fail('stage_unsupported');
    // The member must really be in that room right now — a forged or stale job cannot pull the bot into a room for nobody.
    if (guild.voiceStates?.cache?.get(job.userId)?.channelId !== vc.id) return fail('not_in_voice');

    const perms = vc.permissionsFor(guild.members.me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel)) return fail('no_permission_view');
    if (!perms.has(PermissionFlagsBits.Connect))      return fail('no_permission_connect');
    if (!perms.has(PermissionFlagsBits.Speak))        return fail('no_permission_speak');
    const limit = vc.userLimit ?? 0;
    if (limit > 0 && (vc.members?.size ?? 0) >= limit && !perms.has(PermissionFlagsBits.MoveMembers) && !perms.has(PermissionFlagsBits.Administrator)) {
      return fail('voice_full', { limit: String(limit) });
    }

    const existing = deps.getSession(guild.id);
    const intent = normalizeIntent(job.intent);

    if (intent.kind === 'move') {
      // /pull, the member is alone with this bot's recitation: it comes to them and carries on from the same second.
      if (!existing) return fail('pull_no_session');
      await deps.moveSession({ guild, voiceChannel: vc, userId: job.userId, lang: job.lang, client, requireEmpty: intent.requireEmpty === true,
        afterRollBack: (oldRoom) => deps.sendVoicePanel?.(client, guild, oldRoom, null) }, deps);   // throws UserError on refusal
    } else if (intent.kind === 'resume') {
      // /pull, other people stay with the first bot: this one is the copy that continues for the member.
      if (existing) return fail('worker_busy');
      await deps.createAndJoin(guild, vc, job.userId, job.lang, client);
      if (!(await deps.applyState(guild.id, intent.state, deps))) {
        await deps.destroySession(guild.id).catch(() => {});                       // never leave a silent bot in the room
        return fail('pull_resume_failed', { channel: `<#${vc.id}>` });
      }
    } else {
      if (existing && existing.voiceChannelId !== vc.id) return fail('worker_busy');   // already reciting in another room: never move
      const session = existing ?? await deps.createAndJoin(guild, vc, job.userId, job.lang, client);
      const started = await runIntent(intent, { guild, session, job, deps });
      if (started === false) return fail('worker_start_failed');
    }

    const textChannel = job.textChannelId ? guild.channels.cache.get(job.textChannelId) ?? null : null;
    let panel = await deps.syncPanel(client, guild.id);
    if (!panel) panel = !!(await deps.sendVoicePanel(client, guild, vc, textChannel).catch(() => null));
    return { ok: true, panel };
  } catch (err) {
    const c = classifyError(err);
    if (c.kind === 'user')   return fail(c.key, Object.fromEntries(Object.entries(c.vars ?? {}).map(([k, v]) => [k, String(v)])));
    if (c.kind === 'ignore') return fail('busy');
    const code = errorCode(err, 'worker-job');
    logger.error(`[worker] ${code} job for guild ${job?.guildId}: ${err?.message}\n${err?.stack ?? ''}`);
    return { ok: false, error: { code } };
  }
}

/** The part of /recite and /live that happens after the bot is in the room. false = could not start. */
async function runIntent(intent, { guild, session, deps }) {
  const gid = guild.id;
  if (intent.kind === 'recite') {
    let reciter = intent.reciterId ? await deps.findReciterById(intent.reciterId) : null;
    if (!reciter && intent.reciter) reciter = await deps.findReciter(intent.reciter);
    if (!reciter?.moshaf?.length) reciter = await deps.findDefaultReciter(null, gid);   // the room still gets its panel and a recitation
    if (!reciter) return false;
    const surah = intent.surah ? deps.surahByNumber(intent.surah) : null;
    const name = reciter.displayName ?? reciter.englishName ?? reciter.name;
    const probe = surah ?? deps.surahs[0];
    if (!(await deps.getPlayableUrls(reciter, probe.number)).length) return false;
    if (!surah) {                                              // the whole Quran, in order — same as /recite without a surah
      deps.clearQueue(gid);
      session.fullQuran = true; session.loop = false; session.memorize = null;
      deps.enqueue(gid, { surah: deps.surahs[0], reciter: name, reciterObj: reciter });
      if (session.status === 'paused' || session.status === 'playing') deps.skipSession(gid); else await deps.playNext(gid);
      return true;
    }
    if (!deps.enqueue(gid, { surah, reciter: name, reciterObj: reciter })) return false;
    if (!(session.status !== 'idle' && session.current)) await deps.playNext(gid);
    return true;
  }
  if (intent.kind === 'live') {
    const station = await deps.resolveStation(gid, intent.station);
    if (!station?.url || !(await deps.stationIsLive(station.url))) return false;
    await deps.playRadio(gid, station);
    return true;
  }
  return true;                                                 // 'join': the panel is the whole point
}

let timer = null;
let busy  = false;

/** Start polling for jobs. The secondary calls this once it is logged in. `deps` is for tests. */
export function startJobWorker(client, deps = null) {
  if (timer) return;
  const tick = async () => {
    if (busy || !client.user) return;
    busy = true;
    try {
      const PlayerJob = await jobModel();
      if (!PlayerJob) return;
      const d = deps ?? await realDeps();
      for (let n = 0; n < 3; n++) {                           // a few per tick, then yield
        const job = await PlayerJob.findOneAndUpdate(
          { targetBotId: client.user.id, status: 'pending', createdAt: { $gt: new Date(Date.now() - JOB_MAX_AGE_MS) } },
          { $set: { status: 'claimed', claimedAt: new Date() } },
          { sort: { createdAt: 1 }, new: true }
        ).lean();
        if (!job) break;
        const res = await executeJob(job, client, d);
        await PlayerJob.updateOne({ _id: job._id }, { $set: res.ok
          ? { status: 'done', panel: res.panel !== false, finishedAt: new Date() }
          : { status: 'failed', error: res.error, finishedAt: new Date() } });
      }
      // Owner-dashboard commands (pause, skip, volume, stop…) for this bot's sessions.
      const WorkerCommand = await commandModel();
      for (let n = 0; WorkerCommand && n < 5; n++) {
        const cmd = await WorkerCommand.findOneAndUpdate(
          { targetBotId: client.user.id, status: 'pending', createdAt: { $gt: new Date(Date.now() - COMMAND_MAX_AGE_MS) } },
          { $set: { status: 'claimed' } }, { sort: { createdAt: 1 }, new: true }
        ).lean();
        if (!cmd) break;
        const r = await executeCommand(cmd, d);
        const { publishNow } = await import('./siblingService.js');
        await publishNow();                                    // the dashboard reads the new state right after the answer
        await WorkerCommand.updateOne({ _id: cmd._id }, { $set: r.ok
          ? { status: 'done', loop: r.loop ?? null, result: r.result ?? null, finishedAt: new Date() }
          : { status: 'failed', error: r.error, finishedAt: new Date() } });
      }
    } catch (err) {
      logger.warn(`[worker] poll failed: ${err.message}`);
    } finally {
      busy = false;
    }
  };
  timer = setInterval(() => { void tick(); }, POLL_MS);
  timer.unref?.();
  logger.info('Voice worker started — waiting for requests from the main bot');
}

export function stopJobWorker() { clearInterval(timer); timer = null; }

// ── What the PRIMARY tells the member ────────────────────────────────────────────────────────────────────────────────

// ── Owner-dashboard commands on the voice-only bot's sessions ─────────────────────────────────────────────────────────
export const COMMAND_MAX_AGE_MS = 20_000;
const commandModel = async () => {
  const { default: mongoose } = await import('mongoose');
  if (mongoose.connection.readyState !== 1) return null;
  return (await import('../models/WorkerCommand.js')).WorkerCommand;
};

/** PRIMARY: ask the voice-only bot to act on its session in `guildId`. → { ok: true, loop?, result? } | { ok: false, error } */
export async function sendWorkerCommand({ targetBotId, guildId, action, value = null, by = '' }, { timeoutMs = 10_000, stepMs = 250, sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  const WorkerCommand = await commandModel();
  if (!WorkerCommand) return { ok: false, error: 'no_database' };
  const doc = await WorkerCommand.create({ targetBotId, guildId, action, value, by: String(by).slice(0, 40) });
  for (let waited = 0; waited <= timeoutMs; waited += stepMs) {
    const d = await WorkerCommand.findById(doc._id).lean();
    if (d?.status === 'done')   return { ok: true, loop: d.loop ?? undefined, ...(d.result ? { result: d.result } : {}) };
    if (d?.status === 'failed') return { ok: false, error: d.error ?? 'failed' };
    await sleep(stepMs);
  }
  await WorkerCommand.updateOne({ _id: doc._id, status: 'pending' }, { $set: { status: 'cancelled', finishedAt: new Date() } });   // never run late
  return { ok: false, error: 'timeout' };
}

/** WORKER: run one command against this process's own sessions. Never throws. → { ok: true, loop?, result? } | { ok: false, error } */
export async function executeCommand(cmd, deps) {
  try {
    if (!SNOWFLAKE.test(String(cmd?.guildId ?? '')) || now() - new Date(cmd.createdAt ?? 0).getTime() > COMMAND_MAX_AGE_MS) return { ok: false, error: 'stale' };
    const id = cmd.guildId;
    if (!deps.getSession(id)) return { ok: false, error: 'no_session' };
    switch (cmd.action) {
      case 'pause':  return deps.pauseSession(id)  ? { ok: true } : { ok: false, error: 'bad_state' };
      case 'resume': return deps.resumeSession(id) ? { ok: true } : { ok: false, error: 'bad_state' };
      case 'skip':   return deps.skipSession(id)   ? { ok: true } : { ok: false, error: 'bad_state' };
      case 'loop':   return { ok: true, loop: !!deps.toggleLoop(id) };
      case 'volume': {
        const v = cmd.value;                                   // a missing value must NOT count as 0 (that would mute the bot)
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 150) return { ok: false, error: 'bad_value' };
        return (await deps.setVolume(id, v)) ? { ok: true } : { ok: false, error: 'bad_state' };
      }
      case 'stop':   await deps.destroySession(id); return { ok: true };
      case 'export': {                                         // /pull on the main bot asks "what are you playing, and where exactly?"
        const state = deps.exportSession?.(id);
        return state ? { ok: true, result: toWire(state) } : { ok: false, error: 'no_session' };
      }
      default:       return { ok: false, error: 'bad_action' };
    }
  } catch (err) {
    logger.warn(`[worker] command ${cmd?.action} failed: ${err.message}`);
    return { ok: false, error: 'failed' };
  }
}
const now = () => Date.now();

/** i18n pieces for the outcome of a hand-off: { ok: true, title, body } | { ok: false, key, vars, code }. */
export function describeOutcome(result, { botId, channelId }) {
  const bot = `<@${botId}>`;
  const ch  = `<#${channelId}>`;
  if (result.status === 'done') return { ok: true, key: result.panel === false ? 'misc.worker_joined_nopanel' : 'misc.worker_joined', vars: { bot, channel: ch } };
  if (result.status === 'failed') {
    return result.error?.key
      ? { ok: false, key: `errors.${result.error.key}`, vars: { ...(result.error.vars ?? {}), bot, channel: ch } }
      : { ok: false, key: 'errors.unexpected', vars: { code: result.error?.code ?? 'E-000000' } };
  }
  if (result.claimed) return { ok: false, key: 'errors.worker_still_joining', vars: { bot, channel: ch } };
  return { ok: false, key: 'errors.worker_timeout', vars: { bot } };
}
