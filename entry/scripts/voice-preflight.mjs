// Operator preflight for the voice setup. READ-ONLY, but it DOES contact Retell: one `GET /get-agent/{id}` per configured
// agent (no call is created, nothing is charged for calls). Only run it after real provider use has been approved.
//   node scripts/voice-preflight.mjs
// It prints names, settings and reasons. It never prints a key or the operator token.
import { createVoiceService, loadVoiceConfig } from '../server/voice.js';
import { readFileSync } from 'node:fs';

try { process.loadEnvFile('.env.local'); } catch { /* use the process environment */ }
const playbook = JSON.parse(readFileSync(new URL('../public/data/playbook.json', import.meta.url), 'utf8'));
const cfg = loadVoiceConfig(process.env);
const voice = createVoiceService({ env: process.env, playbook });
const yes = (v) => (v ? 'yes' : 'no');

console.log('Mgadi voice preflight (read-only; contacts Retell with GET /get-agent only)\n');
console.log(`Voice mode:            ${cfg.mode}${cfg.misconfigured ? '  (MISCONFIGURED: key or agent id missing, so voice stays off)' : ''}`);
console.log(`Retell private key:    ${yes(cfg.apiKey)}   public key: ${yes(cfg.publicKey)}   live transcripts: ${cfg.transcripts === 'off' ? 'switched off' : cfg.publicKey ? 'public-key mode' : 'no public key, so no live captions'}`);
console.log(`Agent version pinned:  ${cfg.agentVersion === null ? 'no (Retell picks its default; set RETELL_AGENT_VERSION to pin)' : cfg.agentVersion}`);
console.log(`Operator test access:  ${cfg.operatorEnabled ? `enabled (${cfg.operatorMaxMs / 60000} min calls, ${cfg.operatorPerDay} per day)` : cfg.operatorTokenTooShort ? 'DISABLED: MGADI_OPERATOR_TOKEN is shorter than 24 characters' : 'disabled (no MGADI_OPERATOR_TOKEN, or a production deployment)'}`);
console.log(`Public call limits:    ${cfg.maxCallMs / 60000} min per call; ${cfg.perClientLimit} per visitor/10 min; ${cfg.perHourLimit}/hour; ${cfg.dailySessions}/day; ${cfg.dailyMinutes} audio-minutes/day (worst case)`);
console.log(`Quota store:           ${voice.cfg.storeKind}${voice.cfg.storeKind === 'memory' ? (cfg.sharedStoreRequired ? '  <- PUBLIC calls are refused on Vercel until a shared store is configured' : '  (per process; fine for local testing, NOT a global limit on serverless)') : ''}`);
console.log(`Publicly verified:     ${[...cfg.verified].join(', ') || 'none yet (correct until real tests pass)'}\n`);

if (cfg.mode !== 'retell') { console.log('Voice is not in retell mode, so nothing was contacted.'); process.exit(1); }

const report = await voice.diagnose();
let anyOk = false;
for (const lang of report) {
  console.log(`${lang.label} (${lang.code})`);
  if (!lang.configured) { console.log(`  - ${lang.note}\n`); continue; }
  for (const c of lang.checks) console.log(`  ${c.status.toUpperCase()}  ${c.name}: ${c.detail}`);
  console.log(`  => ${lang.ok ? 'passes the privacy checks: eligible for an OPERATOR TEST' : 'NOT eligible: fix the FAIL lines'}; public: ${lang.verifiedPublic ? 'verified' : 'not verified (needs real speaker tests first)'}\n`);
  anyOk ||= lang.ok;
}
console.log('Things this script CANNOT verify. Check them in the Retell dashboard before any real call:');
console.log('  1. No ACCOUNT-level webhook is registered (webhook events carry transcripts even with Basic Attributes Only).');
console.log('  2. The public key allows only your own domains, and the workspace holds only Mgadi calls.');
console.log('  3. A spend limit or low prepaid balance is in place, and auto-recharge is off.');
console.log('  4. Whether the public key may open the live-transcript socket (only a real call can show this).');
process.exit(anyOk ? 0 : 1);
