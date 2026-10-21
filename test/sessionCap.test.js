import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSessionCap } from '../src/config.js';

test('1GB host: ffmpeg cap is well below the old default of 25', () => {
  assert.equal(safeSessionCap(1024), 14);
  assert.ok(safeSessionCap(1024) * 55 + 250 <= 1024);
});
test('WASM backend allows more sessions on the same RAM', () => {
  assert.ok(safeSessionCap(1024, 'wasm') > safeSessionCap(1024, 'ffmpeg'));
});
test('big hosts stay at 25, tiny hosts never drop below 3, unknown memory keeps 25', () => {
  assert.equal(safeSessionCap(16000), 25);
  assert.equal(safeSessionCap(256), 3);
  assert.equal(safeSessionCap(null), 25);
});
