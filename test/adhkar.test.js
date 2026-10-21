import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAdhkarPages, renderScatterAdhkar, scatterCandidates, ADHKAR_KINDS } from '../src/data/adhkar.js';
import {
  parseTime, isValidTimeZone, localClock, dueSlots, CATCHUP_MINUTES,
  scatterSettings, scatterTimes, dueScatter, SCATTER_AVOID, SCATTER_CATCHUP
} from '../src/utils/adhkarSchedule.js';

const pageSize = (p) => p.title.length + (p.description?.length ?? 0) + p.fields.reduce((a, f) => a + f.name.length + f.value.length, 0);
const allText = (pages) => pages.flatMap(p => [p.description ?? '', ...p.fields.map(f => f.value)]).join('\n');

test('every adhkar page fits Discord embed limits (full and compact)', () => {
  for (const kind of ADHKAR_KINDS) {
    for (const style of ['full', 'compact']) {
      const pages = renderAdhkarPages(kind, { style });
      assert.ok(pages.length >= 1);
      if (style === 'compact') assert.equal(pages.length, 1, `${kind}: compact must be a single message`);
      for (const p of pages) {
        assert.ok(p.fields.length >= 1 && p.fields.length <= 25);
        assert.ok(pageSize(p) <= 6000, `${kind}/${style}: embed too large (${pageSize(p)})`);
        for (const f of p.fields) {
          assert.ok(f.name.length > 0 && f.name.length <= 256);
          assert.ok(f.value.length > 0 && f.value.length <= 1024, `${kind}/${style}: field value ${f.value.length}`);
        }
      }
    }
  }
});

test('compact is shorter than full; every full field is titled', () => {
  for (const kind of ADHKAR_KINDS) {
    const full = renderAdhkarPages(kind);
    const compact = renderAdhkarPages(kind, { style: 'compact' });
    assert.ok(allText(compact).length < allText(full).length);
    for (const p of full) for (const f of p.fields) assert.ok(/\S{2,}/.test(f.name.replace(/[①-⑳📖\d.\s]/gu, '')), `untitled field: ${f.name}`);
  }
});

test('morning and evening sets differ and unknown kind throws', () => {
  const m = allText(renderAdhkarPages('morning'));
  const e = allText(renderAdhkarPages('evening'));
  assert.ok(m.includes('أَصْبَحْنَا') && !m.includes('أَمْسَيْنَا وَأَمْسَى'));
  assert.ok(e.includes('أَمْسَيْنَا وَأَمْسَى'));
  assert.throws(() => renderAdhkarPages('noon'));
});

test('parseTime accepts H:MM, HH:MM and Arabic digits; rejects junk', () => {
  assert.equal(parseTime('6:30'), '06:30');
  assert.equal(parseTime('17:05'), '17:05');
  assert.equal(parseTime('٠٦:٣٠'), '06:30');
  for (const bad of ['24:00', '6', '12:60', 'abc', '', null]) assert.equal(parseTime(bad), null);
});

test('isValidTimeZone', () => {
  assert.ok(isValidTimeZone('Africa/Algiers'));
  assert.ok(isValidTimeZone('UTC'));
  assert.ok(!isValidTimeZone('Mars/Base'));
  assert.ok(!isValidTimeZone(''));
});

test('localClock follows the timezone', () => {
  const t = new Date('2026-10-05T20:04:00Z');
  assert.deepEqual(localClock('UTC', t), { date: '2026-10-05', minutes: 20 * 60 + 4 });
  assert.deepEqual(localClock('Asia/Riyadh', t), { date: '2026-10-05', minutes: 23 * 60 + 4 });
  assert.deepEqual(localClock('Asia/Riyadh', new Date('2026-10-05T21:30:00Z')), { date: '2026-10-06', minutes: 30 });
});

test('dueSlots: fires inside the window, once per local day, never early or too late', () => {
  const cfg = { timezone: 'UTC', morningTime: '06:00', eveningTime: '17:00' };
  const at = (hhmm) => new Date(`2026-10-05T${hhmm}:00Z`);
  assert.deepEqual(dueSlots(cfg, at('05:59')), []);
  assert.deepEqual(dueSlots(cfg, at('06:00')), [{ slot: 'morning', date: '2026-10-05' }]);
  assert.deepEqual(dueSlots(cfg, at('07:59')), [{ slot: 'morning', date: '2026-10-05' }]);   // catch-up after restart
  assert.deepEqual(dueSlots(cfg, at('08:00')), []);                                            // window over
  assert.deepEqual(dueSlots(cfg, at('17:30')), [{ slot: 'evening', date: '2026-10-05' }]);
  assert.deepEqual(dueSlots({ ...cfg, lastMorning: '2026-10-05' }, at('06:30')), []);          // already sent today
  assert.deepEqual(dueSlots({ ...cfg, lastMorning: '2026-10-04' }, at('06:30')), [{ slot: 'morning', date: '2026-10-05' }]);
  assert.equal(CATCHUP_MINUTES, 120);
});

test('dueSlots uses the guild timezone and defaults when fields are missing', () => {
  // 03:10 UTC = 06:10 in Riyadh → default morning 06:00 is due.
  assert.deepEqual(dueSlots({}, new Date('2026-10-05T03:10:00Z')), [{ slot: 'morning', date: '2026-10-05' }]);
  assert.deepEqual(dueSlots({ timezone: 'UTC' }, new Date('2026-10-05T03:10:00Z')), []);
});

test('dueSlots: a window that crosses midnight still fires after 00:00, attributed to yesterday', () => {
  const cfg = { timezone: 'UTC', morningTime: '23:30', eveningTime: '12:00' };
  assert.deepEqual(dueSlots(cfg, new Date('2026-10-05T23:45:00Z')), [{ slot: 'morning', date: '2026-10-05' }]);
  assert.deepEqual(dueSlots(cfg, new Date('2026-10-06T00:10:00Z')), [{ slot: 'morning', date: '2026-10-05' }]);
  assert.deepEqual(dueSlots({ ...cfg, lastMorning: '2026-10-05' }, new Date('2026-10-06T00:10:00Z')), []);   // already sent
  assert.deepEqual(dueSlots(cfg, new Date('2026-10-06T01:31:00Z')), []);                                      // window closed
});

test('every dhikr is wrapped in a quote block', () => {
  for (const kind of ADHKAR_KINDS) for (const p of renderAdhkarPages(kind)) for (const f of p.fields) {
    const body = f.value.split('\n').filter(l => !l.startsWith('🔁'));
    assert.ok(body[0].startsWith('> '), `${kind}: field "${f.name}" is not quoted`);
  }
});

// ── All-day posts ──
const seeded = (seed) => {
  const next = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < 5; i++) next();                      // consecutive seeds start out correlated — warm up
  return next;
};
const hm = (min) => min;                                    // minutes since midnight
const TIMES = { wake: 7 * 60, noon: 13 * 60, evening: 19 * 60, sleep: 22 * 60 + 30, night: 2 * 60 };

test('all-day post: one short field that fits Discord limits, every item has text and a title', () => {
  for (let n = 1; n <= 300; n++) {
    const { page, title } = renderScatterAdhkar({ rng: seeded(n) });
    assert.equal(page.fields.length, 1);
    assert.ok(pageSize(page) <= 6000);
    assert.ok(title.length > 0 && page.fields[0].value.startsWith('> '));
    assert.ok(page.fields[0].value.length <= 1024);
  }
  for (const c of scatterCandidates()) assert.ok(c.title && c.text && c.icon, `incomplete item: ${c.title}`);
});

test('all-day post: plenty of variety, and every category is represented', () => {
  const all = scatterCandidates();
  assert.ok(all.length >= 40);
  const icons = new Set(all.map(i => i.icon));
  for (const ic of ['📖', '📿', '🤲', '🌅', '🌙', '😴', '⏰']) assert.ok(icons.has(ic), `missing category ${ic}`);
  const seen = new Set();
  for (let n = 1; n <= 600; n++) seen.add(renderScatterAdhkar({ rng: seeded(n) }).title);
  assert.ok(seen.size >= 30, `only ${seen.size} different items appeared`);
});

test('all-day post: time of day decides what fits (no sleep dhikr at noon, no morning dhikr at night)', () => {
  const icons = (m) => new Set(scatterCandidates(m).map(i => i.icon));
  assert.ok(icons(TIMES.wake).has('⏰') && icons(TIMES.wake).has('🌅'));
  assert.ok(!icons(TIMES.wake).has('😴') && !icons(TIMES.wake).has('🌙'));
  for (const ic of ['⏰', '😴', '🌅', '🌙']) assert.ok(!icons(TIMES.noon).has(ic), `${ic} must not appear at noon`);
  assert.ok(icons(TIMES.evening).has('🌙') && !icons(TIMES.evening).has('🌅') && !icons(TIMES.evening).has('😴'));
  assert.ok(icons(TIMES.sleep).has('😴') && icons(TIMES.sleep).has('🌙') && !icons(TIMES.sleep).has('⏰'));
  assert.ok(icons(TIMES.night).has('😴') && !icons(TIMES.night).has('🌙') && !icons(TIMES.night).has('🌅'));
  // morning wording never appears in the evening and vice versa
  // («بك أصبحنا / بك أمسينا» name both times in the hadith itself, so those two are left out of the check)
  const BOTH = ['بك أصبحنا', 'بك أمسينا'];
  assert.deepEqual(scatterCandidates(TIMES.evening).filter(i => /أَصْبَحْ/.test(i.text) && !BOTH.includes(i.title)), [], 'morning wording in the evening');
  assert.deepEqual(scatterCandidates(TIMES.wake).filter(i => /أَمْسَ/.test(i.text) && !BOTH.includes(i.title)), [], 'evening wording in the morning');
  assert.deepEqual(scatterCandidates(TIMES.noon).filter(i => /أَصْبَحْ|أَمْسَ|أَصْبَحْت|أَمْسَيْت/.test(i.text)), [], 'morning/evening wording at noon');
});

test('all-day post: avoids the recent titles, and still works when everything is excluded', () => {
  let recent = [];
  for (let n = 1; n <= 100; n++) {
    const { title } = renderScatterAdhkar({ exclude: recent, rng: seeded(n * 31), minutes: TIMES.noon });
    assert.ok(!recent.includes(title), `"${title}" repeated`);
    recent = [...recent, title].slice(-8);
  }
  const everything = scatterCandidates(TIMES.noon).map(i => i.title);
  assert.ok(renderScatterAdhkar({ exclude: everything, minutes: TIMES.noon }).title);
});

test('scatterSettings clamps junk to safe values', () => {
  assert.deepEqual(scatterSettings({}), { from: 420, to: 1320, minGap: 60, maxGap: 90 });
  assert.equal(scatterSettings({ minGap: 5 }).minGap, 30);
  assert.equal(scatterSettings({ minGap: 9999, maxGap: 9999 }).maxGap, 360);
  assert.equal(scatterSettings({ minGap: 120, maxGap: 60 }).maxGap, 120);                         // max never below min
  assert.deepEqual(scatterSettings({ from: '20:00', to: '08:00' }).from, 420);                    // reversed window → defaults
  assert.deepEqual(scatterSettings({ from: '10:00', to: '11:00' }).to, 1320);                     // too short → defaults
  assert.deepEqual(scatterSettings({ minGap: 'abc', maxGap: null }), { from: 420, to: 1320, minGap: 60, maxGap: 90 });
});

test('scatterTimes: inside the window, gaps within min..max, stable, different per day and per server', () => {
  for (const [minGap, maxGap] of [[60, 90], [45, 45], [30, 120], [90, 180]]) {
    for (let d = 1; d <= 40; d++) {
      const args = { guildId: 'g1', date: `2026-10-${String(d % 28 + 1).padStart(2, '0')}`, from: 420, to: 1320, minGap, maxGap };
      const t = scatterTimes(args);
      assert.deepEqual(t, scatterTimes(args), 'same input must give the same times (restart-safe)');
      assert.ok(t.length >= Math.floor(900 / maxGap) - 1 && t.length <= Math.ceil(900 / minGap) + 1, `count ${t.length} for ${minGap}-${maxGap}`);
      assert.ok(t[0] >= 420 && t[0] <= 435);
      for (const x of t) assert.ok(x >= 420 && x <= 1320);
      for (let k = 1; k < t.length; k++) { const g = t[k] - t[k - 1]; assert.ok(g >= minGap && g <= maxGap, `gap ${g} outside ${minGap}-${maxGap}`); }
    }
  }
  const days = new Set(Array.from({ length: 20 }, (_, d) => scatterTimes({ guildId: 'g1', date: `2026-11-${String(d + 1).padStart(2, '0')}`, from: 420, to: 1320, minGap: 60, maxGap: 90 }).join()));
  assert.ok(days.size >= 18, 'times should differ from day to day');
  const base = { date: '2026-11-01', from: 420, to: 1320, minGap: 60, maxGap: 90 };
  assert.notDeepEqual(scatterTimes({ guildId: 'a', ...base }), scatterTimes({ guildId: 'b', ...base }));
  const defaults = scatterTimes({ guildId: 'g1', ...base });
  assert.ok(defaults.length >= 10 && defaults.length <= 15, `about hourly-to-90min over 15h, got ${defaults.length}`);
});

test('dueScatter: only when enabled, inside the catch-up window, once per index per local day, never near the full morning/evening posts', () => {
  const base = { timezone: 'UTC', morningTime: '06:00', eveningTime: '17:00', scatter: { enabled: true } };
  const all = scatterTimes({ guildId: 'g1', date: '2026-10-05', ...scatterSettings(base.scatter) });
  const at = (min) => new Date(Date.UTC(2026, 9, 5, Math.floor(min / 60), min % 60));
  const k = all.findIndex(t => Math.abs(t - 1020) >= SCATTER_AVOID && Math.abs(t - 360) >= SCATTER_AVOID);   // a normal one
  const t0 = all[k];

  assert.deepEqual(dueScatter('g1', { ...base, scatter: { enabled: false } }, at(t0)), []);
  assert.deepEqual(dueScatter('g1', base, at(t0 - 1)), []);
  assert.deepEqual(dueScatter('g1', base, at(t0)).map(x => x.index), [k]);
  assert.equal(dueScatter('g1', base, at(t0))[0].time, t0);
  assert.deepEqual(dueScatter('g1', base, at(t0 + SCATTER_CATCHUP - 1)).map(x => x.index), [k]);
  assert.deepEqual(dueScatter('g1', base, at(t0 + SCATTER_CATCHUP)), []);                                         // stale: dropped
  assert.deepEqual(dueScatter('g1', { ...base, scatter: { enabled: true, day: '2026-10-05', sent: [k] } }, at(t0 + 1)), []);       // already sent
  assert.deepEqual(dueScatter('g1', { ...base, scatter: { enabled: true, day: '2026-10-04', sent: [k] } }, at(t0 + 1)).map(x => x.index), [k]);   // new day
  assert.deepEqual(dueScatter('g1', { timezone: 'UTC' }, at(t0)), []);                                           // old documents without the field
  // a time that falls next to the morning/evening post is skipped
  for (const near of all.filter(t => Math.abs(t - 1020) < SCATTER_AVOID || Math.abs(t - 360) < SCATTER_AVOID)) assert.deepEqual(dueScatter('g1', base, at(near)), []);
  // over a whole day every non-skipped time fires exactly once and nothing fires twice at the same minute
  let fired = 0;
  for (let m = 0; m < 1440; m++) { const due = dueScatter('g1', base, at(m)); assert.ok(due.length <= 1); fired += due.length ? 1 : 0; }
  assert.ok(fired >= 8);
});

test('dueScatter follows the guild timezone', () => {
  const cfg = { timezone: 'Asia/Riyadh', morningTime: '03:00', eveningTime: '23:30', scatter: { enabled: true } };
  const [t] = scatterTimes({ guildId: 'g1', date: '2026-10-05', ...scatterSettings(cfg.scatter) });
  const utcMin = t - 180;                                       // Riyadh = UTC+3
  assert.equal(dueScatter('g1', cfg, new Date(Date.UTC(2026, 9, 5, Math.floor(utcMin / 60), utcMin % 60))).length, 1);
  assert.equal(dueScatter('g1', cfg, new Date(Date.UTC(2026, 9, 5, Math.floor(t / 60), t % 60))).length, 0);
});
