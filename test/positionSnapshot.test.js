import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { SessionSnapshot } = await import('../src/models/SessionSnapshot.js');

test('the saved snapshot carries the exact position and the recording, so a restart continues mid-surah', async () => {
  const seen = [];
  const orig = SessionSnapshot.findOneAndUpdate;
  SessionSnapshot.findOneAndUpdate = async (filter, update) => { seen.push(update); return {}; };
  try {
    await SessionSnapshot.save({
      guildId: '1', voiceChannelId: '2', channelName: 'r', ownerId: '3', fullQuran: false, loop: false, language: 'ar',
      player: { positionMs: () => 5_000 },
      current: { reciter: 'R', surah: { number: 18 }, riwaya: 'Hafs', url: 'https://x/018.mp3', offsetMs: 60_000, reciterObj: { id: 7 } }
    });
  } finally { SessionSnapshot.findOneAndUpdate = orig; }
  assert.equal(seen[0].positionMs, 65_000);
  assert.equal(seen[0].url, 'https://x/018.mp3');
  assert.equal(seen[0].surahNumber, 18);
});
