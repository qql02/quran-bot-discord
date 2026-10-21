import test from 'node:test';
import assert from 'node:assert/strict';

const { answerIfStale } = await import('../src/events/interactionCreate.js');

const fake = (over = {}) => {
  const calls = [];
  return { calls, locale: 'en-US', replied: false, deferred: false, isRepliable: () => true,
    reply: async (p) => { calls.push(p); return {}; }, ...over };
};

test('an unanswered press gets a clear "expired" message instead of "interaction failed"', async () => {
  const i = fake();
  answerIfStale(i, { wait: 0 });
  assert.equal(i.calls.length, 1);
  assert.equal(i.calls[0].ephemeral, true);
  assert.match(i.calls[0].content, /\/help/);
});

test('the message follows the language of the Discord app (Arabic)', async () => {
  const i = fake({ locale: 'ar' });
  answerIfStale(i, { wait: 0 });
  assert.match(i.calls[0].content, /هذه اللوحة/);
});

test('an interaction that was answered, deferred or got a modal is never touched', async () => {
  for (const over of [{ replied: true }, { deferred: true }]) {
    const i = fake(over);
    answerIfStale(i, { wait: 0 });
    assert.equal(i.calls.length, 0);
  }
});

test('the delayed check re-reads the state: a handler that answers in time wins', async () => {
  const i = fake();
  answerIfStale(i, { wait: 30 });
  i.replied = true;                                   // the waiting code (collector) answered meanwhile
  await new Promise(r => setTimeout(r, 80));
  assert.equal(i.calls.length, 0);
});

test('the delayed check answers when nobody did', async () => {
  const i = fake();
  answerIfStale(i, { wait: 30 });
  await new Promise(r => setTimeout(r, 80));
  assert.equal(i.calls.length, 1);
});

test('a failing reply never throws', async () => {
  const i = fake({ reply: () => Promise.reject(new Error('10062')) });
  assert.doesNotThrow(() => answerIfStale(i, { wait: 0 }));
});

test('choosing "Pull the recitation to my room" in the tools menu obeys the owner\'s switch for /pull', async () => {
  const { componentCommands } = await import('../src/utils/restrictionRules.js');
  assert.deepEqual(componentCommands('panel:tool', ['pull']), ['pull']);
});
