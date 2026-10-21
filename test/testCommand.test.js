import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The /owner command renders real Discord.js builders (modals, embeds), which the fast suite stubs out — so the checks
// run in a plain Node process against the real library.
test('/owner command: owner-only, previews and delivery path (real discord.js, separate process)', () => {
  const script = fileURLToPath(new URL('./fixtures/testCommand.check.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ALL OK/);
});
