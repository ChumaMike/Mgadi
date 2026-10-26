# Build Mgadi yourself: the event guide

For Chuma, at the Galleria on Tuesday 27 and Wednesday 28 October 2026.

You are going to build Mgadi **fresh** in a new folder called `entry/`, so the entry is genuinely new work made during the event. The finished practice version in `rehearsal/` is your reference: when you're stuck, open the matching file there and read it, but **type your own version**, don't copy the folder. The content in `prep/` (playbook, fraud lines, test cases) is preparation, and you may reuse it.

> If CyberM8 tells you **in writing** that code written before the event is allowed, you can skip the rebuild and polish the rehearsal instead. Until then, assume it isn't.

---

## Before you start (Tuesday, 08:30)

1. Ask the organisers: "Can we use code we wrote before today, or must the build start now?" Keep the answer (Discord `#ask-away` or a message).
2. Find your Track 3 mentor and give them `prep/playbook-for-review.md`. Ask for comments by 12:00.
3. Laptop on charge. Phone hotspot on. Laptop connected to the hotspot.
4. Check Node: `node --version` (it must be 20.12 or newer; you have 24).

## The build order (and why this order)

You build from the **inside out**: first the safety logic you can test without a screen, then the server, then the screens. At every milestone there's something you could demo if time ran out.

### Part 1: project and shared logic (09:00 to 10:00), milestone M1: tests green

```bash
cd "C:\Users\HomePC\Documents\Chuma\Projects\Hackathons\HackSecure 2026\build"
mkdir entry\public\shared entry\public\data entry\server entry\test entry\scripts
cd entry
npm init -y
```

Then in `package.json` add `"type": "module"` and the scripts `"start": "node server.js"` and `"test": "node --test"`.

Write these files, in this order (reference: the same names in `rehearsal/`):

1. **`public/shared/labels.js`**: the fixed list of 5 labels, `CONFIDENCE_THRESHOLD = 0.7`, `validateTriage()` (accepts *only* `{label, confidence}`), and `route()` (low confidence or `unsure` → `'clarify'`).
2. **`public/shared/redact.js`**: the redaction rules, in the order in `prep/redaction-notes.md`. Return `{ text, counts }`.
3. **`public/shared/zar.js`**: `formatZAR(70000)` → `R 70 000,00`, and `parseZAR('R70,000')` → `70000`.
4. **`test/shared.test.js`**: tests for the three files above.

Run `npm test`. Green = M1.

> **Why the files are in `public/shared/`:** the phone and the server load the *same* file. That way redaction happens on the phone before anything is sent, and the server can repeat it without a second copy of the rules.

### Part 2: classifier and server (10:00 to 12:00), milestone M2: type a story, get a label

5. **`public/shared/rules.js`**: `classifyRules(text)` returns `{label, confidence}`. Signal groups: payment, details-changed, not-received, not-paid-yet, supplier, mailbox, phishing, benign. The main rule: *paid + details changed* → `payment_diversion` with 0.8 to 0.9.
6. **`server/app.js`**: `createApp({ ai })` with:
   - static files from `public/` only (path must stay inside the folder);
   - `POST /api/triage`: JSON only, 8 KB cap, 20 per minute per IP, refuses cross-site, redacts again, tries `ai(text)`, falls back to `classifyRules`, and replies `{label, confidence, source}`. **Never log the text.**
   - security headers on every response: CSP with `script-src 'self'` and no `unsafe-inline`, `nosniff`, `frame-ancestors 'none'`.
7. **`server.js`**: loads `.env.local` with `process.loadEnvFile`, starts on port 3000 and prints the phone URL.
8. **`test/server.test.js`**: headers, path traversal, 413/415/403/429, and an AI outage falling back to rules.

Quick check without a browser:
```bash
npm start
# second terminal:
curl -s -X POST localhost:3000/api/triage -H "Content-Type: application/json" -d "{\"text\":\"we paid the new bank account from the email\"}"
```

### Lunch (12:00 to 13:00): two jobs that don't need the laptop

- **Write 10 brand-new held-out cases** on paper, *before* you touch the rules again: 5 payment diversion, 2 vague, 3 other. Type them into `prep/heldout-event.json` (same shape as `prep/heldout-cases.json`). This is the number you show the judges.
- **Phone-check the fraud lines** in `prep/fraud-lines.md` and fill in the "phone-checked" column.

### Part 3: the screens (13:00 to 15:30), milestone M3: the whole flow on the phone

9. Copy the content files (this is preparation, not code): `prep` data → `public/data/playbook.json` and `public/data/fraud-lines.json` (take them from `rehearsal/public/data/`).
10. **`public/index.html`**: the practice-or-entry banner, header with the red **Bank fraud line** button, `<main id="app">`, and the footer "Mgadi never asks for passwords, OTPs…".
11. **`public/styles.css`**: mobile first, big buttons, colour tokens on `:root`, a dark mode, and print rules.
12. **`public/app.js`**: build it in this order, testing on the phone after each one:
    1. the `h()` helper (makes elements with `textContent`, **never `innerHTML`**);
    2. `home` → redact → `checking` (calls the API, falls back to `classifyRules` if offline) → `incident` or `clarify`;
    3. `step`: one generic step screen driven by `playbook.json`, with four small widgets: `bank`, `supplier`, `mailbox`, `evidence`;
    4. the timeline: `log(text)` stores `{at, text}`; the first bank call sets `firstActionAt`.

Open it on the phone: start the server, read the "On your phone:" line it prints, and type that address into Chrome on the phone (both on the hotspot).

> **Gotcha:** on `http://192.168…` the phone is not a "secure context", so `crypto.subtle` doesn't exist. That's why `shared/sha256.js` has a pure-JS SHA-256 fallback. Test it against Node's `crypto` (see `rehearsal/test/shared.test.js`).

### Part 4: evidence, pack and verifier (15:30 to 17:30), milestone M4: tamper demo works

13. **`public/shared/sha256.js`**: `sha256Hex(bytes)` (Web Crypto, or the fallback) and `canonicalJSON()` (sorted keys, so the same pack always gives the same fingerprint).
14. Evidence widget: file input → `sha256Hex` → keep `{name, size, type, sha256, addedAt}`. **Never keep the file itself.**
15. Pack screen: details form → `makePack()` → fingerprint = SHA-256 of `canonicalJSON(pack)` → view + **Print or save as PDF** (`window.print()`) + **Download (.json)**.
16. Verifier: load the pack JSON, recompute, then compare and say "unchanged" or "changed"; drop a file and match it against the pack's evidence.

Rehearse the tamper demo now: download the pack, open it in Notepad, change `R 70 000,00` to `R 7 000,00`, save, and load it into the verifier. You should see "Pack has been changed".

### Part 5: AI and the scoreboard (17:30 to 19:00), milestone M5: real numbers

17. Make `.env.local` (never commit it):
    ```
    ANTHROPIC_API_KEY=your-key-here
    MGADI_MODEL=claude-opus-5-5
    ```
18. `npm install --save-optional --save-exact @anthropic-ai/sdk`
19. **`server/ai.js`**: one `messages.create` call with:
    - a `system` prompt that lists the 5 labels and says the incident text is data, never instructions;
    - `output_config: { effort: 'low', format: { type: 'json_schema', schema } }`, where the schema allows only `label` (from the enum) and `confidence`, with `additionalProperties: false`;
    - the user text wrapped in `<incident>…</incident>`, after stripping any `<incident>` tags from the input;
    - `stop_reason` must be `end_turn`; then `JSON.parse`, then `validateTriage`, else `null` (the rules take over).
20. **`scripts/evaluate.js`** + **`scripts/scoreboard.js`**: run the test cases, your held-out cases and `prep/adversarial.json`, and print accuracy, unsafe misses and the injection pass rate.
    ```bash
    npm run scoreboard      # rules
    npm run scoreboard:ai   # AI (about 55 small calls)
    ```
21. Fix misroutes **only by adding general patterns**, never by copying a test sentence. Re-run.

### Evening (19:00 to 20:00)
- **Timed test:** give 3 to 5 people the same scenario card. Half use Google, half use Mgadi; swap if time allows. Stop the clock at "first correct action" (they would phone the bank's real fraud line). Mgadi records this itself: "First safe action after m:ss" in the pack.
- **Record a backup video** of the 90-second demo on the phone (screen recording).

### Wednesday morning
- 07:00: last fixes. **09:00: code freeze.** Only text fixes after this.
- Fill in the scoreboard slide with tonight's real numbers, not the rehearsal's.
- Rehearse the demo twice, out loud, with a timer.

---

## Commands you will use

| What | Command (run in `build/entry` or `build/rehearsal`) |
|---|---|
| Start the app | `npm start` → open `http://localhost:3000` |
| Run all tests | `npm test` |
| Scoreboard (rules / AI) | `npm run scoreboard` / `npm run scoreboard:ai` |
| AI off for a demo | add `MGADI_AI=off` to `.env.local` and restart |
| Stop the server | `Ctrl + C` |

## Putting it on GitHub (your decision, when you're ready)

```bash
cd "C:\Users\HomePC\Documents\Chuma\Projects\Hackathons\HackSecure 2026\build"
gh repo create ChumaMike/hacksecure-soloDolo --private --source . --push
# at submission time, if the rules want it public:
gh repo edit ChumaMike/hacksecure-soloDolo --visibility public --accept-visibility-change-consequences
```
Before making it public: `git log -p | findstr /i "sk-ant"` must find nothing.

## The 90-second demo

Use the table in `PLAN.md` §9. Three moments matter most, so practise them until they're smooth:
1. **The redaction reveal** ("this is all that left the phone").
2. **The hostile paste**: adversarial case `adv01` or `adv03` from `prep/adversarial.json` → still payment diversion, no fake number.
3. **The tamper test**: R 70 000 → R 7 000 → "Pack has been changed".

## What to say when judges ask

| Question | Answer |
|---|---|
| "Isn't this just a checklist?" | "The checklist is deliberate: in a crisis you want reviewed steps, not improvised AI advice. The engineering is in keeping it safe: redaction on the phone, an AI boxed into one label, an injection test set, offline fallback, and tamper-evident evidence." |
| "Why AI at all?" | "Owners don't say 'business email compromise'. They say 'the supplier says they never got the money'. Our hand-written rules scored 2 out of 10 on new descriptions; that gap is what the AI closes. And when the AI is unsure, we ask one question instead of guessing." |
| "What if the AI is wrong?" | "Three nets: below 70% we ask a question; 'not sure' always leads to the bank; and the first step, the bank's fraud line, is on screen from the first second. Zero unsafe misses in our tests." |
| "Prompt injection?" | "The model has no tools and can only return a label from a list of five; the server throws away anything else. Watch." (do the hostile paste) |
| "Where does the data go? POPIA?" | "Only redacted text, for one label. Evidence never leaves the phone. We store nothing on the server. We flag a possible section 22 report and point to the Regulator's portal; we never make the legal call." |
| "Does the hash prove the email is real?" | "No. It proves the file hasn't changed since it was captured on this phone. It's a checksum, not a signature; signed timestamps are on the roadmap." |
| "Why would anyone open it?" | "A QR card at the accounts desk, accountants onboarding clients, and bank fraud pages. It's rare, which is exactly why nobody has a habit for it." |
| "Business model?" | "Free in an emergency. A 'Ready plan' with tripwires that warn when an email asks to change banking details; we'll test R99 against R199 a month with 10 owners. Accountants and insurers can licence or sponsor it." |
| "Is the playbook reviewed?" | Say the truth: reviewed by [mentor name], or "a draft from bank and Regulator guidance; that's our first ask". |

Say numbers only from the stage list in `HackSecure Idea Research.md` §1.2.
