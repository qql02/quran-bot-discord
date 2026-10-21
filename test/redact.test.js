import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/utils/redact.js';

const TOKEN = 'MTUxMTM0MDA5NTkzNDgyNDU4OQ.G0I_Qg.' + 'a'.repeat(36);
test('bot tokens are hidden by shape', () => assert.ok(!redact(`login failed with ${TOKEN}`, {}).includes('aaaa')));
test('exact secret values are hidden', () => assert.equal(redact('x supersecretvalue1 y', { SESSION_SECRET: 'supersecretvalue1' }), 'x [hidden] y'));
test('database password is hidden in a URI and on its own', () => {
  const out = redact('connect mongodb+srv://bob:P4ssw0rd!@c0.mongodb.net/db failed; P4ssw0rd! rejected', { MONGODB_URI: 'mongodb+srv://bob:P4ssw0rd!@c0.mongodb.net/db' });
  assert.ok(!out.includes('P4ssw0rd'));
  assert.ok(out.includes('bob:'));
});
test('normal text is untouched', () => assert.equal(redact('Loaded command: /pull', {}), 'Loaded command: /pull'));
