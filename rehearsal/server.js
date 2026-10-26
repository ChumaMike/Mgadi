// PRACTICE BUILD, NOT THE ENTRY.
// Start: npm start  (then open http://localhost:3000)
// AI is optional. Without ANTHROPIC_API_KEY in .env.local, the rule-based classifier runs.

import os from 'node:os';
import { createApp } from './server/app.js';
import { classifyWithAI } from './server/ai.js';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local: rules-only mode.
}

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.MGADI_MODEL || 'claude-opus-5-5';

const ai = apiKey && process.env.MGADI_AI !== 'off' ? (text) => classifyWithAI(text, { apiKey, model }) : null;

createApp({ ai }).listen(port, host, () => {
  console.log('\n  MGADI, PRACTICE BUILD (not the HackSecure entry)\n');
  console.log(`  Triage: ${ai ? `AI (${model}) with rule fallback` : 'rules only (no ANTHROPIC_API_KEY in .env.local)'}`);
  console.log(`  On this laptop:  http://localhost:${port}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  On your phone:   http://${n.address}:${port}  (same wifi or hotspot)`);
    }
  }
  console.log('');
});
