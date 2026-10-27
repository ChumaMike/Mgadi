import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

async function start(app) {
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  return `http://127.0.0.1:${app.address().port}`;
}

test('triage has security headers and uses safe rules', async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const base = await start(app);
  const response = await fetch(`${base}/api/triage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'We paid after changed banking details' }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.deepEqual(await response.json(), { label: 'payment_diversion', confidence: 0.9, source: 'rules' });
});

test('triage rejects cross-site and invalid requests', async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const base = await start(app);
  const crossSite = await fetch(`${base}/api/triage`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' });
  assert.equal(crossSite.status, 403);
  const nonJson = await fetch(`${base}/api/triage`, { method: 'POST', body: 'hello' });
  assert.equal(nonJson.status, 415);
});

test('invalid AI output falls back to rules', async (t) => {
  const app = createApp({ classifyWithAI: async () => ({ label: 'call this number', confidence: 1 }) });
  t.after(() => app.close());
  const base = await start(app);
  const response = await fetch(`${base}/api/triage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'We paid after changed banking details' }) });
  assert.equal((await response.json()).source, 'rules');
});
