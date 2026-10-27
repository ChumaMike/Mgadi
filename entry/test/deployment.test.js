import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import triage from '../api/triage.js';
import health from '../api/health.js';
import { seal, randomId, randomToken, newKey, tokenHash } from '../public/shared/seal.js';

async function start(t, handler) {
  const app = http.createServer(handler);
  t.after(() => app.close());
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  return `http://127.0.0.1:${app.address().port}`;
}

test('deployment triage adapter handles raw requests and rejects unsupported methods', async (t) => {
  const base = await start(t, triage);
  const result = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'We paid after changed banking details.' }) });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { label: 'payment_diversion', confidence: 0.9, source: 'rules' });
  assert.equal((await fetch(base)).status, 405);
});

test('deployment adapter accepts pre-parsed bodies and enforces size/cross-site checks', async (t) => {
  const base = await start(t, (req, res) => {
    req.body = req.headers['x-test-large'] ? { text: 'x'.repeat(9000) } : { text: 'We paid after changed banking details.' };
    return triage(req, res);
  });
  const send = (headers = {}) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await send()).status, 200);
  assert.equal((await send({ 'x-test-large': '1' })).status, 413);
  assert.equal((await send({ 'sec-fetch-site': 'cross-site' })).status, 403);
});

test('hosted health adapter reports rules-only and preserves no-store/security headers', async (t) => {
  const base = await start(t, health);
  const response = await fetch(base);
  assert.deepEqual(await response.json(), { ok: true, ai: false });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
});

test('hosted links adapter: works with a store, answers 503 on Vercel without a shared store, and keeps the no-store and security headers', async (t) => {
  const post = (base, body) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const id = randomId(); const key = newKey(); const sealed = await seal({ note: 'synthetic' }, { key, kind: 'check', id });
  const body = { op: 'create', kind: 'check', id, oh: await tokenHash(randomToken()), ch: await tokenHash(randomToken()), ...sealed };
  const local = await start(t, (await import('../api/links.js?local')).default);
  const made = await post(local, body); assert.equal(made.status, 201);
  assert.equal(made.headers.get('cache-control'), 'no-store'); assert.match(made.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(local)).status, 405, 'POST only');
  // The adapter reads its environment when it is loaded, as a serverless function does. Load it as Vercel would, with no shared store.
  const names = ['VERCEL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']; const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  let hosted;
  try { for (const n of names) delete process.env[n]; process.env.VERCEL = '1'; hosted = (await import('../api/links.js?hosted')).default; }
  finally { for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } }
  const refused = await post(await start(t, hosted), body);
  assert.equal(refused.status, 503); assert.deepEqual(await refused.json(), { error: 'links_unavailable' });
});
