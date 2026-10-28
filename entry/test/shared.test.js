import test from 'node:test';
import assert from 'node:assert/strict';
import { routeTriage, validateTriage } from '../public/shared/labels.js';
import { redactIncident } from '../public/shared/redact.js';
import { classifyRules } from '../public/shared/rules.js';
import { canonicalJSON } from '../public/shared/sha256.js';

test('triage accepts only the fixed schema', () => {
  assert.deepEqual(validateTriage({ label: 'payment_diversion', confidence: 0.834 }), { label: 'payment_diversion', confidence: 0.83 });
  assert.equal(validateTriage({ label: 'payment_diversion', confidence: 0.9, advice: 'call this number' }), null);
  assert.equal(routeTriage({ label: 'payment_diversion', confidence: 0.5 }), 'clarify');
});

test('redaction hides personal details before they can leave the device', () => {
  const result = redactIncident('Sipho paid R 70 000 to 082 123 4567 after email fraud@evil.test sent https://bad.example', ['Sipho']);
  assert.match(result.text, /\[NAME\]/);
  assert.match(result.text, /\[AMOUNT\]/);
  assert.match(result.text, /\[PHONE\]/);
  assert.match(result.text, /\[EMAIL\]/);
  assert.match(result.text, /\[LINK\]/);
});

test('rules identify a paid banking-details change and stay uncertain otherwise', () => {
  assert.deepEqual(classifyRules('We paid after the supplier changed banking details'), { label: 'payment_diversion', confidence: 0.9 });
  assert.deepEqual(classifyRules('I do not know what happened'), { label: 'unsure', confidence: 0.3 });
});

test('canonical pack JSON is stable regardless of object-key order', () => {
  assert.equal(canonicalJSON({ b: 2, a: 1 }), canonicalJSON({ a: 1, b: 2 }));
});

test('a PIN or password typed after its own name is hidden, but the NAME stays so the guidance can still see what was asked for', () => {
  assert.equal(redactIncident('My PIN is 5521 and I phoned them').text, 'My PIN is [SECRET] and I phoned them');
  assert.equal(redactIncident('password: hunter2, then I logged out').text, 'password: [SECRET], then I logged out');
  assert.equal(redactIncident('CVV=913 was typed in').text, 'CVV=[SECRET] was typed in');
  assert.equal(redactIncident('my passcode 0000.').text, 'my passcode [SECRET].');
  assert.equal(redactIncident('My PIN is 5521').counts.SECRET, 1);
});

test('hiding a secret never removes the word that names it, so a request for a PIN or OTP is still recognised', () => {
  // Labels measured on the same texts BEFORE this change were identical (suspicious_message). They must not move.
  for (const text of ['They asked for my OTP 123456 and I read it out', 'He asked me for my PIN 5521 on the phone', 'the caller wanted my password hunter2', 'The bank called and asked for my PIN 5521, I gave it to them', 'Someone asked me for my OTP code 4821 and I gave it']) {
    const hidden = redactIncident(text).text;
    assert.match(hidden, /\b(OTP|PIN|password)\b/, hidden);
    assert.doesNotMatch(hidden, /123456|5521|hunter2|4821/, hidden);
    assert.deepEqual(classifyRules(hidden), { label: 'suspicious_message', confidence: 0.75 }, hidden);
  }
  assert.equal(redactIncident('Someone asked me for my OTP code 4821').text, 'Someone asked me for my OTP code [SECRET]');
});

test('ordinary sentences that mention a PIN or password without a value are left exactly as they were', () => {
  for (const text of ['He asked for my PIN and password', 'I forgot my password', 'reset the password reset link', 'my pin is safe', 'the OTP did not arrive', 'one-time pin']) {
    assert.equal(redactIncident(text).text, text);
    assert.equal(redactIncident(text).counts.SECRET, undefined);
  }
  // Output for text the older patterns already hid is unchanged: they run first.
  assert.equal(redactIncident('call 082 123 4567 or pay R 70 000').text, 'call [PHONE] or pay [AMOUNT]');
});
