// Run with the REAL discord.js (no test stubs):  node test/fixtures/setupAndWird.check.mjs
// discord.js validates every builder on toJSON(): label / placeholder / option lengths, option counts, button limits…
import assert from 'node:assert/strict';
import { previewComponents } from '../../src/utils/setupUi.js';
import {
  roomPanelMessage, statusMessage, reminderMessage, savedMessage, expiringMessage, expiredMessage, inactiveMessage,
  deleteConfirmMessage, deletedMessage, subscribeModal, goalModal, pagesModal, khatmaMessage
} from '../../src/wird/ui/index.js';
import { SETUP_KEYS } from '../../src/data/setupLayout.js';

const json = (x) => (x?.toJSON ? x.toJSON() : x);
const sub = (lang) => ({
  userId: '42', lang, active: true, timezone: 'Africa/Algiers', remindMode: 'fixed', remindTime: '20:00', currentPage: 120, pagesPerDay: 5,
  goalDays: 30, goalDeadline: '2099-01-01', streak: 3, bestStreak: 4, khatmaCount: 1, totalPagesRead: 130, khatmaStartedAt: new Date(),
  expiresAt: new Date(Date.now() + 5 * 86_400_000), lastReadDate: null, dayPages: 0, dayDate: null
});

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok', name); };

for (const lang of ['ar', 'en']) {
  for (const selected of [SETUP_KEYS, ['ayah'], []]) {
    check(`setup picker ${lang} [${selected}]`, () => {
      const rows = previewComponents({ lang, selected }).map(json);
      assert.equal(rows.length, 2);
      const menu = rows[0].components[0];
      assert.equal(menu.options.length, 6);
      assert.equal(menu.min_values, 0); assert.equal(menu.max_values, 6);
      assert.equal(rows[1].components[0].disabled, selected.length === 0);
    });
  }
  check(`wird panel ${lang}`, () => { const m = roomPanelMessage(lang); json(m.embeds[0]); m.components.map(json); });
  check(`wird cards ${lang}`, () => {
    const s = sub(lang), now = new Date();
    for (const m of [statusMessage(s, now), statusMessage({ ...s, active: false }, now), reminderMessage(s, now), savedMessage(s, now),
      expiringMessage(s), expiredMessage(s), inactiveMessage(s), deleteConfirmMessage(lang), deletedMessage(lang), khatmaMessage(s)]) {
      m.embeds.map(json); (m.components ?? []).map(json);
    }
  });
  check(`wird modals ${lang}`, () => { json(subscribeModal(null, lang)); json(subscribeModal(sub(lang))); json(goalModal(lang)); json(pagesModal(sub(lang))); });
}
console.log(`\n${n} checks passed with the real discord.js`);
