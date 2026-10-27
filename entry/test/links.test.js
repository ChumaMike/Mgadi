import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkService, createLinkMemoryStore, createLinkRestStore, createLinkStoreFromEnv, DEFAULT_TTL_HOURS, LIMITS } from '../server/links.js';
import { seal, randomId, randomToken, newKey, tokenHash } from '../public/shared/seal.js';

const SENTINEL = 'SENTINEL-SUPPLIER-ACME-9931';
let clock = 1_800_000_000_000;
const now = () => clock;

async function setup(options = {}) {
  clock = 1_800_000_000_000;
  const store = options.store ?? createLinkMemoryStore({ now });
  const service = createLinkService({ store, now, ...options.service });
  const ids = { id: randomId(), key: newKey(), ownerToken: randomToken(), contactToken: randomToken(), kind: options.kind ?? 'check' };
  const sealed = await seal({ supplier: SENTINEL }, { key: ids.key, kind: ids.kind, id: ids.id });
  const body = { op: 'create', kind: ids.kind, id: ids.id, oh: await tokenHash(ids.ownerToken), ch: await tokenHash(ids.contactToken), ...sealed };
  const call = (b) => service.handle(b);
  const read = (token, id = ids.id) => call({ op: 'read', id, token });
  return { store, service, ids, body, call, read, sealed };
}

test('create stores a record, and the same create again is a harmless duplicate', async () => {
  const s = await setup();
  const first = await s.call(s.body); assert.equal(first.status, 201); assert.equal(first.body.expiresAt - first.body.createdAt, DEFAULT_TTL_HOURS * 3_600_000);
  const again = await s.call(s.body); assert.equal(again.status, 200); assert.equal(again.body.duplicate, true); assert.equal(again.body.createdAt, first.body.createdAt, 'the original times stand');
});

test('the same id with different content is refused and the original is untouched', async () => {
  const s = await setup(); await s.call(s.body);
  const other = await seal({ x: 'y' }, { key: s.ids.key, kind: 'check', id: s.ids.id });
  assert.equal((await s.call({ ...s.body, ...other })).status, 409);
  assert.equal((await s.call({ ...s.body, oh: await tokenHash(randomToken()) })).status, 409, 'a different owner code');
  assert.equal((await s.call({ ...s.body, kind: 'handoff' })).status, 409, 'a different kind');
  assert.equal((await s.read(s.ids.ownerToken)).body.ct, s.sealed.ct);
});

test('malformed or hostile create requests are all refused with 400 and store nothing', async () => {
  const s = await setup(); const bad = [];
  bad.push({ ...s.body, kind: 'admin' }, { ...s.body, kind: '__proto__' }, { ...s.body, kind: 'constructor' }, { ...s.body, kind: ['check'] }, { ...s.body, id: 'short' }, { ...s.body, id: `${s.ids.id}x` }, { ...s.body, id: '../../etc/passwd!' }, { ...s.body, id: { a: 1 } });
  bad.push({ ...s.body, oh: 'zz'.repeat(32) }, { ...s.body, oh: s.body.oh.toUpperCase() }, { ...s.body, ch: s.body.oh }, { ...s.body, ch: undefined }, { ...s.body, oh: 123 });
  bad.push({ ...s.body, ct: 'x'.repeat(LIMITS.maxCiphertext + 1) }, { ...s.body, ct: 'short' }, { ...s.body, ct: '<script>alert(1)</script>'.repeat(3) }, { ...s.body, ct: ['a'] }, { ...s.body, iv: 'tooshort' }, { ...s.body, iv: `${s.body.iv}AA` }, { ...s.body, iv: '!'.repeat(16) });
  bad.push(null, undefined, [], 'text', 7, { op: 'create' }, { op: 'nope' }, { op: ['create'] }, { op: '__proto__' }, {});
  for (const body of bad) { const r = await s.call(body); assert.equal(r.status, 400, JSON.stringify(body)?.slice(0, 80)); }
  assert.equal(s.store.dump().length, 0, 'nothing was stored by any of them');
});

test('unknown extra fields are ignored and never stored', async () => {
  const s = await setup(); await s.call({ ...s.body, admin: true, plaintext: SENTINEL, extra: { deep: [1] }, __proto__: { polluted: 1 } });
  assert.equal({}.polluted, undefined);
  const record = JSON.parse(s.store.dump().find((e) => e.key.startsWith('l:')).value);
  assert.deepEqual(Object.keys(record).sort(), ['ch', 'createdAt', 'ct', 'expiresAt', 'iv', 'kind', 'oh', 'v']);
});

test('the server never holds the plaintext, a raw token or the key', async () => {
  const s = await setup(); await s.call(s.body);
  await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'approved', note: await seal({ by: SENTINEL }, { key: s.ids.key, kind: 'check', id: s.ids.id, part: 'decision' }) });
  const everything = JSON.stringify(s.store.dump());
  for (const secret of [SENTINEL, s.ids.key, s.ids.ownerToken, s.ids.contactToken]) assert.ok(!everything.includes(secret), `leaked ${secret.slice(0, 8)}`);
  assert.deepEqual(s.store.dump().map((e) => e.key).sort(), [`e:${s.ids.id}`, `l:${s.ids.id}`]);
});

test('reading: both codes work and say which role they are, anything else is the same 404', async () => {
  const s = await setup(); await s.call(s.body);
  const owner = await s.read(s.ids.ownerToken); const contact = await s.read(s.ids.contactToken);
  assert.deepEqual([owner.status, owner.body.role, owner.body.status], [200, 'o', 'pending']); assert.deepEqual([contact.status, contact.body.role], [200, 'c']);
  const flip = (t) => t.slice(0, 5) + (t[5] === 'A' ? 'B' : 'A') + t.slice(6);
  const misses = [await s.read(flip(s.ids.contactToken)), await s.read(s.ids.contactToken, randomId()), await s.read(s.ids.contactToken.slice(1)), await s.read(`${s.ids.contactToken}x`), await s.read(undefined), await s.read({ a: 1 }), await s.read(''), await s.read(s.ids.contactToken, 'x'), await s.read(s.ids.contactToken, null), await s.read(await tokenHash(s.ids.contactToken))];
  for (const r of misses) { assert.equal(r.status, 404); assert.deepEqual(r.body, { error: 'not_found' }); }
});

test('a link stops working at its expiry, and the event expires with it', async () => {
  const s = await setup(); await s.call(s.body);
  await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'approved' });
  clock += DEFAULT_TTL_HOURS * 3_600_000 - 1000; assert.equal((await s.read(s.ids.ownerToken)).status, 200, 'still there a second before');
  clock += 1000; assert.equal((await s.read(s.ids.ownerToken)).status, 404); assert.equal((await s.read(s.ids.contactToken)).status, 404);
  assert.equal((await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'rejected' })).status, 404, 'an expired link cannot be acted on');
  clock += 61_000; await s.read(s.ids.ownerToken);
  assert.equal(s.store.dump().length, 0, 'both entries are physically gone within a minute of expiry');
});

test('the service itself refuses an expired record, even when the store keeps handing it back (a store with coarse expiry)', async () => {
  const held = new Map();
  const stubborn = { kind: 'memory', async get(key) { return held.get(key) ?? null; }, async setIfAbsent(key, value) { if (held.has(key)) return false; held.set(key, value); return true; } };
  const s = await setup({ store: stubborn }); await s.call(s.body);
  await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'approved' });
  clock += DEFAULT_TTL_HOURS * 3_600_000 - 1; assert.equal((await s.read(s.ids.ownerToken)).status, 200, 'one millisecond before expiry it still works');
  clock += 1;
  assert.equal((await s.read(s.ids.ownerToken)).status, 404); assert.equal((await s.read(s.ids.contactToken)).status, 404);
  assert.equal((await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'approved' })).status, 404, 'not even the same answer again');
});

test('the lifetime is configurable but clamped to 1 hour to 7 days', async () => {
  for (const [given, expected] of [[2, 2], [0, 168], [-5, 1], [1000, 168], ['abc', 168], [undefined, 168]]) {
    const s = await setup({ service: { ttlHours: given } }); const r = await s.call(s.body); assert.equal((r.body.expiresAt - r.body.createdAt) / 3_600_000, expected, String(given));
  }
});

test('approval: only the contact code can decide; the first answer wins and cannot be changed', async () => {
  const s = await setup(); await s.call(s.body);
  assert.equal((await s.call({ op: 'decide', id: s.ids.id, token: s.ids.ownerToken, decision: 'approved' })).status, 403, 'the person who asked cannot approve their own request');
  assert.equal((await s.read(s.ids.ownerToken)).body.status, 'pending');
  const yes = await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'approved' }); assert.equal(yes.status, 200); assert.equal(yes.body.at, clock);
  clock += 5000;
  const replay = await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'approved' }); assert.deepEqual([replay.status, replay.body.duplicate, replay.body.at], [200, true, yes.body.at], 'a replay changes nothing, not even the time');
  const flip = await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'rejected' }); assert.deepEqual([flip.status, flip.body.error, flip.body.status], [409, 'already_decided', 'approved']);
  const final = await s.read(s.ids.ownerToken); assert.deepEqual([final.body.status, final.body.event.status, final.body.event.at], ['approved', 'approved', yes.body.at]);
});

test('decisions and acknowledgements must match the kind of link', async () => {
  const check = await setup(); await check.call(check.body);
  for (const bad of [{ op: 'ack' }, { op: 'decide', decision: 'acknowledged' }, { op: 'decide', decision: 'maybe' }, { op: 'decide', decision: ['approved'] }, { op: 'decide' }, { op: 'decide', decision: '__proto__' }]) assert.equal((await check.call({ id: check.ids.id, token: check.ids.contactToken, ...bad })).status, 400, JSON.stringify(bad));
  const hand = await setup({ kind: 'handoff' }); await hand.call(hand.body);
  for (const bad of [{ op: 'decide', decision: 'approved' }, { op: 'decide', decision: 'acknowledged' }]) assert.equal((await hand.call({ id: hand.ids.id, token: hand.ids.contactToken, ...bad })).status, 400, JSON.stringify(bad));
  assert.equal((await hand.call({ op: 'ack', id: hand.ids.id, token: hand.ids.ownerToken })).status, 403, 'the sender cannot acknowledge their own summary');
  assert.equal((await hand.read(hand.ids.ownerToken)).body.status, 'sent', 'still only sent: nothing is invented');
  const ok = await hand.call({ op: 'ack', id: hand.ids.id, token: hand.ids.contactToken }); assert.deepEqual([ok.status, ok.body.status], [200, 'acknowledged']);
  assert.deepEqual([(await hand.call({ op: 'ack', id: hand.ids.id, token: hand.ids.contactToken })).body.duplicate, (await hand.read(hand.ids.ownerToken)).body.status], [true, 'acknowledged']);
});

test('20 simultaneous conflicting decisions produce exactly one winner and every answer agrees with it', async () => {
  const s = await setup(); await s.call(s.body);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: i % 2 ? 'approved' : 'rejected' })));
  const final = (await s.read(s.ids.ownerToken)).body.event;
  assert.equal(results.filter((r) => r.status === 200 && !r.body.duplicate).length, 1, 'exactly one claim succeeded');
  for (const r of results) assert.ok(r.status === 409 ? r.body.status === final.status : r.body.status === final.status, 'nobody is told something different from the stored answer');
});

test('an optional note is accepted only as well-formed ciphertext', async () => {
  const s = await setup(); await s.call(s.body);
  for (const note of [{ ct: 'short', iv: 'x'.repeat(16) }, { ct: 'x'.repeat(LIMITS.maxNoteCiphertext + 1), iv: 'x'.repeat(16) }, { ct: '<b>hello</b>'.repeat(5), iv: 'x'.repeat(16) }, 'text', 5, [], { ct: 5, iv: 5 }, { ct: 'x'.repeat(40), iv: 'bad' }]) assert.equal((await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'approved', note })).status, 400, JSON.stringify(note)?.slice(0, 50));
  assert.equal((await s.read(s.ids.ownerToken)).body.status, 'pending', 'a refused request leaves no trace');
});

test('a failing store means a refusal, never a pretended success', async () => {
  const broken = { kind: 'rest', async get() { throw new Error('down'); }, async setIfAbsent() { throw new Error('down'); } };
  const s = await setup({ store: broken });
  for (const body of [s.body, { op: 'read', id: s.ids.id, token: s.ids.ownerToken }, { op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'approved' }]) assert.equal((await s.call(body)).status, 503);
});

test('on a serverless host with no shared store, links are refused instead of kept in memory that instances do not share', async () => {
  const { store, sharedRequired } = createLinkStoreFromEnv({ VERCEL: '1' }); assert.equal(sharedRequired, true);
  assert.equal((await createLinkService({ store, sharedRequired }).handle({ op: 'read', id: randomId(), token: randomToken() })).status, 503);
  assert.equal(createLinkStoreFromEnv({}).sharedRequired, false, 'locally a memory store is fine');
  assert.equal(createLinkStoreFromEnv({ VERCEL: '1', UPSTASH_REDIS_REST_URL: 'http://insecure.example', UPSTASH_REDIS_REST_TOKEN: 'x' }).store.kind, 'memory', 'a non-https store address is not used');
  assert.equal(createLinkStoreFromEnv({ VERCEL: '1', UPSTASH_REDIS_REST_URL: 'https://store.example', UPSTASH_REDIS_REST_TOKEN: 'x' }).store.kind, 'rest');
});

// A fake Redis-over-HTTP that obeys SET ... NX EX and GET, so the REST store is exercised without any real service.
function fakeRest() {
  const data = new Map(); const calls = []; let fail = false; let malformed = false;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
    if (fail) return { ok: false, status: 500, json: async () => ({}) };
    if (malformed) return { ok: true, status: 200, json: async () => 'nonsense' };
    const out = JSON.parse(init.body).map(([cmd, key, value, ...rest]) => {
      if (cmd === 'GET') return { result: data.get(key)?.value ?? null };
      if (cmd === 'SET') { if (rest.includes('NX') && data.has(key)) return { result: null }; data.set(key, { value, ex: Number(rest[rest.indexOf('EX') + 1]) }); return { result: 'OK' }; }
      return { error: 'unknown command' };
    });
    return { ok: true, status: 200, json: async () => out };
  };
  return { fetchImpl, data, calls, set fail(v) { fail = v; }, set malformed(v) { malformed = v; } };
}

test('the REST store: a full approval works, expiry is set natively, and the event never outlives the link', async () => {
  const fake = fakeRest(); const store = createLinkRestStore({ url: 'https://store.example/', token: 'TESTONLY-token', fetchImpl: fake.fetchImpl });
  const s = await setup({ store }); await s.call(s.body);
  assert.equal(fake.data.get(`l:${s.ids.id}`).ex, DEFAULT_TTL_HOURS * 3600);
  clock += 3 * 3_600_000;
  assert.equal((await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'rejected' })).status, 200);
  assert.equal(fake.data.get(`e:${s.ids.id}`).ex, DEFAULT_TTL_HOURS * 3600 - 3 * 3600, 'the event expires exactly when the link does');
  assert.equal((await s.call({ op: 'decide', id: s.ids.id, token: s.ids.contactToken, decision: 'approved' })).status, 409);
  assert.ok(fake.calls.every((c) => c.url === 'https://store.example/pipeline' && c.auth === 'Bearer TESTONLY-token'));
  const stored = JSON.stringify([...fake.data.values()]); for (const secret of [SENTINEL, s.ids.key, s.ids.ownerToken, s.ids.contactToken]) assert.ok(!stored.includes(secret));
});

test('the REST store fails closed on an error status or a nonsense reply', async () => {
  const fake = fakeRest(); const s = await setup({ store: createLinkRestStore({ url: 'https://store.example', token: 't', fetchImpl: fake.fetchImpl }) });
  fake.fail = true; assert.equal((await s.call(s.body)).status, 503); fake.fail = false;
  fake.malformed = true; assert.equal((await s.call(s.body)).status, 503); fake.malformed = false;
  assert.equal((await s.call(s.body)).status, 201, 'and it recovers when the store does');
});
