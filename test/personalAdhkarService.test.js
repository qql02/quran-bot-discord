import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The scheduler step runs against the real wird service and model class (fake in-memory queries), in a plain Node process.
test('personal adhkar delivery: once per day, race-safe, retried on network errors, DMs-closed switches off', () => {
  const script = fileURLToPath(new URL('./fixtures/personalAdhkar.check.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ALL OK/);
});
