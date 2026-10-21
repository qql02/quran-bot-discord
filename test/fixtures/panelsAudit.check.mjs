// Run with the REAL discord.js (no stubs):  node test/fixtures/panelsAudit.check.mjs
// The surah menu of the panel must stay on its page when the panel is redrawn (pause, volume, reciter…).
process.env.DISCORD_TOKEN='x';process.env.CLIENT_ID='1';process.env.MONGODB_URI='mongodb://x';process.env.SESSION_SECRET='s'.repeat(40);process.env.ADMIN_IDS='999';process.env.DISCORD_CLIENT_SECRET='x';
import assert from 'node:assert/strict';
const R = new URL('../../src/', import.meta.url).href;
const { buildPanelMessage } = await import(R + 'utils/panel.js');
const { surahPageOf } = await import(R + 'components/buttonHandler.js');

for (const page of [0, 1, 2, 3, 4]) {
  const card = buildPanelMessage(null, 'en', 'g1', page);
  assert.equal(surahPageOf({ components: card.components }), page, `builder objects, page ${page}`);
  // what discord.js gives back for a received message is the JSON-shaped version of the same tree
  const json = card.components.map(c => c.toJSON());
  assert.equal(surahPageOf({ components: json.map(function w(c) { return { customId: c.custom_id, components: (c.components ?? []).map(w) }; }) }), page, `received message, page ${page}`);
  console.log(`ok surah menu stays on page ${page + 1}`);
}
assert.equal(surahPageOf({ components: [] }), 0);
assert.equal(surahPageOf(null), 0);
console.log('all panel audit checks passed');
