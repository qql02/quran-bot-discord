import { planPull, normalizeWire, toWire, formatPosition, mayPull } from './transferState.js';
import { voiceAccessProblem } from '../utils/permissions.js';
import { classifyError, errorCode } from '../utils/errors.js';
import { getSurahByNumber, surahLabel } from '../data/surahs.js';
import { PermissionFlagsBits } from 'discord.js';

const VIEW_CHANNEL = PermissionFlagsBits.ViewChannel;
import { logger } from '../utils/logger.js';

/**
 * /pull — "I moved to another voice room: bring the recitation to me, from the same place."
 *
 *   • Nobody else is left in the old room  → the SAME bot moves to the member's room and carries on (surah, second, queue, volume).
 *   • Other people stay in the old room    → they keep their bot; ANOTHER free bot (the main one, or a voice-only second bot) joins the
 *                                            member's room and continues a copy from the same second.
 *
 * Runs on the main bot (the one that owns the commands). A session that belongs to a voice-only bot is reached through the shared
 * database: `move` job (it moves itself) or `export` command (it reports its state so a copy can start elsewhere).
 * Everything the outside world provides comes in through `deps`, so the whole flow is testable without Discord or a database.
 *
 * @returns {Promise<{ ok: true, kind: 'move'|'clone', botId: string, fromBotId: string, fromChannelId: string, state: object|null }
 *                | { ok: false, key: string, vars: object }>}     keys are locale keys under errors.*
 */
const COOLDOWN_MS = 10_000;
const WAIT_FOR_BOT_MS = 75_000;
const running = new Set();   // `room:<guild>:<source room>` and `bot:<guild>:<bot that will be in the member's room>` of pulls in progress — the same recitation / bot is never pulled twice at once, other rooms are not held up
const lastTry = new Map();   // `${guildId}:${userId}` → time of that member's last pull — a cooldown per MEMBER, so one person cannot block the others
export const _resetPullGate = () => { running.clear(); lastTry.clear(); };   // tests

export async function runPull(ctx, deps) {
  const { guild, client, userId, voice, lang, hintChannelId = null, explicit = false } = ctx;
  const meId = client.user.id;
  const fail = (key, vars = {}) => ({ ok: false, key, vars });

  if (!voice) return fail('not_in_voice');

  const who = `${guild.id}:${userId}`;
  if (Date.now() - (lastTry.get(who) ?? 0) < COOLDOWN_MS) return fail('pull_too_fast');
  lastTry.set(who, Date.now());
  let held = [];
  try {
    return await pull();
  } finally {
    for (const k of held) running.delete(k);
    if (lastTry.size > 2000) for (const [k, t] of lastTry) if (Date.now() - t > COOLDOWN_MS) lastTry.delete(k);
  }

  async function pull() {
  try {
    // ── 1. every session of the server that this bot can act on: its own + the voice-only bots' ───────────────────────────────
    const siblings = await deps.getSiblings(guild.id);
    const workers  = siblings.filter(s => s.role === 'secondary');
    const own      = deps.getSession(guild.id);
    // Rooms the member cannot even see are not theirs to pull from (and must not be named in any reply).
    const canSee = (channelId) => {
      const room = guild.channels.cache.get(channelId);
      return !!room && !!ctx.member && !!room.permissionsFor?.(ctx.member)?.has?.(VIEW_CHANNEL);
    };
    const sessions = [
      ...(own ? [{ botId: meId, role: 'primary', channelId: own.voiceChannelId, local: true }] : []),
      ...workers.filter(w => w.busyChannelId).map(w => ({ botId: w.id, role: 'secondary', channelId: w.busyChannelId, local: false }))
    ].filter(s => s.channelId === voice.id || canSee(s.channelId));
    const freeBotIds = [...(own ? [] : [meId]), ...workers.filter(w => !w.busyChannelId).map(w => w.id)];

    const listeners = (channelId) => {
      const room = guild.channels.cache.get(channelId);
      return room?.members ? [...room.members.values()].filter(m => !m.user?.bot && m.id !== userId).length : 0;
    };

    const left = ctx.leftChannelIds ?? [];
    const hint = explicit ? hintChannelId : (left.find(id => sessions.some(s => s.channelId === id)) ?? null);   // the most recent room that has a recitation
    const plan = planPull({ userChannelId: voice.id, sessions, freeBotIds, listeners, hintChannelId: hint, explicit });
    if (plan.kind === 'error') {
      const v = plan.vars ?? {};
      return fail(plan.key, {
        bot: v.botId ? `<@${v.botId}>` : '',
        channel: v.channelId ? `<#${v.channelId}>` : '',
        channels: (v.channelIds ?? []).map(id => `<#${id}>`).join(' '),
        listeners: String(v.listeners ?? '')
      });
    }

    const { source } = plan;
    if (!mayPull({ source, userId, leftChannelIds: ctx.leftChannelIds ?? [], ownerId: source.local ? own?.ownerId ?? null : null, isManager: !!ctx.isManager })) {
      return fail('pull_not_allowed', { channel: `<#${source.channelId}>` });
    }
    // From here on this recitation and the bot that will serve the member are taken (nothing awaits between the check and the claim).
    const keys = [`room:${guild.id}:${source.channelId}`, `bot:${guild.id}:${plan.kind === 'move' ? source.botId : plan.targetBotId}`];
    if (keys.some(k => running.has(k))) return fail('pull_too_fast');
    for (const k of keys) running.add(k);
    held = keys;
    const job = (targetBotId, intent) => deps.dispatchJob({
      targetBotId, fromBotId: meId, guildId: guild.id, voiceChannelId: voice.id, textChannelId: ctx.textChannelId ?? null,
      userId, lang, intent
    });
    const finish = async (targetBotId, intent) => {            // hand a job to a voice-only bot and wait for its answer
      const j = await job(targetBotId, intent);
      if (!j) return fail('worker_timeout', { bot: `<@${targetBotId}>` });          // no database: behave as if the bot did not answer
      if (j.busy) return fail('worker_pending', { bot: `<@${targetBotId}>` });
      const r = await deps.waitForJob(j.id, { timeoutMs: WAIT_FOR_BOT_MS });   // a long surah has to be decoded up to the saved second
      if (r.status === 'done') return { ok: true, panel: r.panel !== false };
      if (r.status === 'failed') return r.error?.key ? fail(r.error.key, { ...(r.error.vars ?? {}), bot: `<@${targetBotId}>`, channel: `<#${voice.id}>` }) : fail('unexpected', { code: r.error?.code ?? 'E-000000' });
      if (r.claimed) return fail('worker_still_joining', { bot: `<@${targetBotId}>`, channel: `<#${voice.id}>` });   // it took the job and is still at it
      return fail('worker_timeout', { bot: `<@${targetBotId}>` });
    };
    // This bot is the one that will be in the member's room: it must be able to join and speak there.
    const localAccess = () => voiceAccessProblem(voice, guild.members.me);

    // ── 2a. alone in the old room → the same bot moves ───────────────────────────────────────────────────────────────────────
    if (plan.kind === 'move') {
      if (source.local) {
        const problem = localAccess(); if (problem) return fail(problem.key, problem.vars);
        const { state, fromChannelId } = await deps.moveSession({ guild, voiceChannel: voice, userId, lang, client, requireEmpty: true,
          afterRollBack: (oldRoom) => deps.sendVoicePanel(client, guild, oldRoom, ctx.textChannel ?? null) }, deps.quran);
        await deps.sendVoicePanel(client, guild, voice, ctx.textChannel ?? null).catch(() => {});
        return { ok: true, kind: 'move', botId: meId, fromBotId: meId, fromChannelId, state: toWire(state) };
      }
      const r = await finish(source.botId, { kind: 'move', requireEmpty: true });
      return r.ok ? { ok: true, kind: 'move', botId: source.botId, fromBotId: source.botId, fromChannelId: source.channelId, state: null, panel: r.panel } : r;
    }

    // ── 2b. people stay in the old room → a second bot continues a copy from the same second ─────────────────────────────────
    let state;
    if (source.local) {
      state = toWire(deps.exportSession(guild.id));
    } else {
      const r = await deps.sendWorkerCommand({ targetBotId: source.botId, guildId: guild.id, action: 'export' });
      if (!r.ok) return fail(r.error === 'timeout' ? 'worker_timeout' : 'pull_no_session', { bot: `<@${source.botId}>` });
      state = r.result;
    }
    state = normalizeWire(state);
    if (!state) return fail('pull_no_session');

    if (plan.targetBotId === meId) {                          // the main bot is free: it is the copy
      const problem = localAccess(); if (problem) return fail(problem.key, problem.vars);
      await deps.createAndJoin(guild, voice, userId, lang, client);
      if (!(await deps.applyState(guild.id, state, deps.quran))) {
        await deps.destroySession(guild.id).catch(() => {});
        return fail('pull_resume_failed', { channel: `<#${voice.id}>` });
      }
      await deps.sendVoicePanel(client, guild, voice, ctx.textChannel ?? null).catch(() => {});
      return { ok: true, kind: 'clone', botId: meId, fromBotId: source.botId, fromChannelId: source.channelId, state: toWire(state) };
    }
    const r = await finish(plan.targetBotId, { kind: 'resume', state: toWire(state) });
    return r.ok ? { ok: true, kind: 'clone', botId: plan.targetBotId, fromBotId: source.botId, fromChannelId: source.channelId, state: toWire(state), panel: r.panel } : r;
  } catch (err) {
    const c = classifyError(err);
    if (c.kind === 'user') return fail(c.key, Object.fromEntries(Object.entries(c.vars ?? {}).map(([k, v]) => [k, String(v)])));
    if (c.kind === 'ignore') return fail('busy');
    const code = errorCode(err, 'pull');
    logger.error(`[pull] ${code} guild ${guild?.id}: ${err?.message}\n${err?.stack ?? ''}`);
    return fail('unexpected', { code });
  }
  }
}

/**
 * What the member reads after a successful pull: where the recitation continues from.
 * → { what: 'سورة الكهف' | station name | null, time: '12:34' | null }
 */
export function describePulled(state, lang) {
  if (!state) return { what: null, time: null };
  if (state.radio) return { what: state.radio.name, time: null };
  const s = state.surah ? getSurahByNumber(state.surah) : null;
  if (!s) return { what: null, time: null };
  return { what: surahLabel(s, lang), time: formatPosition(state.positionMs) };
}
