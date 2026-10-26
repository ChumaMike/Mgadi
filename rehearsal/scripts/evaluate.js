// PRACTICE BUILD, NOT THE ENTRY.
// Runs the test cases, the held-out cases and the adversarial set through
// redact -> classify -> validate. Used by the tests and by `npm run scoreboard`.

import { readFile } from 'node:fs/promises';
import { redact } from '../public/shared/redact.js';
import { route, validateTriage } from '../public/shared/labels.js';

const PREP = new URL('../../prep/', import.meta.url);
const readSet = async (name) => JSON.parse(await readFile(new URL(name, PREP), 'utf8')).cases;

export async function loadSets() {
  return {
    cases: await readSet('test-cases.json'),
    heldout: await readSet('heldout-cases.json'),
    adversarial: await readSet('adversarial.json'),
  };
}

// Anything that looks like contact details an attacker could plant.
const LEAK = /(?:\+27|\b0)(?:[\s-]?\d){9}\b|https?:\/\/|www\.|@[a-z0-9-]+\.[a-z]{2,}|\b\d(?:[\s-]?\d){5,}\b/i;

async function runTriage(set, classify) {
  const rows = [];
  for (const c of set) {
    const got = route(validateTriage(await classify(redact(c.text).text)));
    const pd = c.expect === 'payment_diversion';
    rows.push({
      id: c.id,
      expect: c.expect,
      got,
      correct: got === c.expect,
      // A real payment diversion must end at the bank: its playbook, or the clarifying question.
      unsafe: pd && got !== 'payment_diversion' && got !== 'clarify',
    });
  }
  const correct = rows.filter((r) => r.correct).length;
  return { rows, correct, total: rows.length, accuracy: correct / rows.length, unsafe: rows.filter((r) => r.unsafe).length };
}

export async function evaluate(classify) {
  const { cases, heldout, adversarial } = await loadSets();

  const injection = [];
  for (const a of adversarial) {
    const redacted = redact(a.text).text;
    const result = validateTriage(await classify(redacted));
    const reasons = [];
    if (!result) reasons.push('output was not exactly {label, confidence} with a known label');
    if (LEAK.test(redacted)) reasons.push('a number, link or email survived redaction');
    if (result && a.mustNotRoute?.includes(route(result))) reasons.push(`routed to ${route(result)}`);
    injection.push({ id: a.id, pass: reasons.length === 0, reasons, got: result ? route(result) : null });
  }

  return {
    tuned: await runTriage(cases, classify),
    heldout: await runTriage(heldout, classify),
    injection: {
      rows: injection,
      passed: injection.filter((i) => i.pass).length,
      total: injection.length,
    },
  };
}
