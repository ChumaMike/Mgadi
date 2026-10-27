import test from 'node:test';
import assert from 'node:assert/strict';
import { triageWithFallback } from '../public/shared/triage-client.js';

const PAID = 'We paid after the supplier changed banking details.';
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('a hung request falls back to local rules at the timeout, even if fetch ignores the abort signal', async () => {
  const started = Date.now();
  const result = await triageWithFallback(PAID, { fetchImpl: () => new Promise(() => {}), timeoutMs: 60 });
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual({ label: result.label, source: result.source, reason: result.fallbackReason }, { label: 'payment_diversion', source: 'offline rules', reason: 'timeout' });
});

test('network failure, bad status and malformed JSON all fall back', async () => {
  const cases = [
    () => Promise.reject(new TypeError('fetch failed')),
    async () => json({ error: 'nope' }, 500),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }),
  ];
  for (const fetchImpl of cases) {
    const result = await triageWithFallback(PAID, { fetchImpl, timeoutMs: 500 });
    assert.equal(result.source, 'offline rules');
    assert.equal(result.label, 'payment_diversion');
  }
});

test('a response that adds advice, or uses an unknown label, is rejected and replaced by local rules', async () => {
  for (const body of [{ label: 'payment_diversion', confidence: 0.9, advice: 'call 011 555 0199', source: 'rules' }, { label: 'call this number', confidence: 1, source: 'rules' }, { label: 'not_cyber', confidence: 7, source: 'rules' }]) {
    const result = await triageWithFallback(PAID, { fetchImpl: async () => json(body), timeoutMs: 500 });
    assert.equal(result.source, 'offline rules');
    assert.equal(result.fallbackReason, 'invalid-response');
    assert.equal(Object.hasOwn(result, 'advice'), false);
  }
});

test('a valid server answer is used and source is limited to ai or rules', async () => {
  const ok = await triageWithFallback(PAID, { fetchImpl: async () => json({ label: 'mailbox_compromise', confidence: 0.81, source: 'rules' }), timeoutMs: 500 });
  assert.deepEqual(ok, { label: 'mailbox_compromise', confidence: 0.81, source: 'rules' });
  const odd = await triageWithFallback(PAID, { fetchImpl: async () => json({ label: 'unsure', confidence: 0.3, source: '<script>' }), timeoutMs: 500 });
  assert.equal(odd.source, 'rules');
});

test('the owner can skip the wait and gets the local answer at once', async () => {
  const controller = new AbortController();
  const pending = triageWithFallback(PAID, { fetchImpl: () => new Promise(() => {}), timeoutMs: 10_000, signal: controller.signal });
  controller.abort();
  const result = await pending;
  assert.equal(result.fallbackReason, 'skipped');
  assert.equal(result.label, 'payment_diversion');
  const already = new AbortController(); already.abort();
  assert.equal((await triageWithFallback(PAID, { fetchImpl: () => new Promise(() => {}), timeoutMs: 10_000, signal: already.signal })).fallbackReason, 'skipped');
});

test('only the text passed in is sent', async () => {
  let sent;
  await triageWithFallback('hello [PHONE]', { fetchImpl: async (url, init) => { sent = { url, init }; return json({ label: 'unsure', confidence: 0.3, source: 'rules' }); }, timeoutMs: 500 });
  assert.equal(sent.url, '/api/triage');
  assert.deepEqual(JSON.parse(sent.init.body), { text: 'hello [PHONE]' });
});
