import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReligiousEvent } from '../src/models/ReligiousEvent.js';
import { CustomStation } from '../src/models/CustomStation.js';
import { GuildSettings } from '../src/models/GuildSettings.js';

// The panels are stateless: every press is checked on its own. These tests press the buttons the way a stranger would.
const perms = (manage) => ({ has: () => manage });
const fake = (over = {}) => {
  const calls = [];
  const i = {
    guildId: 'g1', guild: { id: 'g1', channels: { cache: new Map() }, roles: { cache: new Map() } },
    user: { id: 'u1' }, memberPermissions: perms(false), client: {},
    isModalSubmit: () => false, customId: '', values: [],
    reply: async (x) => { calls.push(['reply', x]); }, update: async (x) => { calls.push(['update', x]); },
    deferUpdate: async () => { calls.push(['deferUpdate']); }, showModal: async () => { calls.push(['showModal']); },
    ...over
  };
  return { i, calls };
};
GuildSettings.getLanguage = async () => 'en';

test('without Manage Server every admin page refuses, and touches nothing', async () => {
  let touched = false;
  ReligiousEvent.findOne = () => { touched = true; return { lean: async () => null }; };
  ReligiousEvent.deleteOne = async () => { touched = true; };
  CustomStation.findOneAndDelete = async () => { touched = true; };
  const { handleEventsComponent } = await import('../src/panels/eventsPanel.js');
  const { handleStationsComponent } = await import('../src/panels/stationsPanel.js');
  const { handleHub } = await import('../src/panels/hub.js');
  const { handleAdhkarComponent } = await import('../src/panels/adhkarPanel.js');
  for (const [fn, id] of [
    [handleEventsComponent, 'events:delyes:' + 'a'.repeat(24)], [handleEventsComponent, 'events:add'],
    [handleStationsComponent, 'stations:del'], [handleStationsComponent, 'stations:add'],
    [handleHub, 'hub:go'], [handleHub, 'hub:wird:ch'], [handleHub, 'hub:lang:ar'],
    [handleAdhkarComponent, 'adhkar:toggle']
  ]) {
    const { i, calls } = fake({ customId: id, values: ['s:' + 'b'.repeat(24)] });
    await fn(i);
    assert.equal(calls.length, 1, id);
    assert.equal(calls[0][0], 'reply', id);                       // one private refusal, never an update/modal
  }
  assert.equal(touched, false);
});

test("an admin cannot reach another server's event: the lookup is always scoped to their own server", async () => {
  const seen = [];
  ReligiousEvent.findOne = (q) => { seen.push(q); return { lean: async () => null }; };
  ReligiousEvent.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) });
  ReligiousEvent.countDocuments = async () => 0;
  const { handleEventsComponent } = await import('../src/panels/eventsPanel.js');
  const { i, calls } = fake({ memberPermissions: perms(true), customId: 'events:test:' + 'c'.repeat(24) });
  await handleEventsComponent(i);
  assert.deepEqual(seen[0], { _id: 'c'.repeat(24), guildId: 'g1' });
  assert.equal(calls[0][0], 'update');                            // "not found" page, nothing was posted
  // a forged id that is not an ObjectId never reaches the database
  seen.length = 0;
  const f = fake({ memberPermissions: perms(true), customId: 'events:test:{"$ne":null}' });
  await handleEventsComponent(f.i);
  assert.equal(seen.length, 0);
});

test('station deletion: a server admin cannot delete a public station, only the owner can', async () => {
  const { handleStationsComponent } = await import('../src/panels/stationsPanel.js');
  let removed = false;
  CustomStation.findOneAndDelete = async () => { removed = true; return null; };
  CustomStation.find = () => ({ sort: () => ({ lean: async () => [] }), lean: async () => [] });
  CustomStation.countDocuments = async () => 0;
  const { i, calls } = fake({ memberPermissions: perms(true), customId: 'stations:del', values: ['g:' + 'd'.repeat(24)] });
  await handleStationsComponent(i);
  assert.equal(removed, false);
  assert.equal(calls[0][0], 'reply');
});

test('the idle panel is deleted after the wait only when nothing is playing, and never twice', async () => {
  const { cleanupIdlePanel, adoptPanel, IDLE_PANEL_MS } = await import('../src/utils/panelRegistry.js');
  assert.ok(IDLE_PANEL_MS >= 10 * 60 * 1000 && IDLE_PANEL_MS <= 2 * 60 * 60 * 1000);
  const deleted = [];
  const client = { channels: { cache: new Map([['c1', { messages: { delete: async (id) => { deleted.push(id); } } }]]) } };
  await adoptPanel(client, 'gi', { id: 'm1', channelId: 'c1' });
  assert.equal(await cleanupIdlePanel(client, 'gi', 'm0'), false);   // not the current panel any more
  assert.equal(await cleanupIdlePanel(client, 'gi', 'm1'), true);
  assert.deepEqual(deleted, ['m1']);
  assert.equal(await cleanupIdlePanel(client, 'gi', 'm1'), false);   // already gone
});

test('the reciter choice is saved and comes back after a restart; a fresh choice beats the saved one', async () => {
  const { setGuildReciterKey, getGuildReciterKey, setGuildCustomReciter, getGuildCustomReciter } = await import('../src/data/popular.js');
  const { saveReciterChoice, loadReciterChoice } = await import('../src/services/reciterPrefs.js');
  let stored = null;
  GuildSettings.findOneAndUpdate = async (_f, u) => { stored = u.$set; return {}; };
  setGuildCustomReciter('gp', 'Some Reciter');
  saveReciterChoice('gp');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(stored, { 'panel.reciterKey': null, 'panel.reciterName': 'Some Reciter' });
  GuildSettings.findOne = () => ({ lean: async () => ({ panel: { reciterKey: 'sudais', reciterName: null } }) });
  await loadReciterChoice('gq');                                   // "after a restart": nothing in memory yet
  assert.equal(getGuildReciterKey('gq'), 'sudais');
  setGuildCustomReciter('gr', 'Chosen Now');                       // chosen before the saved value arrives
  await loadReciterChoice('gr');
  assert.equal(getGuildCustomReciter('gr'), 'Chosen Now');
});
