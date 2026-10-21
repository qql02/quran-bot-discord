import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendAdhkar } from '../src/services/adhkarService.js';

const clientWhereFetchFails = (code) => ({
  guilds: { cache: { get: () => ({
    channels: { cache: new Map(), fetch: async () => { throw Object.assign(new Error('x'), { code }); } },
    members: { me: {} }, roles: { cache: new Map() }
  }) } }
});

test('a channel the bot cannot see is no_permission (not retried every minute), a deleted one is unknown_channel', async () => {
  assert.equal((await sendAdhkar(clientWhereFetchFails(10003), 'g', 'c', 'morning')).reason, 'unknown_channel');
  assert.equal((await sendAdhkar(clientWhereFetchFails(50001), 'g', 'c', 'morning')).reason, 'no_permission');
  assert.equal((await sendAdhkar(clientWhereFetchFails(50013), 'g', 'c', 'morning')).reason, 'no_permission');
});
test('an unexpected lookup error stays transient (send_failed) so it is retried', async () => {
  assert.equal((await sendAdhkar(clientWhereFetchFails(500), 'g', 'c', 'morning')).reason, 'send_failed');
});
