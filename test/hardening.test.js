import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import express from 'express';
import {
  methodGuard, requireDashboardHeader, securityHeaders, sessionLifetimeGuard, userWriteLimiter,
  oauthStateFresh, signOauthState, verifyOauthState, readCookie, OAUTH_COOKIE, dbGuard, OAUTH_STATE_TTL_MS, tuneServer, SERVER_LIMITS, clip, ABSOLUTE_SESSION_MS
} from '../src/api/hardening.js';

// A real server on a throw-away port, with the same layers server.js uses.
async function boot({ session = null, limits = SERVER_LIMITS, max = () => 3, now } = {}) {
  const app = express();
  app.set('query parser', 'simple');
  app.use(methodGuard);
  app.use(securityHeaders("default-src 'self'"));
  app.use((req, _res, next) => { if (session) req.session = session; next(); });
  app.use('/api', sessionLifetimeGuard({ now }));
  app.use(requireDashboardHeader);
  app.use('/api/admin', userWriteLimiter({ max, now }));
  app.get('/api/q', (req, res) => res.json({ q: req.query.a ?? null, type: typeof req.query.a }));
  app.post('/api/admin/do', (_req, res) => res.json({ ok: true }));
  app.delete('/api/admin/do', (_req, res) => res.json({ ok: true }));
  const server = http.createServer({ connectionsCheckingInterval: 200 }, app);
  tuneServer(server, limits);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, port: server.address().port, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
const H = { 'x-requested-with': 'quran-bot-dashboard' };

test('only the methods the API uses are answered', async () => {
  const s = await boot();
  try {
    for (const m of ['PUT', 'PATCH', 'TRACE']) {
      const r = await fetch(`${s.base}/api/q`, { method: m }).catch(() => null);
      if (r) assert.equal(r.status, 405, m);          // (fetch itself refuses TRACE)
    }
    assert.equal((await fetch(`${s.base}/api/q`)).status, 200);
  } finally { await s.close(); }
});

test('a change without the dashboard header is refused, with it is accepted', async () => {
  const s = await boot({ session: { user: { id: '1', at: Date.now() } } });
  try {
    assert.equal((await fetch(`${s.base}/api/admin/do`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${s.base}/api/admin/do`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 403, 'a cross-site form / text/plain POST');
    assert.equal((await fetch(`${s.base}/api/admin/do`, { method: 'POST', headers: { 'x-requested-with': 'XMLHttpRequest' } })).status, 403, 'wrong value');
    assert.equal((await fetch(`${s.base}/api/admin/do`, { method: 'POST', headers: H })).status, 200);
    assert.equal((await fetch(`${s.base}/api/admin/do`, { method: 'DELETE' })).status, 403);
    assert.equal((await fetch(`${s.base}/api/q`)).status, 200, 'reading needs no header');
  } finally { await s.close(); }
});

test('security headers are on every answer', async () => {
  const s = await boot();
  try {
    const r = await fetch(`${s.base}/api/q`);
    for (const [k, v] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'], ['cross-origin-resource-policy', 'same-origin'], ['cross-origin-opener-policy', 'same-origin'], ['referrer-policy', 'same-origin'], ['cache-control', 'no-store']])
      assert.equal(r.headers.get(k), v, k);
    assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
    assert.ok(r.headers.get('content-security-policy'));
  } finally { await s.close(); }
});

test('query strings stay flat: `a[$ne]=x` is not an object', async () => {
  const s = await boot();
  try {
    const j = await (await fetch(`${s.base}/api/q?a[$ne]=x`)).json();
    assert.notEqual(j.type, 'object');
    assert.equal((await (await fetch(`${s.base}/api/q?a=hello`)).json()).q, 'hello');
  } finally { await s.close(); }
});

test('a session ends after its absolute lifetime even if it was used all the time', async () => {
  let t = 1_000_000;
  const session = { user: { id: '1', at: t }, destroyed: false, destroy(cb) { this.destroyed = true; this.user = undefined; cb(); } };
  const s = await boot({ session, now: () => t });
  try {
    assert.equal((await fetch(`${s.base}/api/q`)).status, 200);
    t += ABSOLUTE_SESSION_MS - 1000;
    assert.equal((await fetch(`${s.base}/api/q`)).status, 200, 'just inside the limit');
    t += 2000;
    assert.equal((await fetch(`${s.base}/api/q`)).status, 401);
    assert.equal(session.destroyed, true);
  } finally { await s.close(); }
  const old = { user: { id: '1' } };                           // a session from before the check: starts counting, is not thrown out
  let called = false;
  sessionLifetimeGuard({ now: () => 5 })({ session: old }, {}, () => { called = true; });
  assert.ok(called && old.user.at === 5);
});

test('writes are limited per account, reads are not, and the window resets', async () => {
  let t = 0;
  const s = await boot({ session: { user: { id: '7', at: 0 } }, max: () => 3, now: () => t });
  try {
    const post = () => fetch(`${s.base}/api/admin/do`, { method: 'POST', headers: H });
    for (let i = 0; i < 3; i++) assert.equal((await post()).status, 200);
    const r = await post();
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
    assert.equal((await fetch(`${s.base}/api/q`)).status, 200, 'reads are free');
    t += 60_001;
    assert.equal((await post()).status, 200, 'a new window');
  } finally { await s.close(); }
});

test('OAuth state expires', () => {
  const now = 10_000_000;
  assert.equal(oauthStateFresh({ nonce: 'x', at: now - 1000 }, now), true);
  assert.equal(oauthStateFresh({ nonce: 'x', at: now - OAUTH_STATE_TTL_MS - 1 }, now), false);
  assert.equal(oauthStateFresh({ nonce: 'x', at: now + 5000 }, now), false, 'from the future');
  assert.equal(oauthStateFresh({ nonce: 'x' }, now), false, 'an old-format state without a time');
  assert.equal(oauthStateFresh(undefined, now), false);
});

test('OAuth state is a signed cookie: tampering, another secret or a bad shape is refused', () => {
  const nonce = 'a'.repeat(32), secret = 's'.repeat(40);
  const v = signOauthState(secret, { nonce, at: 1_700_000_000_000 });
  assert.deepEqual(verifyOauthState(secret, v), { nonce, at: 1_700_000_000_000 });
  assert.equal(verifyOauthState('t'.repeat(40), v), null, 'another secret');
  assert.equal(verifyOauthState(secret, v.replace(/\.\d+\./, '.1700000000001.')), null, 'changed time');
  assert.equal(verifyOauthState(secret, `${'b'.repeat(32)}.${v.split('.').slice(1).join('.')}`), null, 'changed nonce');
  for (const bad of [undefined, '', 'x', 'a.b', `${nonce}.abc.mac`]) assert.equal(verifyOauthState(secret, bad), null);
});

test('readCookie picks one cookie out of a Cookie header', () => {
  assert.equal(readCookie('a=1; __Host-qb.oauth=xyz; b=2', OAUTH_COOKIE), 'xyz');
  assert.equal(readCookie('a=1', OAUTH_COOKIE), undefined);
  assert.equal(readCookie(undefined, OAUTH_COOKIE), undefined);
});

test('/auth/discord no longer writes to the session (anonymous visitors create no store document)', () => {
  const src = readFileSync(new URL('../src/api/server.js', import.meta.url), 'utf8');
  const start = src.indexOf("app.get('/auth/discord', authRateLimit");
  const block = src.slice(start, src.indexOf("app.get('/auth/discord/callback'"));
  assert.ok(!block.includes('req.session'), 'no req.session in the login-start handler');
  assert.ok(block.includes('signOauthState'));
});

test('a slow client that never finishes its headers is cut off (slowloris)', async () => {
  const s = await boot({ limits: { ...SERVER_LIMITS, headersTimeout: 600, requestTimeout: 1500 } });
  try {
    const t0 = Date.now();
    const out = await new Promise((resolve) => {
      const c = net.connect(s.port, '127.0.0.1', () => c.write('GET /api/q HTTP/1.1\r\nHost: x\r\nX-Slow: '));
      let first = '';
      c.on('data', d => { first ||= String(d).split('\r\n')[0]; });
      c.on('close', () => resolve({ ms: Date.now() - t0, first }));
    });
    assert.ok(out.ms < 4000, `closed after ${out.ms} ms`);
    assert.match(out.first, /408/);
  } finally { await s.close(); }
});

test('headers beyond the limit are dropped, so an oversized request fails closed (the dashboard header is lost → 403)', async () => {
  const s = await boot();
  try {
    const lines = Array.from({ length: 120 }, (_, i) => `x-f${i}: 1`).join('\r\n');
    const status = await new Promise((resolve) => {
      const c = net.connect(s.port, '127.0.0.1', () => c.write(`POST /api/admin/do HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n${lines}\r\nX-Requested-With: quran-bot-dashboard\r\nConnection: close\r\n\r\n`));
      let got = '';
      c.on('data', d => { got += d; });
      c.on('close', () => resolve(got.split('\r\n')[0]));
    });
    assert.match(status, / 403 /);
    const ok = await fetch(`${s.base}/api/admin/do`, { method: 'POST', headers: H });   // the same request, normal size
    assert.equal(ok.status, 200);
  } finally { await s.close(); }
});

test('log text is cleaned of control characters and cut', () => {
  assert.equal(clip('a\nb\r\nc'), 'a?b??c');
  assert.equal(clip('x'.repeat(500), 50).length, 50);
  assert.equal(clip('مرحبا'), 'مرحبا');
  assert.equal(clip(undefined), '');
});

test('server.js wires every layer and the dashboard sends the header', () => {
  const src = readFileSync(new URL('../src/api/server.js', import.meta.url), 'utf8');
  for (const needle of ['methodGuard', 'securityHeaders(CSP)', 'requireDashboardHeader', 'sessionLifetimeGuard()', 'userWriteLimiter', 'oauthStateFresh(expected)', 'tuneServer(server)', "'query parser', 'simple'", "SESSION_COOKIE = '__Host-", 'dotfiles: \'deny\''])
    assert.ok(src.includes(needle), needle);
  assert.ok(src.indexOf('app.use(requireDashboardHeader)') > src.indexOf('app.use(session('), 'the header check runs after the session middleware');
  const app = readFileSync(new URL('../dashboard/admin/app.js', import.meta.url), 'utf8');
  assert.equal((app.match(/X-Requested-With': 'quran-bot-dashboard/g) ?? []).length, 2, 'apiFetch and logout both send it');
  assert.equal((app.match(/\bfetch\(/g) ?? []).length, 2, 'no other fetch bypasses apiFetch');
  const owner = readFileSync(new URL('../dashboard/admin/owner.js', import.meta.url), 'utf8');
  const control = readFileSync(new URL('../dashboard/admin/control.js', import.meta.url), 'utf8');
  const phase5 = readFileSync(new URL('../dashboard/admin/phase5.js', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\(/.test(owner) && !/\bfetch\(/.test(control) && !/\bfetch\(/.test(phase5), 'owner.js, control.js and phase5.js go through apiFetch');
});

test('dbGuard: answers 503 at once while the database is down, passes through when it is up', async () => {
  let up = false;
  const app = express();
  app.use(dbGuard(() => up));
  app.get('/api/x', (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/x`;
  try {
    const t = Date.now();
    const down = await fetch(url);
    assert.equal(down.status, 503);
    assert.equal(down.headers.get('retry-after'), '5');
    assert.ok(Date.now() - t < 1000);
    up = true;
    assert.equal((await fetch(url)).status, 200);
  } finally { server.closeAllConnections?.(); await new Promise(r => server.close(r)); }
});
