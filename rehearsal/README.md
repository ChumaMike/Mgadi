# Mgadi rehearsal: PRACTICE BUILD, NOT THE HACKSECURE ENTRY

Made on Monday 26 October 2026, before the event, so Chuma can see the finished idea, test the demo and learn the build. **Do not submit or present this as the entry** unless CyberM8 has confirmed in writing that pre-built code is allowed. The entry is built fresh in `../entry/` following `../BUILD-GUIDE.md`.

## Run it
```bash
npm install          # optional; installs the Anthropic SDK for the AI path
npm start            # prints a laptop URL and a phone URL
npm test             # 24 tests
npm run scoreboard   # triage accuracy, unsafe misses, injection pass rate
```
AI triage needs `ANTHROPIC_API_KEY` in `.env.local` (copy `.env.example`). Without it, the built-in rules run and everything still works.

## Files
```
server.js                 start-up: loads .env.local, picks AI or rules, prints URLs
server/app.js             static files + POST /api/triage (caps, rate limit, headers, fallback)
server/ai.js              the only AI call: strict JSON schema, one label, validated
public/index.html         shell: practice banner, red "Bank fraud line" button, footer promise
public/app.js             all screens (DOM + textContent only, no innerHTML)
public/styles.css         mobile first, dark mode, print view for the pack
public/shared/labels.js   the 5 labels, validation, routing (shared by phone and server)
public/shared/redact.js   redaction (runs on the phone and again on the server)
public/shared/rules.js    rule-based classifier (server fallback and offline phone fallback)
public/shared/sha256.js   SHA-256 via Web Crypto, with a pure-JS fallback for plain-http phones
public/shared/zar.js      R 1 234,56 formatting and parsing
public/data/*.json        draft playbook and dated fraud-line directory
scripts/                  evaluation + scoreboard (reads ../prep/*.json)
test/                     node --test suites
```
