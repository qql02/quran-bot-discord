import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeControl, globalBlockedBy, buildControlPatch, modCan, isFeatureOn, FEATURES, MOD_CAP_KEYS, DEFAULT_MOD_CAPS
} from '../src/utils/botControl.js';

const known = new Set(['recite', 'help', 'mushaf', 'wird', 'adhkar']);
const opts = { knownCommands: known, maxQueueGlobal: 100 };

test('normalizeControl: empty / garbage input means "nothing restricted" and moderators keep every old right', () => {
  const c = normalizeControl(null);
  assert.deepEqual(c.disabledCommands, []);
  assert.deepEqual(c.disabledFeatures, []);
  assert.equal(c.maxQueue, null);
  assert.equal(c.locked, false);
  assert.deepEqual(c.modCaps, DEFAULT_MOD_CAPS);
  const d = normalizeControl({ disabledCommands: ['ok', 5, '$bad', 'x'.repeat(40)], disabledFeatures: ['voice', 'nope'], maxQueue: 0, modCaps: { play: false, hack: false, stop: 'no' } });
  assert.deepEqual(d.disabledCommands, ['ok']);
  assert.deepEqual(d.disabledFeatures, ['voice']);
  assert.equal(d.maxQueue, null);
  assert.equal(d.modCaps.play, false);
  assert.equal(d.modCaps.stop, true);            // not a boolean → default
  assert.ok(!('hack' in d.modCaps));
});

test('globalBlockedBy: disabled command, disabled feature (commands + buttons), none', () => {
  const c = normalizeControl({ disabledCommands: ['setup'], disabledFeatures: ['mushaf', 'voice'] });
  assert.equal(globalBlockedBy(c, { kind: 'command', name: 'setup' }), 'global-command');
  assert.equal(globalBlockedBy(c, { kind: 'autocomplete', name: 'setup' }), 'global-command');
  assert.equal(globalBlockedBy(c, { kind: 'command', name: 'start' }), 'global-feature');            // voice feature covers /start
  assert.equal(globalBlockedBy(c, { kind: 'component', customId: 'mushaf:next:3' }), 'global-feature');
  assert.equal(globalBlockedBy(c, { kind: 'component', customId: 'panel:skip' }), 'global-feature');   // voice feature covers the player panel
  assert.equal(globalBlockedBy(c, { kind: 'command', name: 'help' }), null);
  assert.equal(globalBlockedBy(c, { kind: 'component', customId: 'wird:open' }), null);
});

test('globalBlockedBy: global lock refuses commands and buttons, but keeps info commands and wird / mushaf buttons; expires by itself', () => {
  const now = 1_000_000;
  const c = normalizeControl({ locked: true, lockedUntil: now + 60_000 });
  assert.equal(globalBlockedBy(c, { kind: 'command', name: 'start', now }), 'global-locked');
  assert.equal(globalBlockedBy(c, { kind: 'command', name: 'help', now }), null);
  assert.equal(globalBlockedBy(c, { kind: 'component', customId: 'panel:skip', now }), 'global-locked');
  assert.equal(globalBlockedBy(c, { kind: 'component', customId: 'wird:open', now }), null);
  assert.equal(globalBlockedBy(c, { kind: 'command', name: 'start', now: now + 61_000 }), null);   // lock ended, nothing had to run
});

test('feature switches: jobs and defaults', () => {
  const c = normalizeControl({ disabledFeatures: ['adhkar'] });
  assert.equal(isFeatureOn(c, 'adhkar'), false);
  assert.equal(isFeatureOn(c, 'ayah'), true);
  for (const k of ['adhkar', 'ayah', 'wird', 'events', 'welcome']) assert.ok(FEATURES[k].jobs?.includes(k), `${k} has its job`);
});

test('modCan: every capability is allowed by default and can be switched off one by one', () => {
  for (const k of MOD_CAP_KEYS) assert.equal(modCan(normalizeControl(null), k), true);
  const c = normalizeControl({ modCaps: { queue: false } });
  assert.equal(modCan(c, 'queue'), false);
  assert.equal(modCan(c, 'play'), true);
  assert.equal(modCan(null, 'play'), true);
});

test('buildControlPatch: validates every field and refuses anything unknown', () => {
  assert.ok(buildControlPatch({}, opts).error);
  assert.ok(buildControlPatch({ disabledCommands: ['nope'] }, opts).error);
  assert.ok(buildControlPatch({ disabledCommands: 'recite' }, opts).error);
  assert.ok(buildControlPatch({ disabledFeatures: ['voice', 'bogus'] }, opts).error);
  assert.ok(buildControlPatch({ maxQueue: 0 }, opts).error);
  assert.ok(buildControlPatch({ maxQueue: 101 }, opts).error);
  assert.ok(buildControlPatch({ maxQueue: 1.5 }, opts).error);
  assert.ok(buildControlPatch({ locked: 'yes' }, opts).error);
  assert.ok(buildControlPatch({ locked: true, minutes: -3 }, opts).error);
  assert.ok(buildControlPatch({ modCaps: { play: 'yes' } }, opts).error);
  assert.ok(buildControlPatch({ modCaps: { shell: true } }, opts).error);
  assert.ok(buildControlPatch({ modCaps: [] }, opts).error);

  const ok = buildControlPatch({ disabledCommands: ['recite', 'recite'], disabledFeatures: ['mushaf'], maxQueue: 20, note: '  صيانة  ', modCaps: { play: false } }, opts);
  assert.deepEqual(ok.patch.disabledCommands, ['recite']);
  assert.deepEqual(ok.patch.disabledFeatures, ['mushaf']);
  assert.equal(ok.patch.maxQueue, 20);
  assert.equal(ok.patch.note, 'صيانة');
  assert.deepEqual(ok.patch.modCaps, { play: false });
  assert.equal(buildControlPatch({ maxQueue: null }, opts).patch.maxQueue, null);
});

test('buildControlPatch: lock with and without a timer; unlock clears the end time', () => {
  const now = 5_000_000;
  const timed = buildControlPatch({ locked: true, minutes: 30 }, { ...opts, now });
  assert.equal(timed.patch.locked, true);
  assert.equal(timed.patch.lockedUntil.getTime(), now + 30 * 60_000);
  assert.equal(buildControlPatch({ locked: true }, { ...opts, now }).patch.lockedUntil, null);
  const un = buildControlPatch({ locked: false, minutes: 30 }, { ...opts, now });
  assert.equal(un.patch.locked, false);
  assert.equal(un.patch.lockedUntil, null);
});
