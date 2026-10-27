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
