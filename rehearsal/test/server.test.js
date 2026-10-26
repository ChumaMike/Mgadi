// PRACTICE BUILD, NOT THE ENTRY.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createApp } from '../server/app.js';

let server;
let base;
let aiCalls = 0;

before(async () => {
  // A stand-in AI that fails on the word "outage" and otherwise returns a bad label, so we
  // can see the server falling back to the rules and never passing bad output through.
  const ai = async (text) => {
    aiCalls += 1;
    if (text.includes('outage')) throw new Error('down');
    return null;
  };
  server = createApp({ ai, rateLimit: { limit: 5, windowMs: 60_000 } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (body, headers = {}) =>
  fetch(`${base}/api/triage`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

test('serves the app with strict security headers', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await res.text(), /PRACTICE BUILD, NOT THE HACKSECURE ENTRY/);
});

test('blocks path traversal and unknown file types', async () => {
  for (const p of ['/..%2f..%2fpackage.json', '/../server.js', '/%2e%2e/server/app.js', '/shared/../../server.js']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404, p);
  }
});

test('triage returns only label, confidence and source, and falls back to rules', async () => {
  const res = await post(JSON.stringify({ text: 'We paid the new bank account the supplier emailed. They never got the money.' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['confidence', 'label', 'source']);
  assert.equal(body.label, 'payment_diversion');
  assert.equal(body.source, 'rules');
});

test('an AI outage still gives an answer', async () => {
  const res = await post(JSON.stringify({ text: 'outage test: we paid the new account from the email' }));
  assert.equal((await res.json()).source, 'rules');
});

test('rejects oversize bodies, non-JSON and cross-site calls', async () => {
  assert.equal((await post(JSON.stringify({ text: 'x'.repeat(20_000) }))).status, 413);
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post('{}')).status, 400);
  const plain = await fetch(`${base}/api/triage`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(plain.status, 415);
  assert.equal((await post('{}', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('rate limits each client', async () => {
  let last;
  for (let i = 0; i < 8; i++) last = await post(JSON.stringify({ text: `case ${i}` }));
  assert.equal(last.status, 429);
});

test('no innerHTML-style sinks in the browser code', async () => {
  const dirs = ['public', 'public/shared'];
  for (const dir of dirs) {
    for (const f of await readdir(new URL(`../${dir}/`, import.meta.url))) {
      if (!f.endsWith('.js')) continue;
      const src = await readFile(new URL(`../${dir}/${f}`, import.meta.url), 'utf8');
      assert.doesNotMatch(src, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, `${dir}/${f}`);
    }
  }
});
