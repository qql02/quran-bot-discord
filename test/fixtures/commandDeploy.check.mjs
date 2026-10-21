// Run by test/commandDeploy.test.js in a plain Node process (real discord.js, fake Discord API).
import assert from 'node:assert/strict';
import { SlashCommandBuilder } from 'discord.js';
import { syncCommands, inspectCommands } from '../../src/utils/commandDeploy.js';

const APP = '111111111111111111', GUILD = '222222222222222222';

// A fake Discord: stores what each route holds and, like the real API, hands commands back with extra fields.
function fakeRest() {
  const store = new Map(), calls = [];
  const decorate = (c, i) => ({ ...c, id: String(i + 1), application_id: APP, version: '9', name_localizations: null,
    description_localizations: null, nsfw: false, contexts: [0, 1, 2], integration_types: [0],
    options: c.options?.map(o => ({ ...o, name_localizations: null, description_localizations: null })) });
  return {
    calls,
    async get(route) { calls.push(['GET', route]); return store.get(route) ?? []; },
    async put(route, { body }) { calls.push(['PUT', route, body.length]); store.set(route, body.map(decorate)); return store.get(route); },
    seed(route, cmds) { store.set(route, cmds.map(decorate)); },
  };
}
const R = { global: `/applications/${APP}/commands`, guild: `/applications/${APP}/guilds/${GUILD}/commands` };
const cmds = [
  new SlashCommandBuilder().setName('help').setDescription('h').toJSON(),
  new SlashCommandBuilder().setName('setup').setDescription('r')
    .addStringOption(o => o.setName('reciter').setDescription('who').setAutocomplete(true))
    .addIntegerOption(o => o.setName('from').setDescription('n').setMinValue(1).setMaxValue(114)).toJSON(),
  new SlashCommandBuilder().setName('start').setDescription('s').toJSON(),
  new SlashCommandBuilder().setName('zzz-new').setDescription('z').toJSON(),
];
const base = { token: 'x', appId: APP, guildId: GUILD, commands: cmds };
const puts = (rest) => rest.calls.filter(c => c[0] === 'PUT');

// 1) scope=global, the mother server still has its own copy → global gets the commands, the guild copy is emptied
{
  const rest = fakeRest(); rest.seed(R.guild, cmds);
  await syncCommands({ ...base, scope: 'global', rest });
  const after = await inspectCommands({ ...base, rest });
  assert.equal(after.global.length, 4); assert.equal(after.guild.length, 0); assert.deepEqual(after.duplicates, []);
}
// 2) scope=guild → only the mother server; global emptied
{
  const rest = fakeRest(); rest.seed(R.global, cmds);
  await syncCommands({ ...base, scope: 'guild', rest });
  const after = await inspectCommands({ ...base, rest });
  assert.equal(after.guild.length, 4); assert.equal(after.global.length, 0);
}
// 3) the order sent to Discord is the planned one (start, setup, help…), unknown names last
{
  const rest = fakeRest();
  await syncCommands({ ...base, scope: 'global', rest });
  const names = (await rest.get(R.global)).map(c => c.name);
  assert.deepEqual(names, ['start', 'setup', 'help', 'zzz-new']);
}
// 4) restart with nothing changed → NOTHING is sent (Discord's extra fields must not look like a change)
{
  const rest = fakeRest();
  await syncCommands({ ...base, scope: 'global', onlyIfChanged: true, rest });
  rest.calls.length = 0;
  await syncCommands({ ...base, scope: 'global', onlyIfChanged: true, rest });
  assert.equal(puts(rest).length, 0, JSON.stringify(rest.calls));
}
// 5) a real change (new description) IS sent, once
{
  const rest = fakeRest();
  await syncCommands({ ...base, scope: 'global', onlyIfChanged: true, rest });
  rest.calls.length = 0;
  const changed = cmds.map(c => c.name === 'help' ? { ...c, description: 'new text' } : c);
  await syncCommands({ ...base, commands: changed, scope: 'global', onlyIfChanged: true, rest });
  assert.equal(puts(rest).length, 1);
}
// 6) running the same deploy twice leaves exactly the same state (idempotent, never doubles)
{
  const rest = fakeRest();
  await syncCommands({ ...base, scope: 'global', rest });
  await syncCommands({ ...base, scope: 'global', rest });
  const after = await inspectCommands({ ...base, rest });
  assert.equal(after.global.length, 4); assert.equal(after.guild.length, 0);
}
// 7) guild scope without GUILD_ID is refused instead of silently deploying globally
await assert.rejects(() => syncCommands({ ...base, guildId: undefined, scope: 'guild', rest: fakeRest() }), /GUILD_ID/);
// 8) inspect reports a name that exists in both places
{
  const rest = fakeRest(); rest.seed(R.global, cmds); rest.seed(R.guild, cmds.slice(0, 2));
  assert.deepEqual((await inspectCommands({ ...base, rest })).duplicates, ['help', 'setup']);
}
console.log('ALL OK');
