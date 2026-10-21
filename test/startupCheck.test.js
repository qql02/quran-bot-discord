import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnv, tokenBotId } from '../src/utils/startupCheck.js';

const good = { DISCORD_TOKEN: 'MTUxMTM0MDA5NTkzNDgyNDU4OQ.abcdef.' + 'x'.repeat(30), CLIENT_ID: '1511340095934824589', MONGODB_URI: 'mongodb+srv://u:p@h/db' };
test('token carries the bot id', () => assert.equal(tokenBotId(good.DISCORD_TOKEN), '1511340095934824589'));
test('complete env: no errors', () => assert.equal(checkEnv(good).errors, 0));
test('missing required values are errors', () => assert.equal(checkEnv({}).errors, 3));
test('CLIENT_ID that does not match the token is an error', () => assert.ok(checkEnv({ ...good, CLIENT_ID: '1111111111111111111' }).errors >= 1));
test('empty ALT_BOT_ID warns, same-as-main errors', () => {
  assert.ok(checkEnv(good).lines.find(l => l.key === 'ALT_BOT_ID').level === 'warn');
  assert.equal(checkEnv({ ...good, ALT_BOT_ID: good.CLIENT_ID }).lines.find(l => l.key === 'ALT_BOT_ID').level, 'error');
});
test('secrets are masked', () => assert.ok(!checkEnv(good).lines.some(l => l.text.includes('x'.repeat(10)))));
