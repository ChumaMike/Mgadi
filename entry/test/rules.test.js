import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { redactIncident } from '../public/shared/redact.js';
import { classifyRules } from '../public/shared/rules.js';
import { routeTriage, validateTriage } from '../public/shared/labels.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`../../prep/${name}.json`, import.meta.url), 'utf8'));
const route = (text, names = []) => routeTriage(classifyRules(redactIncident(text, names).text));

function score(name) {
  const { cases } = load(name);
  let correct = 0; const unsafe = []; const misses = [];
  for (const item of cases) {
    const got = route(item.text);
    if (got === item.expect) correct += 1;
    else {
      misses.push(`${item.id}: expected ${item.expect}, got ${got}`);
      // Unsafe = a real payment diversion sent anywhere except its guide or the clarifying question.
      if (item.expect === 'payment_diversion' && got !== 'clarify') unsafe.push(item.id);
    }
  }
  return { total: cases.length, correct, unsafe, misses };
}

// These sets were seen while writing the rules, so 100% here is a regression guard, NOT an accuracy claim.
for (const name of ['test-cases', 'heldout-cases', 'heldout-2']) {
  test(`rules still route every case in prep/${name}.json (regression guard)`, () => {
    const result = score(name);
    assert.deepEqual(result.misses, []);
    assert.deepEqual(result.unsafe, []);
  });
}

// heldout-3 was written after tuning and scored once: this is the only honest accuracy figure.
// The floor stops regressions; raise it only after writing a NEW sealed set. Never tune on this one.
test('sealed held-out set: no unsafe misses and the recorded floor holds', () => {
  const result = score('heldout-3');
  assert.deepEqual(result.unsafe, [], `unsafe: ${result.unsafe}`);
  assert.ok(result.correct >= 9, `sealed score fell to ${result.correct}/${result.total}: ${result.misses.join('; ')}`);
});

test('adversarial inputs: schema holds, nothing attacker-supplied survives redaction, no talk-down', () => {
  for (const item of load('adversarial').cases) {
    const redacted = redactIncident(item.text).text;
    assert.doesNotMatch(redacted, /(?:\+27|\b0)[\s\d-]{9,}|https?:|www\.|[\w.-]+@[\w-]+\.\w+/i, `${item.id} leaked a contact`);
    const result = classifyRules(redacted);
    assert.ok(validateTriage(result), `${item.id} broke the schema`);
    if (item.mustNotRoute) assert.ok(!item.mustNotRoute.includes(routeTriage(result)), `${item.id} was talked down`);
  }
});

test('negation and conflict: never a confident diagnosis from contradictory text', () => {
  assert.equal(route('The customer has a late payment but no bank details changed.'), 'not_cyber');
  assert.equal(route('We have not paid yet but they sent new bank details.'), 'suspicious_message');
  assert.equal(route('We paid and we have not paid the new account yet, banking details changed.'), 'clarify');
  assert.equal(route('Supplier says they never changed bank details but we paid the new account.'), 'payment_diversion');
  assert.equal(route('We paid R50 000. No money arrived in the new account the email gave us.'), 'payment_diversion');
});

test('scam words without a clear route ask a question instead of saying "not cyber"', () => {
  assert.equal(route('Someone tricked us and we want our money back.'), 'clarify');
  assert.equal(route('We paid a supplier twice by mistake and want a refund.'), 'not_cyber');
});

test('request to change banking details alone does not claim money moved', () => {
  assert.equal(route('We received an email asking us to update the bank details for one of our suppliers.'), 'clarify');
});

test('redaction masks amounts written with k, m or million, without leaving fragments', () => {
  for (const [input, leftover] of [['paid R70k today', /70/], ['paid 70k today', /70/], ['lost R1.5m', /\.5/], ['R2 million gone', /million/], ['R 70 000,00 and R500', /\d{3}/]]) {
    assert.doesNotMatch(redactIncident(input).text, leftover, input);
  }
  assert.equal(redactIncident('invoice 2481 on 12 May').text, 'invoice 2481 on 12 May');
});
