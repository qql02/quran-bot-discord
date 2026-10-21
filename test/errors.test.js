import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserError, errorCode, classifyError } from '../src/utils/errors.js';

test('error codes have the E-XXXXXX shape', () => {
  assert.match(errorCode(new Error('boom'), 'cmd:recite'), /^E-[0-9A-F]{6}$/);
});

test('the same bug always gets the same code, even when ids / numbers / urls change', () => {
  const a = errorCode(new Error('Could not join voice channel within 20s (guild 123456789012345678)'), 'voice-join');
  const b = errorCode(new Error('Could not join voice channel within 30s (guild 987654321098765432)'), 'voice-join');
  assert.equal(a, b);
  assert.equal(errorCode(new Error('GET https://a.example/x failed'), 'w'), errorCode(new Error('GET https://b.example/y failed'), 'w'));
});

test('different places or different errors get different codes', () => {
  assert.notEqual(errorCode(new Error('boom'), 'cmd:recite'), errorCode(new Error('boom'), 'cmd:volume'));
  assert.notEqual(errorCode(new Error('boom'), 'w'), errorCode(new TypeError('boom'), 'w'));
  assert.notEqual(errorCode(new Error('one'), 'w'), errorCode(new Error('two'), 'w'));
});

test('UserError and capacity are explained to the user', () => {
  assert.deepEqual(classifyError(new UserError('voice_full', { limit: 5 })), { kind: 'user', key: 'voice_full', vars: { limit: 5 } });
  assert.equal(classifyError(Object.assign(new Error('x'), { code: 'CAPACITY' })).key, 'busy');
});

test('Discord permission errors are user-fixable, expired interactions are ignored', () => {
  assert.equal(classifyError(Object.assign(new Error('Missing Permissions'), { code: 50013 })).key, 'bot_missing_permissions');
  assert.equal(classifyError(Object.assign(new Error('Missing Access'), { code: 50001 })).key, 'bot_no_access');
  assert.equal(classifyError(Object.assign(new Error('Unknown interaction'), { code: 10062 })).kind, 'ignore');
  assert.equal(classifyError(Object.assign(new Error('already acknowledged'), { code: 40060 })).kind, 'ignore');
});

test('anything else is unexpected (a developer must look at it)', () => {
  assert.equal(classifyError(new Error('Cannot read properties of undefined')).kind, 'unexpected');
  assert.equal(classifyError(Object.assign(new Error('timeout'), { code: 'VOICE_JOIN_TIMEOUT' })).kind, 'unexpected');
  assert.equal(classifyError(null).kind, 'unexpected');
});
