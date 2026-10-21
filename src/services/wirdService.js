import { buildDailyDelivery } from './dailyPage.js';
import { WirdSubscription } from '../models/WirdSubscription.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { Blacklist } from '../models/Blacklist.js';
import { logger } from '../utils/logger.js';
import { resolveChannel, buildAdhkarEmbeds } from './adhkarService.js';
import {
  applyReading, reminderDue, subscriptionState, nextExpiry, clampToDailyLimit, isInactive, INACTIVITY_PAUSE_DAYS,
  hasPersonalAdhkar, personalAdhkarDue
} from '../utils/wird.js';
import {
  expiringMessage, expiredMessage, inactiveMessage,
  khatmaAnnouncement, remainingToday, todayFor, guildWirdLang
} from '../utils/wirdUi.js';
import { isFeatureOn } from '../utils/botControl.js';
import { getControlSync } from './controlService.js';
import { mapLimit } from '../utils/mapLimit.js';

const TICK_MS = 60_000;
const TICK_BATCH = 500;          // subscribers loaded per round trip: memory stays flat however many people subscribe
const TICK_CONCURRENCY = 5;     // members processed at the same time within one tick
const MAX_FAILS = 5;             // consecutive undeliverable reminders before the subscription is paused

let timer   = null;
let running = false;

// ── Delivery: DM only by default (the wird room fallback exists but every scheduler call passes null, so nothing is posted in channels) ───────────────────────────────────────────────────────────────
/** @returns {'dm'|'channel'|'closed'|'gone'|'transient'} */
export async function deliver(client, sub, payload, roomPayload = null) {
  let user;
  try { user = await client.users.fetch(sub.userId); }
  catch (err) { return err?.code === 10013 ? 'gone' : 'transient'; }

  try { await user.send(payload); return 'dm'; }
  catch (err) { if (err?.code !== 50007) return 'transient'; }    // 50007 = this member has DMs closed

  // DMs closed → ping them in the wird room of the server they subscribed in (if that room is set up).
  // `roomPayload === null` = DM only (personal adhkar never go into a public room).
  if (!roomPayload || !sub.guildId) return 'closed';
  try {
    const doc = await GuildSettings.findOne({ guildId: sub.guildId }, { wird: 1 }).lean();
    if (!doc?.wird?.channelId) return 'closed';
    // Never ping into a room for someone who left that server (it would just be noise for everyone else).
    const guild = client.guilds.cache.get(sub.guildId);
    if (!guild) return 'closed';
    const member = await guild.members.fetch(sub.userId).catch(err => (err?.code === 10007 ? null : undefined));
    if (member === null) return 'closed';        // 10007 = unknown member (left the server); other errors: try anyway
    const r = await resolveChannel(client, sub.guildId, doc.wird.channelId);
    if (r.error) return 'closed';
    // The room is public: never put the member's progress or personal buttons there, only a short pointer.
    await r.channel.send({ ...roomPayload, allowedMentions: { users: [sub.userId] } });
    return 'channel';
  } catch (err) {
    logger.warn(`[wird:${sub.userId}] room fallback failed: ${err.message}`);
    return 'closed';
  }
}

// ── Actions shared by the scheduler and the interaction handler ───────────────────────────────────────────────────
/** (Re)activate: 30 more days from now, notices re-armed, progress untouched. */
export async function renewSubscription(userId, guildId) {
  return WirdSubscription.findOneAndUpdate(
    { userId },
    {
      $set: { active: true, expiresAt: nextExpiry(), renewWarned: false, expiredNoticed: false, failCount: 0, ...(guildId ? { guildId } : {}) },
      $inc: { renewals: 1 }
    },
    { new: true }
  ).lean();
}

/**
 * Record pages for a member. `pages` = null means "finish today's wird" (whatever is left of it).
 * @returns {Promise<{status:'none'|'inactive'|'already'|'busy'|'limit'} | {status:'ok', sub, result, days?}>}
 */
export async function logReading(client, userId, pages = null) {
  const sub = await WirdSubscription.findOne({ userId }).lean();
  if (!sub) return { status: 'none' };
  const now = new Date();
  if (!sub.active || subscriptionState(sub.expiresAt, now) === 'expired') return { status: 'inactive', sub };

  const today = todayFor(sub, now);
  let count = pages;
  if (count === null) {
    const left = remainingToday(sub, today);
    if (!left) return { status: 'already', sub };
    count = left.to - left.from + 1;
  }

  // Daily ceiling: stops a single tap from faking a whole khatma (and a public announcement).
  count = clampToDailyLimit(sub, today, count);
  if (count <= 0) return { status: 'limit', sub };

  const result = applyReading(sub, count, today);
  const set = { ...result.set, failCount: 0 };
  if (result.completedKhatma) { set.khatmaStartedAt = now; set.goalDays = null; set.goalDeadline = null; }

  // Optimistic guard: if a double-tap already changed the progress, this write simply doesn't apply.
  const updated = await WirdSubscription.findOneAndUpdate(
    { userId, currentPage: sub.currentPage ?? 0, dayPages: sub.dayPages ?? 0, dayDate: sub.dayDate ?? null },
    { $set: set },
    { new: true }
  ).lean();
  if (!updated) return { status: 'busy' };

  let days;
  if (result.completedKhatma) {
    days = Math.max(1, Math.ceil((now - new Date(sub.khatmaStartedAt ?? sub.startedAt ?? now)) / 86_400_000));
    announceKhatma(client, updated, days).catch(() => {});
  }
  return { status: 'ok', sub: updated, result, days };
}

async function announceKhatma(client, sub, days) {
  if (!sub.guildId) return;
  const doc = await GuildSettings.findOne({ guildId: sub.guildId }, { wird: 1, language: 1 }).lean();
  if (!doc?.wird?.channelId || doc.wird.announceKhatma === false) return;
  const r = await resolveChannel(client, sub.guildId, doc.wird.channelId);
  if (r.error) return;
  await r.channel.send(khatmaAnnouncement(sub.userId, sub.khatmaCount, days, guildWirdLang(doc)));
}

// ── Personal adhkar (DMs) ───────────────────────────────────────────────────────────────────────────────────────
async function deliverAdhkar(client, sub, embeds) {
  let outcome = 'dm';
  for (const embed of embeds) {                         // one message per embed: 6000 characters is the limit of a single message
    outcome = await deliver(client, sub, { embeds: [embed] }, null);
    if (outcome !== 'dm') return outcome;
  }
  return outcome;
}

/** Send the member's morning / evening adhkar when they are due on THEIR clock. Never throws into the wird flow. */
export async function processAdhkar(client, sub, now, build = buildAdhkarEmbeds) {
  for (const { slot, date } of personalAdhkarDue(sub, now)) {
    const field = slot === 'morning' ? 'lastAdhkarMorning' : 'lastAdhkarEvening';
    // Atomic claim: one tick/process wins a given local date for this member and slot.
    const claimed = await WirdSubscription.findOneAndUpdate(
      { userId: sub.userId, active: true, [field]: { $ne: date } }, { $set: { [field]: date } }
    ).lean();
    if (!claimed) continue;
    const outcome = await deliverAdhkar(client, claimed, build(slot, 'compact'));
    if (outcome === 'transient') {                       // network / 5xx → release the claim, the next tick retries inside the window
      await WirdSubscription.updateOne({ userId: sub.userId, [field]: date }, { $set: { [field]: claimed[field] ?? null } });
    } else if (outcome === 'gone') {
      await WirdSubscription.updateOne({ userId: sub.userId }, { $set: { active: false } });
    } else if (outcome === 'closed') {                   // DMs are off: switch the adhkar off instead of trying again every day
      await WirdSubscription.updateOne({ userId: sub.userId }, { $set: { adhkarMorning: false, adhkarEvening: false } });
      logger.info(`[wird:${sub.userId}] personal adhkar switched off (DMs closed)`);
    }
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function processSub(client, sub, now) {
  const { userId } = sub;
  const state = subscriptionState(sub.expiresAt, now);

  if (state === 'expired') {
    // Only the process that flips active → false sends the notice.
    const flipped = await WirdSubscription.findOneAndUpdate(
      { userId, active: true, expiresAt: { $lte: now } },
      { $set: { active: false, expiredNoticed: true } }
    ).lean();
    if (flipped) await deliver(client, sub, expiredMessage(sub), null);
    return;
  }

  if (state === 'expiring' && !sub.renewWarned && !isInactive(sub, now)) {   // silent members get the pause notice instead
    const claimed = await WirdSubscription.findOneAndUpdate({ userId, renewWarned: false }, { $set: { renewWarned: true } }).lean();
    if (claimed) await deliver(client, sub, expiringMessage(sub), null);
  }

  if (hasPersonalAdhkar(sub)) {
    try { await processAdhkar(client, sub, now); } catch (err) { logger.warn(`[wird:${userId}] personal adhkar failed: ${err.message}`); }
  }

  const due = reminderDue(sub, now);
  if (!due) return;

  // Silent for INACTIVITY_PAUSE_DAYS → stop here (and say so once) instead of messaging someone who stopped reading.
  // Members who also get personal adhkar are not paused for that (the subscription itself still ends after 30 days): only the page reminder is skipped.
  if (isInactive(sub, now)) {
    if (hasPersonalAdhkar(sub)) return;
    const paused = await WirdSubscription.findOneAndUpdate(
      { userId, active: true, expiresAt: sub.expiresAt, lastReadDate: sub.lastReadDate ?? null, dayPages: sub.dayPages ?? 0 },
      { $set: { active: false } }
    ).lean();
    if (paused) {
      logger.info(`[wird:${userId}] paused after ${INACTIVITY_PAUSE_DAYS} silent days`);
      await deliver(client, sub, inactiveMessage(sub), null);
    }
    return;
  }

  // Atomic claim: one tick/process wins a given local date for this member.
  const claimed = await WirdSubscription.findOneAndUpdate(
    { userId, active: true, lastRemindedDate: { $ne: due.date } },
    { $set: { lastRemindedDate: due.date } }
  ).lean();
  if (!claimed) return;

  const outcome = await deliver(client, claimed, await buildDailyDelivery(claimed, now), null);
  if (outcome === 'dm' || outcome === 'channel') {
    if (claimed.failCount) await WirdSubscription.updateOne({ userId }, { $set: { failCount: 0 } });
  } else if (outcome === 'transient') {
    // Network / 5xx — release the claim so the next tick retries inside the catch-up window.
    await WirdSubscription.updateOne({ userId, lastRemindedDate: due.date }, { $set: { lastRemindedDate: claimed.lastRemindedDate ?? null } });
  } else if (outcome === 'gone') {
    await WirdSubscription.updateOne({ userId }, { $set: { active: false } });
  } else {   // 'closed' — DMs off and no room to fall back to
    const fails = (claimed.failCount ?? 0) + 1;
    await WirdSubscription.updateOne({ userId }, { $set: { failCount: fails, ...(fails >= MAX_FAILS ? { active: false } : {}) } });
    if (fails >= MAX_FAILS) logger.info(`[wird:${userId}] paused after ${fails} undeliverable reminders`);
  }
}

async function runTick(client) {
  if (!isFeatureOn(getControlSync(), 'wird')) return;         // switched off by the owner (dashboard)
  const now  = new Date();
  const banned = new Map();      // one blacklist lookup per server per tick (cached as a promise, so concurrent members share it)
  const isBanned = (guildId) => {
    if (!banned.has(guildId)) {
      banned.set(guildId, Blacklist.isBanned(guildId).catch(() => false));   // DB hiccup — don't block delivery
    }
    return banned.get(guildId);
  };
  // A few members at a time: one slow DM (rate limit, network) no longer delays everyone behind it. Discord's REST
  // queue still enforces its own limits; each member is claimed atomically, so concurrency can't double-send.
  const handle = async (sub) => {
    try {
      if (sub.guildId && await isBanned(sub.guildId)) return;
      await processSub(client, sub, now);
    } catch (err) {
      logger.warn(`[wird:${sub.userId}] tick failed: ${err.message}`);
    }
  };
  // Page through the active subscribers by _id instead of loading all of them at once.
  let after = null;
  for (;;) {
    const batch = await WirdSubscription.find({ active: true, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(TICK_BATCH).lean();
    if (!batch.length) break;
    await mapLimit(batch, TICK_CONCURRENCY, handle);
    if (batch.length < TICK_BATCH) break;
    after = batch[batch.length - 1]._id;
  }
}

export function startWirdScheduler(client) {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runTick(client); }
    catch (err) { logger.error('[wird] scheduler tick failed:', err.message); }
    finally { running = false; }
  };
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();
  logger.info('[wird] reminder scheduler started');
}
