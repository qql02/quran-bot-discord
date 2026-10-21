/**
 * Owner panel — control centre routes.
 *
 *   GET  /api/admin/control                    global controls + the lists the form needs                       OWNER
 *   POST /api/admin/control                    change any of: disabledCommands · disabledFeatures · maxQueue · locked(+minutes) · note · modCaps   OWNER
 *
 *   GET  /api/admin/second-bot                 is the second bot (the process started from this project) running / switched off      OWNER
 *   POST /api/admin/second-bot                 { action: 'stop' | 'start' } — end its process (frees ALL its RAM) / bring it back   OWNER
 *
 *   GET  /api/admin/guilds/:id/queue           the queue of one server (now playing + upcoming)                  OWNER or MOD (cap "queue")
 *   POST /api/admin/guilds/:id/queue/remove    { index }                                                          OWNER or MOD (cap "queue")
 *   POST /api/admin/guilds/:id/queue/move      { from, to }                                                       OWNER or MOD (cap "queue")
 *   POST /api/admin/guilds/:id/queue/shuffle                                                                      OWNER or MOD (cap "queue")
 *   POST /api/admin/guilds/:id/queue/clear                                                                        OWNER or MOD (cap "queue")
 *
 * Same rules as the other phases: ids are validated, indexes are integers checked against the live queue, and nothing
 * from the client ever reaches Mongo except through buildControlPatch (fixed field names, validated values).
 */

import { config } from '../config.js';
import { getSession, removeQueueItem, moveQueueItem, shuffleQueue, clearQueue, queueLimit, MAX_QUEUE } from '../managers/sessionManager.js';
import { getControlSync, saveControl } from '../services/controlService.js';
import { secondBotStatus, stopSecondBot, startSecondBotAgain } from '../services/secondBotControl.js';
import { FEATURES, MOD_CAPS, buildControlPatch, describePatch, isGloballyLocked } from '../utils/botControl.js';

const SNOWFLAKE = /^\d{15,25}$/;

/** What the dashboard shows for one queue entry (never the internal reciter object). */
const entry = (it) => ({ number: it?.surah?.number ?? null, surah: it?.surah?.arabic ?? '—', reciter: it?.reciter ?? '' });

export function registerOwnerControl(app, { client, requireAdmin, requireCap, pushActivity, fail }) {

  /* ── Global controls ────────────────────────────────────────────────────── */
  app.get('/api/admin/control', requireAdmin, (_req, res) => {
    const ctl = getControlSync();
    res.json({
      control: { ...ctl, lockedNow: isGloballyLocked(ctl) },
      commands: [...client.commands.keys()].sort(),
      features: Object.entries(FEATURES).map(([key, f]) => ({ key, label: f.label, desc: f.desc })),
      modCaps: Object.entries(MOD_CAPS).map(([key, label]) => ({ key, label })),
      mods: config.admin.modIds.filter(id => !config.admin.ids.includes(id)),
      maxQueueGlobal: MAX_QUEUE
    });
  });

  app.post('/api/admin/control', requireAdmin, async (req, res) => {
    const built = buildControlPatch(req.body, { knownCommands: new Set(client.commands.keys()), maxQueueGlobal: MAX_QUEUE });
    if (built.error) return res.status(400).json({ error: built.error });
    try {
      const u = req.session.user;
      const ctl = await saveControl(built.patch, `${u.username ?? u.id} (${u.id})`);
      pushActivity('admin', 'تعديل التحكم العام', describePatch(built.patch));
      res.json({ ok: true, control: { ...ctl, lockedNow: isGloballyLocked(ctl) } });
    } catch (err) { fail(res, err); }
  });

  /* ── Second bot ON / OFF ────────────────────────────────────────────────── */
  app.get('/api/admin/second-bot', requireAdmin, async (_req, res) => {
    try { res.json(await secondBotStatus()); } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/second-bot', requireAdmin, async (req, res) => {
    const action = req.body?.action;
    if (action !== 'stop' && action !== 'start') return res.status(400).json({ error: "action must be 'stop' or 'start'" });
    try {
      const u = req.session.user;
      const by = `${u.username ?? u.id} (${u.id})`;
      const r = action === 'stop' ? await stopSecondBot(by) : await startSecondBotAgain(by);
      if (!r.ok) {
        const msg = r.error === 'not_managed' ? 'the second bot is not started from this project (no SECOND_BOT_TOKEN here), so it cannot be switched from this panel' : 'the bot is shutting down';
        return res.status(409).json({ error: msg });
      }
      pushActivity('admin', action === 'stop' ? 'إيقاف البوت الثاني' : 'تشغيل البوت الثاني', by);
      res.json({ ok: true, ...(await secondBotStatus()) });
    } catch (err) { fail(res, err); }
  });

  /* ── Queue of one server ────────────────────────────────────────────────── */
  const live = (req, res) => {
    if (!SNOWFLAKE.test(req.params.id)) { res.status(400).json({ error: 'invalid server id' }); return null; }
    const s = getSession(req.params.id);
    if (!s) { res.status(404).json({ error: 'no active session in this server' }); return null; }
    return s;
  };
  const gname = (id) => client.guilds.cache.get(id)?.name ?? id;
  const snapshot = (s) => ({
    now: s.current ? entry(s.current) : null,
    status: s.status, loop: !!s.loop, fullQuran: !!s.fullQuran, radio: !!s.radio,
    cap: queueLimit(s),
    queue: s.queue.slice(0, 200).map(entry), total: s.queue.length
  });

  app.get('/api/admin/guilds/:id/queue', requireCap('queue'), (req, res) => {
    const s = live(req, res); if (!s) return;
    res.json(snapshot(s));
  });

  app.post('/api/admin/guilds/:id/queue/remove', requireCap('queue'), (req, res) => {
    const s = live(req, res); if (!s) return;
    const index = req.body?.index;
    if (!Number.isInteger(index) || index < 0 || index >= s.queue.length) return res.status(400).json({ error: 'index is outside the queue' });
    const gone = removeQueueItem(req.params.id, index);
    if (!gone) return res.status(409).json({ error: 'the queue changed — reload it' });
    pushActivity('admin', `حذف من الطابور: ${gone.surah?.arabic ?? ''}`, gname(req.params.id));
    res.json({ ok: true, ...snapshot(s) });
  });

  app.post('/api/admin/guilds/:id/queue/move', requireCap('queue'), (req, res) => {
    const s = live(req, res); if (!s) return;
    const { from, to } = req.body ?? {};
    if (!moveQueueItem(req.params.id, from, to)) return res.status(400).json({ error: 'from / to must be positions inside the queue' });
    pushActivity('admin', 'تغيير ترتيب الطابور', `${gname(req.params.id)} · ${from + 1} ← ${to + 1}`);
    res.json({ ok: true, ...snapshot(s) });
  });

  app.post('/api/admin/guilds/:id/queue/shuffle', requireCap('queue'), (req, res) => {
    const s = live(req, res); if (!s) return;
    if (!shuffleQueue(req.params.id)) return res.status(409).json({ error: 'the queue needs at least 2 items' });
    pushActivity('admin', 'خلط الطابور', gname(req.params.id));
    res.json({ ok: true, ...snapshot(s) });
  });

  app.post('/api/admin/guilds/:id/queue/clear', requireCap('queue'), (req, res) => {
    const s = live(req, res); if (!s) return;
    const count = s.queue.length;
    if (!count) return res.status(409).json({ error: 'the queue is already empty' });
    // Same as /clearqueue: the modes that refill the queue on their own are switched off, or the queue would fill up again.
    s.fullQuran = false; s.loop = false; s.memorize = null;
    clearQueue(req.params.id);
    pushActivity('admin', `مسح الطابور (${count})`, gname(req.params.id));
    res.json({ ok: true, ...snapshot(s) });
  });
}
