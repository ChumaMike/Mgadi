# AGENTS.md: Mgadi, HackSecure 2026 (team soloDolo)

Chuma Meyiswa and Dalindyebo Mdledle, Track 3 (SMME Cyber Protection), 27–28 Oct 2026, The Galleria, Sandton.

## What we're building
Mgadi: a phone-first web app that walks a small business through the first hour after a payment scam (a "supplier" changed bank details and they paid a fraudster). Story in, personal details redacted on the phone, the AI picks ONE of five labels (it never gives advice), reviewed playbook steps follow, the bank's fraud line is on screen from the start, evidence is fingerprinted (SHA-256) on the phone, and an incident pack with a tamper check comes out.

## Read first
- `BUILD-GUIDE.md`: build order, milestones M1–M5, file-by-file spec, duo split.
- `PLAN.md`: architecture, threat model, POPIA, demo.
- `prep/`: test cases, held-out cases, adversarial cases, playbook, fraud lines, redaction notes (reusable content).
- `rehearsal/`: a finished PRACTICE build. Reference only: read it, don't copy it into `entry/`.

## Rules
1. The entry is built fresh in `entry/` during the event. Never copy `rehearsal/` into `entry/` unless the organisers have allowed pre-written code in writing.
2. Build inside out: shared logic + tests → server → screens → evidence/pack → AI + scoreboard. Judges' tip: lock in the core incident-labelling flow first; everything else is a stretch goal.
3. No secrets in code, commits, logs or chat. Keys go in git-ignored `.env.local` only. Never log incident text.
4. Zero-framework Node (20.12+), ES modules, `node --test`. DOM via `textContent`, never `innerHTML`. CSP `script-src 'self'`.
5. The AI may only return `{label, confidence}` from the fixed enum; validate it, and fall back to the rules on anything else.
6. Fix misroutes with general patterns, never by copying a test sentence.
7. Plain South African English; money as `R 1 234,56`; mobile first.
8. Do not push to GitHub or change repo visibility unless Chuma asks.
9. Skhokho is not part of this entry.
10. Say plainly what you could not test.

## Commands (in `entry/` or `rehearsal/`)
`npm test` · `npm start` (prints laptop and phone URLs) · `npm run scoreboard`
