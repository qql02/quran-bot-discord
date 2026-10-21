import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Real discord.js builders + a fake Discord API, in a plain Node process (the fast suite stubs discord.js out).
test('deploy: one place only, no re-deploy when unchanged, planned order (real discord.js, separate process)', () => {
  const script = fileURLToPath(new URL('./fixtures/commandDeploy.check.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ALL OK/);
});
