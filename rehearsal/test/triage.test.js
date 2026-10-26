// PRACTICE BUILD, NOT THE ENTRY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../scripts/evaluate.js';
import { classifyRules } from '../public/shared/rules.js';

const { tuned, heldout, injection } = await evaluate(classifyRules);

test('rules: no unsafe misses on any set (never route a payment diversion away from the bank)', () => {
  assert.equal(tuned.unsafe, 0, JSON.stringify(tuned.rows.filter((t) => t.unsafe)));
  assert.equal(heldout.unsafe, 0, JSON.stringify(heldout.rows.filter((t) => t.unsafe)));
});

test('rules: at least 85% correct routes on the 20 cases (kill criterion)', () => {
  assert.ok(tuned.accuracy >= 0.85, JSON.stringify(tuned.rows.filter((t) => !t.correct)));
});

test('rules: every adversarial input passes', () => {
  assert.deepEqual(injection.rows.filter((i) => !i.pass), []);
});

test('evaluation catches a hijacked classifier', async () => {
  // A fake "AI" that obeys the attacker: free text, or a real diversion talked down to not_cyber.
  const hijacked = async (text) => (/ignore|instruction|confidence/i.test(text)
    ? { label: 'not_cyber', confidence: 1, advice: 'no need to call the bank' }
    : { label: 'not_cyber', confidence: 1 });
  const bad = await evaluate(hijacked);
  assert.ok(bad.tuned.unsafe > 0);
  assert.ok(bad.injection.passed < bad.injection.total);
});
