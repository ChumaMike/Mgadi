import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { seal, randomId, randomToken, newKey, tokenHash } from '../public/shared/seal.js';

async function serve(t, options = {}) {
  const server = createApp(options); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
function post(base, body, { path = '/api/links', method = 'POST', headers = { 'content-type': 'application/json' }, raw } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(base); const payload = raw ?? JSON.stringify(body);
    const request = http.request({ host: url.hostname, port: url.port, method, path, headers: { ...headers, ...(method === 'POST' ? { 'content-length': Buffer.byteLength(payload) } : {}) } }, (response) => {
      const chunks = []; response.on('data', (c) => chunks.push(c));
      response.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: response.statusCode, headers: response.headers, text, json }); });
    });
    request.setTimeout(5000, () => request.destroy(new Error('no answer'))); request.on('error', reject); if (method === 'POST') request.write(payload); request.end();
  });
}
async function newCheck(kind = 'check') {
  const ids = { id: randomId(), key: newKey(), owner: randomToken(), contact: randomToken() };
  const sealed = await seal({ supplier: 'SENTINEL-HTTP' }, { key: ids.key, kind, id: ids.id });
  return { ids, body: { op: 'create', kind, id: ids.id, oh: await tokenHash(ids.owner), ch: await tokenHash(ids.contact), ...sealed } };
}

test('a whole approval over real HTTP, with the security headers on every answer and nothing logged', async (t) => {
  const logged = []; const originals = {}; for (const m of ['log', 'info', 'warn', 'error', 'debug']) { originals[m] = console[m]; console[m] = (...a) => logged.push([m, a]); }
  t.after(() => { for (const m of Object.keys(originals)) console[m] = originals[m]; });
  const base = await serve(t); const { ids, body } = await newCheck();
  const made = await post(base, body); assert.equal(made.status, 201);
  const read = await post(base, { op: 'read', id: ids.id, token: ids.owner }); assert.deepEqual([read.status, read.json.status, read.json.role], [200, 'pending', 'o']);
  const decided = await post(base, { op: 'decide', id: ids.id, token: ids.contact, decision: 'approved' }); assert.equal(decided.status, 200);
  const after = await post(base, { op: 'read', id: ids.id, token: ids.owner }); assert.deepEqual([after.json.status, after.json.event.status], ['approved', 'approved']);
  for (const r of [made, read, decided, after]) {
    assert.match(r.headers['content-security-policy'], /script-src 'self'/); assert.equal(r.headers['cache-control'], 'no-store'); assert.equal(r.headers['set-cookie'], undefined, 'no cookie is ever set');
    for (const secret of [ids.owner, ids.contact, ids.key, 'SENTINEL-HTTP']) assert.ok(!r.text.includes(secret), 'an answer never echoes a code or the key');
  }
  for (const m of Object.keys(originals)) console[m] = originals[m];
  assert.deepEqual(logged, [], 'the server wrote nothing to any log');
});

test('only POST with JSON from the same site is accepted, and the body is size-limited', async (t) => {
  const base = await serve(t); const { body } = await newCheck();
  assert.equal((await post(base, null, { method: 'GET' })).status, 405); assert.equal((await post(base, null, { method: 'GET' })).headers.allow, 'POST');
  for (const method of ['PUT', 'DELETE', 'PATCH']) assert.equal((await post(base, null, { method })).status, 405, method);
  assert.equal((await post(base, body, { headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await post(base, body, { headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-site' } })).status, 403);
  assert.equal((await post(base, body, { headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status, 403);
  assert.equal((await post(base, body, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await post(base, null, { raw: '{not json' })).status, 400);
  assert.equal((await post(base, null, { raw: JSON.stringify({ op: 'create', pad: 'x'.repeat(9000) }) })).status, 413);
  assert.equal((await post(base, null, { raw: 'null' })).status, 400); assert.equal((await post(base, null, { raw: '[]' })).status, 400);
  assert.equal((await post(base, body)).status, 201, 'and a normal request still works');
});

test('creating links is rate limited (20 an hour per address); reading is limited far higher', async (t) => {
  const base = await serve(t); const statuses = [];
  for (let i = 0; i < 22; i += 1) statuses.push((await post(base, (await newCheck()).body)).status);
  assert.equal(statuses.filter((s) => s === 201).length, 20); assert.deepEqual(statuses.slice(20), [429, 429]);
  assert.equal((await post(base, { op: 'read', id: randomId(), token: randomToken() })).status, 404, 'reading is a separate, larger allowance');
});

test('links are refused, not faked, on a serverless host without a shared store; with one they work', async (t) => {
  const bare = await serve(t, { env: { VERCEL: '1' } }); const { body } = await newCheck();
  const r = await post(bare, body); assert.deepEqual([r.status, r.json.error], [503, 'links_unavailable']);
  const data = new Map();
  const fetchImpl = async (url, init) => ({ ok: true, status: 200, json: async () => JSON.parse(init.body).map(([cmd, key, value, ...rest]) => cmd === 'GET' ? { result: data.get(key) ?? null } : rest.includes('NX') && data.has(key) ? { result: null } : (data.set(key, value), { result: 'OK' })) });
  const shared = await serve(t, { env: { VERCEL: '1', UPSTASH_REDIS_REST_URL: 'https://store.example', UPSTASH_REDIS_REST_TOKEN: 'TESTONLY' }, fetchImpl });
  assert.equal((await post(shared, body)).status, 201);
  assert.ok(![...data.values()].join().includes('SENTINEL-HTTP'));
});

test('a wrong id, a wrong code and an expired-looking id all get the same answer over HTTP', async (t) => {
  const base = await serve(t); const { ids, body } = await newCheck(); await post(base, body);
  const answers = [await post(base, { op: 'read', id: ids.id, token: randomToken() }), await post(base, { op: 'read', id: randomId(), token: ids.contact }), await post(base, { op: 'read', id: ids.id, token: 'x' })];
  for (const a of answers) assert.deepEqual([a.status, a.text], [404, '{"error":"not_found"}']);
});
