import os from 'node:os';
import { createApp } from './server/app.js';
import { classifyWithAI } from './server/ai.js';

try { process.loadEnvFile('.env.local'); } catch { /* rules-only mode */ }

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.MGADI_MODEL || 'claude-sonnet-4-20250514';
const ai = apiKey && process.env.MGADI_AI !== 'off' ? (text) => classifyWithAI(text, { apiKey, model }) : null;

createApp({ classifyWithAI: ai }).listen(port, host, () => {
  console.log(`\nMgadi is running with ${ai ? `AI triage (${model}) and rules fallback` : 'safe rules-only triage'}.`);
  console.log(`Laptop: http://localhost:${port}`);
  let networks = {};
  try { networks = os.networkInterfaces(); } catch { /* Restricted hosts may not enumerate interfaces. The server still works. */ }
  for (const network of Object.values(networks)) {
    for (const item of network ?? []) {
      if (item.family === 'IPv4' && !item.internal) console.log(`Phone:  http://${item.address}:${port}`);
    }
  }
  console.log('');
});
