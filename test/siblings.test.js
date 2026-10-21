import { test } from 'node:test';
import assert from 'node:assert/strict';

const { pickAdvice } = await import('../src/services/siblingService.js');

test('sibling already reciting in the member\'s room → use it', () => {
  const a = pickAdvice([{ id: 'B', busyChannelId: 'room1' }], 'room1');
  assert.deepEqual(a, { kind: 'sibling_here', bot: 'B' });
});

test('idle sibling in the server → use it', () => {
  const a = pickAdvice([{ id: 'B', busyChannelId: null }], 'room2');
  assert.deepEqual(a, { kind: 'sibling_free', bot: 'B' });
});

test('a free sibling is preferred over a busy one', () => {
  const a = pickAdvice([{ id: 'B', busyChannelId: 'x' }, { id: 'C', busyChannelId: null }], 'room2');
  assert.equal(a.bot, 'C');
});

test('all siblings busy elsewhere → says everyone is busy', () => {
  const a = pickAdvice([{ id: 'B', busyChannelId: 'x' }], 'room2');
  assert.deepEqual(a, { kind: 'all_busy', bots: ['B'] });
});

test('registry empty → ALT_BOT_ID fallback, else nothing', () => {
  assert.deepEqual(pickAdvice([], 'r', 'ALT'), { kind: 'sibling_free', bot: 'ALT' });
  assert.deepEqual(pickAdvice([], 'r', null), { kind: 'none' });
});

test('registry knowledge wins over the ALT_BOT_ID fallback', () => {
  const a = pickAdvice([{ id: 'B', busyChannelId: 'x' }], 'r', 'ALT');
  assert.equal(a.kind, 'all_busy');
});
