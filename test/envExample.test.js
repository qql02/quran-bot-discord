import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guards against drift: when a new setting is added to config.js it must also be documented in .env.example,
// otherwise nobody hosting the bot would ever know it exists.
test('.env.example documents every variable config.js reads and contains no secrets', () => {
  const cfg = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
  const ex  = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const used = [...new Set([...cfg.matchAll(/(?:raw|str|int|bool|url|oneOf|snowflake|snowflakeList|required)\('([A-Z][A-Z0-9_]+)'/g)].map(m => m[1]))];
  assert.ok(used.length > 25, `found ${used.length} variables in config.js`);
  const missing = used.filter(k => !new RegExp(`^#?\\s*${k}=`, 'm').test(ex));
  assert.deepEqual(missing, [], `not documented in .env.example: ${missing.join(', ')}`);

  // Values that must be left blank for the user to fill in.
  for (const k of ['DISCORD_TOKEN', 'CLIENT_ID', 'MONGODB_URI', 'SESSION_SECRET', 'DISCORD_CLIENT_SECRET', 'ADMIN_IDS']) {
    const line = ex.split('\n').find(l => l.startsWith(`${k}=`));
    assert.ok(line, `${k} present`);
    assert.equal(line.slice(k.length + 1).split('#')[0].trim(), '', `${k} must be empty in the example`);
  }
});
