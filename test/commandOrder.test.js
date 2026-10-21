import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { COMMAND_ORDER, sortCommands } from '../src/data/commandOrder.js';

const dir = new URL('../src/commands/', import.meta.url);
const names = readdirSync(dir).filter(f => f.endsWith('.js')).map(f =>
  readFileSync(new URL(f, dir), 'utf8').match(/new SlashCommandBuilder\(\)\s*\.setName\('([^']+)'\)/)?.[1]);

test('every command file has a name, names are unique and lowercase', () => {
  assert.ok(names.every(Boolean));
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every(n => n === n.toLowerCase() && n.length <= 32));
});
test('every command is listed in COMMAND_ORDER, and nothing listed is missing', () => {
  assert.deepEqual([...names].sort(), [...COMMAND_ORDER].sort());
  assert.equal(new Set(COMMAND_ORDER).size, COMMAND_ORDER.length);
});
test('sortCommands: planned order first, unknown last A→Z, input untouched', () => {
  const input = [{ name: 'zeta' }, { name: 'help' }, { name: 'alpha' }, { name: 'start' }];
  assert.deepEqual(sortCommands(input).map(c => c.name), ['start', 'help', 'alpha', 'zeta']);
  assert.equal(input[0].name, 'zeta');
});
