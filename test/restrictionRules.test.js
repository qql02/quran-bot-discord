import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedBy, componentCommands, PANEL_ACTION_COMMANDS, normalizeRestrictions, isLocked, buildLockPatch, MAX_LOCK_MINUTES, VOICE_COMMANDS } from '../src/utils/restrictionRules.js';

const rs = (o = {}) => normalizeRestrictions(o);

test('no restrictions → nothing is blocked', () => {
  assert.equal(blockedBy(rs(), { kind: 'command', name: 'recite' }), null);
  assert.equal(blockedBy(rs(), { kind: 'component', customId: 'panel:pause' }), null);
  assert.equal(blockedBy(null, { kind: 'command', name: 'recite' }), null);
});

test('disabled commands are blocked (also autocomplete), others are not', () => {
  const r = rs({ disabledCommands: ['recite', 'live'] });
  assert.equal(blockedBy(r, { kind: 'command', name: 'recite' }), 'disabled');
  assert.equal(blockedBy(r, { kind: 'autocomplete', name: 'live' }), 'disabled');
  assert.equal(blockedBy(r, { kind: 'command', name: 'mushaf' }), null);
});

test('locked server: only info commands and reading buttons work', () => {
  const r = rs({ locked: true });
  for (const name of ['help']) assert.equal(blockedBy(r, { kind: 'command', name }), null, name);
  assert.equal(blockedBy(r, { kind: 'command', name: 'start' }), 'locked');
  assert.equal(blockedBy(r, { kind: 'component', customId: 'panel:pause' }), 'locked');
  assert.equal(blockedBy(r, { kind: 'component', customId: 'mushaf:next:1' }), null);
  assert.equal(blockedBy(r, { kind: 'component', customId: 'wird:done' }), null);
  assert.equal(blockedBy(r, { kind: 'component', customId: 'menu:stats' }), null);                    // the /help menu stays usable
});

test('normalize: junk input becomes safe defaults', () => {
  const r = rs({ locked: 'yes', disabledCommands: ['a', 5, null], maxQueue: 0, note: 42 });
  assert.deepEqual(r, { locked: true, lockedUntil: null, disabledCommands: ['a'], maxQueue: null, note: '' });
  assert.equal(rs({ maxQueue: 7 }).maxQueue, 7);
  assert.equal(rs({ maxQueue: 2.5 }).maxQueue, null);
  assert.equal(rs({ note: 'x'.repeat(500) }).note.length, 200);
  assert.deepEqual(rs(undefined), { locked: false, lockedUntil: null, disabledCommands: [], maxQueue: null, note: '' });
});

test('voice preset only names real voice commands', () => {
  assert.ok(VOICE_COMMANDS.includes('start'));
  assert.ok(!VOICE_COMMANDS.includes('help'));
});

test('timed lock: applies until lockedUntil, then stops by itself', () => {
  const now = 1_000_000;
  const r = rs({ locked: true, lockedUntil: now + 60_000 });
  assert.equal(isLocked(r, now), true);
  assert.equal(blockedBy(r, { kind: 'command', name: 'recite', now }), 'locked');
  assert.equal(blockedBy(r, { kind: 'component', customId: 'panel:pause', now }), 'locked');
  assert.equal(isLocked(r, now + 60_000), false);                       // exactly at the end: released
  assert.equal(blockedBy(r, { kind: 'command', name: 'recite', now: now + 61_000 }), null);
  assert.equal(isLocked(rs({ locked: true }), now * 1000), true);       // no end → permanent
  assert.equal(isLocked(rs({ locked: false, lockedUntil: now + 5 }), now), false);
  assert.equal(isLocked(null), false);
});

test('lockedUntil accepts a Date (from Mongo) or a number, rejects junk', () => {
  const d = new Date(5_000_000);
  assert.equal(rs({ lockedUntil: d }).lockedUntil, 5_000_000);
  assert.equal(rs({ lockedUntil: 7 }).lockedUntil, 7);
  for (const bad of ['soon', NaN, -4, 0, {}, null]) assert.equal(rs({ lockedUntil: bad }).lockedUntil, null, String(bad));
});

test('buildLockPatch: lock for N minutes, lock for good, unlock, bad input', () => {
  const now = 10_000_000;
  const a = buildLockPatch(true, 60, now);
  assert.equal(a.until, now + 3_600_000);
  assert.equal(a.patch['restrictions.locked'], true);
  assert.equal(a.patch['restrictions.lockedUntil'].getTime(), now + 3_600_000);
  const b = buildLockPatch(true, null, now);
  assert.equal(b.until, null); assert.equal(b.patch['restrictions.lockedUntil'], null);
  const c = buildLockPatch(false, 60, now);                              // minutes are ignored when unlocking
  assert.deepEqual(c.patch, { 'restrictions.locked': false, 'restrictions.lockedUntil': null });
  for (const m of [0, -5, 1.5, '30', MAX_LOCK_MINUTES + 1]) assert.ok(buildLockPatch(true, m, now).error, String(m));
  assert.equal(buildLockPatch(true, MAX_LOCK_MINUTES, now).error, undefined);
  assert.ok(buildLockPatch('yes', 5, now).error);
});

test('a disabled command also disables the panel button that does the same thing', () => {
  const r = rs({ disabledCommands: ['khatma', 'volume', 'leave'] });
  assert.equal(blockedBy(r, { kind: 'component', customId: 'panel:khatma' }), 'disabled');
  assert.equal(blockedBy(r, { kind: 'component', customId: 'panel:fullquran' }), 'disabled', 'old panels');
  for (const a of ['vol_down', 'vol_up', 'vol_50', 'vol_100']) assert.equal(blockedBy(r, { kind: 'component', customId: `panel:${a}` }), 'disabled', a);
  assert.equal(blockedBy(r, { kind: 'component', customId: 'panel:stop' }), 'disabled');
  assert.equal(blockedBy(r, { kind: 'component', customId: 'panel:skip' }), null, '/next is not disabled');
  assert.equal(blockedBy(r, { kind: 'component', customId: 'mushaf:next' }), null, 'other namespaces are untouched');
});

test('the "more tools" menu is judged by the value picked', () => {
  const r = rs({ disabledCommands: ['sleep'] });
  assert.equal(blockedBy(r, { kind: 'component', customId: 'panel:tool', values: ['sleep'] }), 'disabled');
  assert.equal(blockedBy(r, { kind: 'component', customId: 'panel:tool', values: ['mem'] }), null);
  assert.deepEqual(componentCommands('panel:tool', ['radio']), ['live']);
  assert.deepEqual(componentCommands('panel:unknown_action'), []);
});

test('every command named in the panel map is a real command file', async () => {
  const { readdirSync } = await import('node:fs');
  const files = new Set(readdirSync(new URL('../src/commands/', import.meta.url)).map(f => f.replace(/\.js$/, '')));
  for (const [a, cmds] of Object.entries(PANEL_ACTION_COMMANDS)) for (const c of cmds) assert.ok(files.has(c), `${a} → ${c}`);
});
