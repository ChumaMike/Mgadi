// PRACTICE BUILD, NOT THE ENTRY.
// npm run scoreboard      -> rule-based classifier
// npm run scoreboard:ai   -> the AI (needs ANTHROPIC_API_KEY in .env.local); makes about 55 small API calls

import { evaluate } from './evaluate.js';
import { classifyRules } from '../public/shared/rules.js';

const useAI = process.argv.includes('--ai');
let classify = classifyRules;
let name = 'rules';

if (useAI) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // fall through to the check below
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('No ANTHROPIC_API_KEY in .env.local. Run `npm run scoreboard` for the rules instead.');
    process.exit(1);
  }
  const { classifyWithAI } = await import('../server/ai.js');
  const model = process.env.MGADI_MODEL || 'claude-opus-5-5';
  name = `AI (${model})`;
  classify = async (text) => {
    try {
      return await classifyWithAI(text, { apiKey: process.env.ANTHROPIC_API_KEY, model });
    } catch (err) {
      console.error(`  API error: ${err.message}`);
      return null;
    }
  };
}

const { tuned, heldout, injection } = await evaluate(classify);
const pct = (x) => `${Math.round(x * 100)}%`;

console.log(`\nMGADI SCOREBOARD (practice build), classifier: ${name}`);
console.log('All test sets written by the team. No real victim data.\n');
for (const [title, set] of [['20 test cases', tuned], ['held-out cases', heldout]]) {
  console.log(`  ${title}`);
  for (const t of set.rows) {
    console.log(`    ${t.correct ? 'ok    ' : t.unsafe ? 'UNSAFE' : 'miss  '} ${t.id.padEnd(5)} expected ${t.expect.padEnd(18)} got ${t.got}`);
  }
}
for (const i of injection.rows.filter((x) => !x.pass)) console.log(`  FAIL ${i.id}: ${i.reasons.join('; ')}`);

console.log(`\n  Triage, 20 test cases:  ${tuned.correct}/${tuned.total} (${pct(tuned.accuracy)}), unsafe misses ${tuned.unsafe}`);
console.log(`  Triage, held-out:       ${heldout.correct}/${heldout.total} (${pct(heldout.accuracy)}), unsafe misses ${heldout.unsafe}`);
console.log(`  Injection test:         ${injection.passed}/${injection.total} passed`);
console.log('\n  Unsafe miss = a payment diversion sent anywhere except its playbook or the clarifying question.');
if (!useAI) {
  console.log('  HONESTY NOTE: the rules have been tuned on BOTH sets. Before tuning, the held-out score was 2/10.');
  console.log('  For the judges, write a fresh held-out set at the event and report that number, not these.');
}
console.log('');
