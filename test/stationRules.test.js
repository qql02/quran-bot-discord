import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, validName, normalizeUrl, isAudioContentType, parseValue, canManage } from '../src/services/stationRules.js';

test('names', () => {
  assert.equal(cleanName('  إذاعة \n  القرآن​ '), 'إذاعة القرآن');
  assert.ok(validName('ab')); assert.ok(!validName('a')); assert.ok(!validName('x'.repeat(61)));
});
test('urls', () => {
  assert.equal(normalizeUrl('https://a.com/live'), 'https://a.com/live');
  for (const bad of ['', 'ftp://a.com', 'file:///etc/passwd', 'javascript:1', 'not a url', 'https://u:p@a.com/x', 'https://a.com/' + 'x'.repeat(500)])
    assert.equal(normalizeUrl(bad), null, bad);
});
test('content types', () => {
  assert.ok(isAudioContentType('audio/mpeg')); assert.ok(isAudioContentType(null));
  assert.ok(isAudioContentType('application/vnd.apple.mpegurl')); assert.ok(isAudioContentType('application/ogg'));
  assert.ok(!isAudioContentType('text/html; charset=utf-8')); assert.ok(!isAudioContentType('application/json'));
});
test('values never mix scopes', () => {
  const id = 'a'.repeat(24);
  assert.deepEqual(parseValue(`g:${id}`), { kind: 'global', id });
  assert.deepEqual(parseValue(`s:${id}`), { kind: 'guild', id });
  assert.deepEqual(parseValue('123'), { kind: 'api', id: '123' });
  assert.equal(parseValue('s:zzz').kind, 'api');
});
test('permissions', () => {
  assert.ok(canManage({ scope: 'guild', hasManageGuild: true }));
  assert.ok(!canManage({ scope: 'guild' }));
  assert.ok(!canManage({ scope: 'global', hasManageGuild: true }));
  assert.ok(canManage({ scope: 'global', isOwner: true }));
});
