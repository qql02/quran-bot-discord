import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyDelivery } from '../src/services/dailyPage.js';

const sub = (over = {}) => ({ userId: '123456789012345678', active: true, currentPage: 9, pagesPerDay: 5, timezone: 'UTC', expiresAt: new Date(Date.now() + 864e5 * 20), dayDate: null, dayPages: 0, ...over });
const page = (n) => ({ page: n, juz: 1, ayahs: [{ surah: 2, ayah: 1, text: 'الم' }] });

test('the daily delivery is the member\'s NEXT page, with the intro and today\'s count', async () => {
  const asked = [];
  const m = await buildDailyDelivery(sub(), new Date(), async (p) => { asked.push(p); return page(p); });
  assert.deepEqual(asked, [10], 'currentPage 9 → page 10');
  assert.match(m.content, /حان وقت وردك/);
  const e = m.embeds[0].data;
  assert.match(e.setFooter.text, /صفحة 10 من 604.*وردك اليوم 0\/5/);
  const en = await buildDailyDelivery(sub({ lang: 'en' }), new Date(), async (p) => page(p));
  assert.match(en.content, /time for your wird/);
});

test('whatever goes wrong, a reminder is still delivered (the classic text one)', async () => {
  const classic = (m) => assert.ok(m.embeds[0].data.setTitle.includes('حان وقت وردك اليوم'));
  classic(await buildDailyDelivery(sub(), new Date(), async () => null));                        // text service down
  classic(await buildDailyDelivery(sub(), new Date(), async () => { throw new Error('boom'); })); // anything unexpected
  const t0 = Date.now();
  classic(await buildDailyDelivery(sub(), new Date(), () => new Promise(() => {})));             // never answers → bounded wait
  assert.ok(Date.now() - t0 < 6000, 'a hung text service cannot stall the scheduler');
});
