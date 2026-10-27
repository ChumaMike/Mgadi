import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import triage from '../api/triage.js';
import health from '../api/health.js';

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
