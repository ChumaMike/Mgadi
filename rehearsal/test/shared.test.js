// PRACTICE BUILD, NOT THE ENTRY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { redact } from '../public/shared/redact.js';
import { validateTriage, route } from '../public/shared/labels.js';
import { sha256Pure, sha256Hex, canonicalJSON } from '../public/shared/sha256.js';
import { formatZAR, parseZAR } from '../public/shared/zar.js';

test('redaction hides contact details, amounts, long numbers and given names', () => {
  const { text, counts } = redact(
    'Ridgeline emailed accounts@ridgeline.co.za from https://evil.example/x. Pay R 70 000,00 into 62841937465, call 082 555 1234 or +27 11 555 0199. Also R70k and R500.',
    { names: ['Ridgeline'] },
  );
  assert.equal(
    text,
    '[NAME] emailed [EMAIL] from [LINK] Pay [AMOUNT] into [NUMBER], call [PHONE] or [PHONE]. Also [AMOUNT] and [AMOUNT].',
  );
  assert.equal(counts.PHONE, 2);
  assert.equal(counts.AMOUNT, 3);
});

test('redaction keeps ordinary words and short numbers', () => {
  assert.equal(redact('Invoice 2481 was paid on 12 May').text, 'Invoice 2481 was paid on 12 May');
});

test('redaction caps length and strips control characters', () => {
  assert.equal(redact('a'.repeat(5000)).text.length, 2000);
  assert.equal(redact('hi\u0000\u0007 there').text, 'hi there');
});

test('name redaction matches whole words only, any case', () => {
  assert.equal(redact('thandi paid Thandiwe', { names: ['Thandi'] }).text, '[NAME] paid Thandiwe');
});

test('validateTriage accepts only {label, confidence}', () => {
  assert.deepEqual(validateTriage({ label: 'payment_diversion', confidence: 0.912 }), { label: 'payment_diversion', confidence: 0.91 });
  assert.equal(validateTriage({ label: 'refund_approved', confidence: 0.9 }), null);
  assert.equal(validateTriage({ label: 'not_cyber', confidence: 1.5 }), null);
  assert.equal(validateTriage({ label: 'not_cyber', confidence: '1' }), null);
  assert.equal(validateTriage({ label: 'not_cyber', confidence: 1, advice: 'no need to call the bank' }), null);
  assert.equal(validateTriage(['payment_diversion', 1]), null);
  assert.equal(validateTriage(null), null);
});

test('low confidence and unsure go to the clarifying question', () => {
  assert.equal(route({ label: 'payment_diversion', confidence: 0.55 }), 'clarify');
  assert.equal(route({ label: 'unsure', confidence: 0.99 }), 'clarify');
  assert.equal(route(null), 'clarify');
  assert.equal(route({ label: 'payment_diversion', confidence: 0.9 }), 'payment_diversion');
});

test('pure-JS SHA-256 matches node:crypto (the fallback for phones on plain http)', async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 1000, 100_000]) {
    const bytes = new Uint8Array(randomBytes(size));
    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256Pure(bytes), expected, `size ${size}`);
    assert.equal(await sha256Hex(bytes), expected, `size ${size} (web crypto)`);
  }
});

test('changing one byte changes the fingerprint', () => {
  const a = new TextEncoder().encode('Pay R70 000 to account 1');
  const b = new TextEncoder().encode('Pay R70 000 to account 2');
  assert.notEqual(sha256Pure(a), sha256Pure(b));
});

test('canonical JSON ignores key order', () => {
  assert.equal(canonicalJSON({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJSON({ a: [{ c: 3, d: 2 }], b: 1 }));
});

test('rand formatting: R 1 234,56', () => {
  assert.equal(formatZAR(1234.56), 'R 1 234,56');
  assert.equal(formatZAR(70000), 'R 70 000,00');
  assert.equal(formatZAR(5), 'R 5,00');
  assert.equal(parseZAR('R70,000'), 70000);
  assert.equal(parseZAR('R 70 000,00'), 70000);
  assert.equal(parseZAR('48 500,50'), 48500.5);
  assert.equal(parseZAR('1234.56'), 1234.56);
  assert.equal(parseZAR('seventy'), null);
});
