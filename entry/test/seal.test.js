import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, open, randomId, randomToken, newKey, tokenHash, buildLink, parseLink, b64u, MAX_PLAINTEXT_BYTES, ID_CHARS, TOKEN_CHARS, KEY_CHARS } from '../public/shared/seal.js';
import { cleanLine } from '../public/shared/text.js';

const ctx = () => ({ key: newKey(), kind: 'check', id: randomId() });

test('sealed content opens with the right key and only then', async () => {
  const c = ctx(); const sealed = await seal({ supplier: 'Test Supplier', n: 1 }, c);
  assert.deepEqual(await open(sealed, c), { supplier: 'Test Supplier', n: 1 });
  await assert.rejects(open(sealed, { ...c, key: newKey() }), /damaged or incomplete/);
  await assert.rejects(open(sealed, { ...c, key: 'short' }), /damaged or incomplete/);
  assert.doesNotMatch(JSON.stringify(sealed), /Test Supplier/, 'the ciphertext does not contain the plaintext');
});

test('a changed ciphertext, iv or tag is refused (the lock is authenticated)', async () => {
  const c = ctx(); const sealed = await seal({ a: 'b' }, c);
  const flip = (text, i = 3) => text.slice(0, i) + (text[i] === 'A' ? 'B' : 'A') + text.slice(i + 1);
  await assert.rejects(open({ ...sealed, ct: flip(sealed.ct) }, c));
  await assert.rejects(open({ ...sealed, ct: sealed.ct.slice(0, -4) }, c), 'truncated');
  await assert.rejects(open({ ...sealed, iv: flip(sealed.iv) }, c));
  await assert.rejects(open({ ...sealed, ct: 'not base64 !!' }, c));
  await assert.rejects(open({ ct: undefined, iv: undefined }, c));
});

test('ciphertext cannot be moved to another record, kind or slot', async () => {
  const c = ctx(); const sealed = await seal({ a: 'b' }, c);
  await assert.rejects(open(sealed, { ...c, id: randomId() }), 'another id');
  await assert.rejects(open(sealed, { ...c, kind: 'handoff' }), 'another kind');
  await assert.rejects(open(sealed, { ...c, part: 'decision' }), 'another slot');
  assert.deepEqual(await open(await seal({ n: 'x' }, { ...c, part: 'decision' }), { ...c, part: 'decision' }), { n: 'x' });
});

test('sealing twice gives different ciphertext, and oversize content is refused', async () => {
  const c = ctx(); const one = await seal({ a: 1 }, c); const two = await seal({ a: 1 }, c);
  assert.notEqual(one.ct, two.ct); assert.notEqual(one.iv, two.iv);
  await assert.rejects(seal({ big: 'x'.repeat(MAX_PLAINTEXT_BYTES) }, c), /too long/);
});

test('ids, tokens and keys are random, the right length, and url-safe', () => {
  const ids = new Set(Array.from({ length: 200 }, randomId)); assert.equal(ids.size, 200);
  assert.match(randomId(), new RegExp(`^[A-Za-z0-9_-]{${ID_CHARS}}$`)); assert.match(randomToken(), new RegExp(`^[A-Za-z0-9_-]{${TOKEN_CHARS}}$`)); assert.match(newKey(), new RegExp(`^[A-Za-z0-9_-]{${KEY_CHARS}}$`));
  assert.equal(b64u.decode(newKey()).length, 32);
  assert.throws(() => b64u.decode('a+b/'), /not base64url/);
});

test('a token hash is a stable SHA-256 and never contains the token', async () => {
  const token = randomToken(); const hash = await tokenHash(token);
  assert.match(hash, /^[0-9a-f]{64}$/); assert.equal(hash, await tokenHash(token)); assert.notEqual(hash, await tokenHash(`${token}x`)); assert.ok(!hash.includes(token));
});

test('links parse strictly: any edit, truncation, extra part or wrong role is refused', () => {
  const [id, token, key] = [randomId(), randomToken(), newKey()];
  const link = buildLink('https://example.test', 'c', id, token, key); const hash = new URL(link).hash;
  assert.deepEqual(parseLink(hash), { role: 'c', id, token, key });
  assert.equal(new URL(link).search, ''); assert.equal(new URL(link).pathname, '/', 'everything secret is after the # sign, which browsers never send');
  for (const bad of [hash.slice(0, -1), `${hash}A`, hash.replace('.c.', '.x.'), hash.replace('mgadi=1', 'mgadi=2'), hash.replace(id, id.slice(1)), hash.replace(token, `${token}.`), `${hash}.extra`, '#mgadi=1.c..', '#', '', null, undefined, hash.replace(key[0], '+'), `${hash}\n`, ` ${hash}`]) assert.equal(parseLink(bad), null, String(bad).slice(0, 60));
  const swapped = hash.replace(id, randomId()); assert.ok(parseLink(swapped), 'a swapped id still parses (the SERVER and the decryption then refuse it)');
  assert.ok(parseLink(hash.toLowerCase()), 'so does a lowercased link: it is simply a different link, and it will not open');
});

test('cleanLine strips controls, direction overrides and angle brackets, flattens space and cuts length', () => {
  assert.equal(cleanLine('  a\u202eb\u0000c\n\td <img src=x onerror=1> ', 50), 'a b c d img src=x onerror=1');
  assert.equal(cleanLine('x'.repeat(500), 30).length, 30);
  for (const odd of [null, undefined, {}, [], () => 1, true]) assert.equal(cleanLine(odd, 10), '');
  assert.equal(cleanLine(12345, 10), '12345');
});
