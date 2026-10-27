// Operator check for the voice setup. READ-ONLY, but it does contact Retell (GET /get-agent for each configured agent),
// so only run it once real provider use has been approved. It prints language status and reasons, never any key.
//   node scripts/voice-preflight.mjs
import { createVoiceService } from '../server/voice.js';
import { readFileSync } from 'node:fs';

try { process.loadEnvFile('.env.local'); } catch { /* use the process environment */ }
const playbook = JSON.parse(readFileSync(new URL('../public/data/playbook.json', import.meta.url), 'utf8'));
const voice = createVoiceService({ env: process.env, playbook });
const { body } = await voice.config();
console.log(`Voice mode: ${body.mode}`);
console.log(`Live-transcript public key configured: ${body.publicKey ? 'yes' : 'no (calls would have no live captions)'}`);
console.log(`Call time limit: ${body.maxCallMs / 60000} minutes`);
for (const [code, info] of Object.entries(body.languages)) console.log(`  ${code.padEnd(3)} ${info.available ? 'AVAILABLE ' : 'unavailable'}  ${info.label}${info.reason ? `: ${info.reason}` : ''}`);
process.exit(body.mode === 'retell' && Object.values(body.languages).some((l) => l.available) ? 0 : 1);
