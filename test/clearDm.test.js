import { test } from 'node:test';
import assert from 'node:assert/strict';

const { clearBotDms } = await import('../src/commands/clear.js');

/** A DM with `msgs` (newest first). `failIds` cannot be deleted. fetch honours `limit` and `before` like Discord. */
function makeDm(msgs, { failIds = [], goneIds = [], refuseUser = false } = {}) {
  const deleted = [];
  const all = msgs.map(([id, author]) => ({
    id, author: { id: author },
    delete: async () => {
      if (refuseUser && author !== 'bot') throw Object.assign(new Error('Cannot execute action on a DM channel'), { code: 50003 });
      if (goneIds.includes(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      if (failIds.includes(id)) throw new Error('boom');
      deleted.push(id);
    }
  }));
  const dm = { messages: { fetch: async ({ limit = 50, before } = {}) => {
    const start = before ? all.findIndex(m => m.id === before) + 1 : 0;
    const page = all.slice(start, start + limit);
    return Object.assign(new Map(page.map(m => [m.id, m])), { last: () => page.at(-1) });
  } } };
  // Map has .size and .values(); Collection-like .last() added above
  return { dm, deleted };
}
const clientOf = (dm) => ({ client: { user: { id: 'bot' } }, user: { id: 'me', createDM: async () => dm } });

test('/cleardm deletes the bot\'s messages AND the member\'s own', async () => {
  const { dm, deleted } = makeDm([['1', 'bot'], ['2', 'me'], ['3', 'bot'], ['4', 'me']]);
  const { client, user } = clientOf(dm);
  const r = await clearBotDms(client, user);
  assert.deepEqual(deleted.sort(), ['1', '2', '3', '4']);
  assert.deepEqual(r, { found: 4, deleted: 4, failed: 0, more: false, userFound: 2, userDeleted: 2, userBlocked: false });
});

test('/cleardm with includeUser:false touches only the bot\'s messages', async () => {
  const { dm, deleted } = makeDm([['1', 'bot'], ['2', 'me'], ['3', 'bot']]);
  const { client, user } = clientOf(dm);
  const r = await clearBotDms(client, user, { includeUser: false });
  assert.deepEqual(deleted.sort(), ['1', '3']);
  assert.equal(r.userFound, 0);
});

test('/cleardm: when Discord refuses the member\'s messages, it stops asking, still deletes every bot message, and says so', async () => {
  const msgs = Array.from({ length: 40 }, (_, i) => [String(i + 1), i % 2 ? 'me' : 'bot']);
  const { dm, deleted } = makeDm(msgs, { refuseUser: true });
  const { client, user } = clientOf(dm);
  const r = await clearBotDms(client, user);
  assert.equal(deleted.length, 20);                       // all of the bot's, none of the member's
  assert.equal(r.userBlocked, true);
  assert.equal(r.userDeleted, 0);
  assert.equal(r.failed, 0);                              // a refusal is not a failure to report as "could not delete"
});

test('/cleardm pages through more than 100 messages', async () => {
  const msgs = Array.from({ length: 250 }, (_, i) => [String(i + 1), 'bot']);
  const { dm, deleted } = makeDm(msgs);
  const { client, user } = clientOf(dm);
  const r = await clearBotDms(client, user);
  assert.equal(deleted.length, 250);
  assert.equal(r.more, false);
});

test('/cleardm stops at the per-run limit and says more remain', async () => {
  const msgs = Array.from({ length: 50 }, (_, i) => [String(i + 1), 'bot']);
  const { dm, deleted } = makeDm(msgs);
  const { client, user } = clientOf(dm);
  const r = await clearBotDms(client, user, { maxDelete: 20 });
  assert.equal(deleted.length, 20);
  assert.equal(r.more, true);
});

test('/cleardm counts failures, and treats an already-deleted message as done', async () => {
  const { dm } = makeDm([['1', 'bot'], ['2', 'bot'], ['3', 'bot']], { failIds: ['2'], goneIds: ['3'] });
  const { client, user } = clientOf(dm);
  const r = await clearBotDms(client, user);
  assert.equal(r.found, 3);
  assert.equal(r.deleted, 2);
  assert.equal(r.failed, 1);
});

test('/cleardm with an empty DM finds nothing', async () => {
  const { dm } = makeDm([]);
  const { client, user } = clientOf(dm);
  assert.deepEqual(await clearBotDms(client, user), { found: 0, deleted: 0, failed: 0, more: false, userFound: 0, userDeleted: 0, userBlocked: false });
});

test('/cleardm keeps the bot reply that belongs to the running command', async () => {
  const msgs = [['1', 'bot'], ['2', 'bot'], ['3', 'bot']];
  const { dm, deleted } = makeDm(msgs);
  dm.messages.fetch = ((orig) => async (o) => {
    const res = await orig(o);
    for (const m of res.values()) if (m.id === '1') m.interactionMetadata = { id: 'cmd-1' };
    return res;
  })(dm.messages.fetch);
  const { client, user } = clientOf(dm);
  const r = await clearBotDms(client, user, { keepInteractionId: 'cmd-1' });
  assert.deepEqual(deleted.sort(), ['2', '3']);
  assert.equal(r.found, 2);
});
