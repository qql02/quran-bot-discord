import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Service (cache, dedupe, validation, failure cool-down) and handler (navigation, wird integration, ownership, errors)
// run against real discord.js builders and a local HTTP server standing in for api.alquran.cloud — in a plain Node process,
// because the fast suite stubs discord.js out.
test('Mushaf reader: service + handler against a local API (real discord.js, separate process)', () => {
  const script = fileURLToPath(new URL('./fixtures/mushaf.check.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ALL OK/);
});
