/**
 * The state of a recitation that is handed over to another room (and maybe another bot) by /pull — PURE helpers only (no Discord,
 * no database, no session manager), so the same code validates it on both sides of the shared database and is easy to test.
 *
 *   exportState(session)  →  state (this process, may carry live reciter objects)
 *   toWire(state)         →  plain JSON for the database
 *   normalizeWire(raw)    →  a clean state, or null when the document is not a valid one (never trust the database blindly)
 *
 * The position is in milliseconds into the recording that is playing. Everything else is "what happens after it": the queue, the
 * Khatma / repeat / memorize modes, the volume and the sleep timer — so the listener hears the same thing, from the same place.
 */

export const MAX_TRANSFER_QUEUE = 30;
export const MAX_RESUME_LAG_MS = 120_000;   // the most time that is added to a position because the hand-over took a while (also bounds clock differences)

/** How far the recitation has moved on since `state` was exported — what a COPY has to skip to be in step. 0 when paused or unknown. */
export function resumeLagMs(state, now = Date.now()) {
  if (!state || state.paused || !state.surah || !Number.isFinite(state.exportedAt)) return 0;
  return Math.min(MAX_RESUME_LAG_MS, Math.max(0, now - state.exportedAt));
}
const MAX_POSITION_MS = 12 * 3_600_000;
const MAX_SLEEP_MS    = 24 * 3_600_000;
const SNOWFLAKE = /^\d{17,20}$/;

const str  = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const int  = (v, min, max, dflt) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : dflt; };
const httpUrl = (v, max) => { const s = str(v, max + 1); return s && s.length <= max && /^https?:\/\//i.test(s) ? s : null; };

/** How far into the current recording playback is, in ms. Live streams and idle sessions have no position (0). */
export function getPositionMs(session) {
  const cur = session?.current;
  if (!cur || cur.isRadio) return 0;
  const played = typeof session.player?.positionMs === 'function' ? session.player.positionMs() : 0;
  return Math.max(0, Math.floor((cur.offsetMs ?? 0) + (Number.isFinite(played) ? played : 0)));
}

const reciterId = (obj) => (obj?.id === undefined || obj?.id === null ? null : String(obj.id).slice(0, 20));

/**
 * Snapshot of a live session. `_reciterObj` / `reciterObj` are kept for a move inside this process (no lookup needed);
 * `toWire` drops them.
 */
export function exportState(session) {
  if (!session) return null;
  const cur = session.current ?? null;
  const state = {
    ownerId: session.ownerId ?? null,
    language: session.language === 'ar' ? 'ar' : 'en',
    volume: Number.isFinite(session.volume) ? session.volume : 100,
    paused: session.status === 'paused',
    fullQuran: !!session.fullQuran,
    loop: !!session.loop,
    memorize: session.memorize ? { repeatCount: session.memorize.repeatCount, delayMs: session.memorize.delayMs, currentRep: session.memorize.currentRep } : null,
    sleep: session.sleepTimer === 'end_of_track' ? 'end_of_track'
         : session.sleepTimer && session.sleepEndsAt ? Math.max(1_000, session.sleepEndsAt - Date.now()) : null,
    surah: null, reciter: null, reciterId: null, riwaya: null, url: null, positionMs: 0, _reciterObj: null,
    exportedAt: Date.now(),                       // when positionMs was read: whoever resumes it adds the time that passed since (see applyState)
    radio: null,
    queue: (session.queue ?? []).slice(0, MAX_TRANSFER_QUEUE).map(q => ({
      surah: q.surah?.number ?? null, reciter: q.reciter ?? null, reciterId: reciterId(q.reciterObj), reciterObj: q.reciterObj ?? null
    }))
  };
  if (cur?.isRadio) {
    const st = session.radio ?? cur;
    state.radio = { name: cur.reciter ?? st?.name ?? 'Radio', url: session.radio?.url ?? null };
  } else if (cur) {
    state.surah = cur.surah?.number ?? null;
    state.reciter = cur.reciter ?? null;
    state.reciterId = reciterId(cur.reciterObj);
    state.riwaya = cur.riwaya ?? null;
    state.url = cur.url ?? null;
    state.positionMs = getPositionMs(session);
    state._reciterObj = cur.reciterObj ?? null;
  }
  return state;
}

/** JSON for the shared database: no live objects, bounded sizes. */
export function toWire(state) {
  if (!state) return null;
  const rest = { ...state };
  delete rest._reciterObj;
  rest.queue = (state.queue ?? []).slice(0, MAX_TRANSFER_QUEUE).map(q => ({ surah: q.surah, reciter: q.reciter, reciterId: q.reciterId }));
  return rest;
}

/** Validate / clean a state that came from anywhere (a database document). → state, or null when unusable. */
export function normalizeWire(raw) {
  if (!raw || typeof raw !== 'object') return null;

  let radio = null;
  if (raw.radio && typeof raw.radio === 'object') {
    const url = httpUrl(raw.radio.url, 300);
    if (!url) return null;                                   // a radio hand-over without a stream address cannot be resumed
    radio = { name: str(raw.radio.name, 100) ?? 'Radio', url };
  }

  const surah = raw.surah === null || raw.surah === undefined ? null : int(raw.surah, 1, 114, undefined);
  if (surah === undefined) return null;                      // a surah number that is not 1–114 means a corrupt document

  let memorize = null;
  if (raw.memorize && typeof raw.memorize === 'object') {
    const repeatCount = int(raw.memorize.repeatCount, 1, 100, null);
    if (repeatCount) memorize = { repeatCount, delayMs: int(raw.memorize.delayMs, 0, 600_000, 0), currentRep: int(raw.memorize.currentRep, 0, repeatCount, 0) };
  }

  const sleep = raw.sleep === 'end_of_track' ? 'end_of_track' : int(raw.sleep, 1, MAX_SLEEP_MS, null);

  const queue = [];
  for (const q of Array.isArray(raw.queue) ? raw.queue.slice(0, MAX_TRANSFER_QUEUE) : []) {
    const n = int(q?.surah, 1, 114, null);
    if (n) queue.push({ surah: n, reciter: str(q.reciter, 120), reciterId: str(String(q.reciterId ?? ''), 20) });
  }

  return {
    ownerId: SNOWFLAKE.test(String(raw.ownerId ?? '')) ? String(raw.ownerId) : null,
    language: raw.language === 'ar' ? 'ar' : 'en',
    volume: int(raw.volume, 0, 150, 100),
    paused: !!raw.paused,
    fullQuran: !!raw.fullQuran,
    loop: !!raw.loop,
    memorize,
    sleep,
    surah,
    reciter: str(raw.reciter, 120),
    reciterId: str(String(raw.reciterId ?? ''), 20),
    riwaya: str(raw.riwaya, 120),
    url: httpUrl(raw.url, 500),
    positionMs: radio ? 0 : int(Math.floor(Number(raw.positionMs)), 0, MAX_POSITION_MS, 0),
    exportedAt: int(Math.floor(Number(raw.exportedAt)), 0, Number.MAX_SAFE_INTEGER, null),
    _reciterObj: null,
    radio,
    queue
  };
}

/** m:ss (or h:mm:ss) for a position, shown to the member. */
export function formatPosition(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// ── Which session to pull, and how ────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure decision for /pull. The member is in `userChannelId` and wants the recitation they were listening to to come to them.
 *
 * @param {object} p
 * @param {string} p.userChannelId                          the member's voice room now
 * @param {Array<{botId:string, role:'primary'|'secondary', channelId:string, local?:boolean}>} p.sessions  every bot session in this server
 * @param {string[]} [p.freeBotIds]                          bots in this server that are not reciting anywhere (the main bot first when it is free)
 * @param {(channelId:string) => number} p.listeners         people still in that room (the member who is pulling is NOT counted)
 * @param {string|null} [p.hintChannelId]                    the room the member named, or the last room they left
 * @param {boolean} [p.explicit]                             the member named the room themselves (so a wrong one is an error, not a guess)
 * @returns {{ kind: 'error', key: string, vars?: object }
 *         | { kind: 'move',  source: object, listeners: 0 }
 *         | { kind: 'clone', source: object, targetBotId: string, listeners: number }}
 */
export function planPull({ userChannelId, sessions, freeBotIds = [], listeners, hintChannelId = null, explicit = false }) {
  const inMyRoom = sessions.find(s => s.channelId === userChannelId);
  if (inMyRoom) return { kind: 'error', key: 'pull_already_here', vars: { botId: inMyRoom.botId } };

  const candidates = sessions.filter(s => s.channelId !== userChannelId);
  if (!candidates.length) return { kind: 'error', key: 'pull_no_session' };

  let source = hintChannelId ? candidates.find(s => s.channelId === hintChannelId) : null;
  // The member NAMED a room and no bot is in it: say so, rather than quietly pulling some other recitation.
  if (!source && explicit && hintChannelId) return { kind: 'error', key: 'pull_no_bot_there', vars: { channelId: hintChannelId } };
  if (!source && candidates.length === 1) source = candidates[0];
  if (!source) return { kind: 'error', key: 'pull_ambiguous', vars: { channelIds: candidates.map(c => c.channelId) } };

  const others = Math.max(0, Number(listeners(source.channelId)) || 0);
  if (others === 0) return { kind: 'move', source, listeners: 0 };

  const target = freeBotIds.find(id => id !== source.botId);
  if (!target) return { kind: 'error', key: 'pull_no_free_bot', vars: { botId: source.botId, channelId: source.channelId, listeners: others } };
  return { kind: 'clone', source, targetBotId: target, listeners: others };
}

/**
 * Who may pull a recitation away from its room? Only someone who is plausibly "its listener": they were in that room a moment ago
 * (the room they just left), they started that session, or they manage the server. Everyone else could otherwise drag a recitation
 * (or a free bot) out of a room they never listened in, just by typing /pull from anywhere.
 */
export function mayPull({ source, userId, leftChannelIds = [], ownerId = null, isManager = false }) {
  if (isManager) return true;
  if (leftChannelIds.includes(source.channelId)) return true;
  return !!ownerId && ownerId === userId;
}
