import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSupportedNode, nodeSupportProblem, MIN_NODE } from '../src/utils/nodeVersion.js';
import { readFileSync } from 'node:fs';

test('Node 22.12+ is supported, anything older is refused with a bilingual message', () => {
  for (const ok of ['22.12.0', 'v22.12.0', '22.12.1', '22.13.0', '22.22.2', '23.0.0', '24.1.0', '30.0.0']) assert.equal(isSupportedNode(ok), true, ok);
  for (const old of ['22.11.9', '22.0.0', '20.18.0', '18.20.4', 'v16.20.2', '21.7.3']) assert.equal(isSupportedNode(old), false, old);
  for (const junk of ['', 'abc', undefined, null, '22']) assert.equal(isSupportedNode(junk), false, String(junk));
  assert.equal(nodeSupportProblem('24.0.0'), null);
  const msg = nodeSupportProblem('18.20.4');
  assert.match(msg, /18\.20\.4/); assert.match(msg, /22\.12/); assert.match(msg, /Node\.js 22/); assert.match(msg, /قديم/);
});

test('the minimum in the code matches package.json "engines"', () => {
  const engines = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).engines.node;
  assert.equal(engines, `>=${MIN_NODE.join('.')}`);
});
