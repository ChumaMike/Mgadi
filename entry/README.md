# Mgadi: HackSecure 2026 entry

**Before changing anything, read [SOURCE-OF-TRUTH.md](SOURCE-OF-TRUTH.md).** It is the current product, safety, architecture, ownership and change-log document for this build.

Phone-first guidance for the first hour after a possible payment-diversion scam.

Claude Code coordinator: read `../CLAUDE.md` and `../team/COORDINATOR-PROMPT.txt`. The prompt starts an interview with both team members and coordinates app, security, pitch and deployment work through a shared task board.

Vercel setup and publication status: `DEPLOYMENT.txt`. The checked-in Node adapters initially use rules-only triage; local adapter tests do not establish a successful cloud deployment.

## Run locally

```powershell
npm.cmd start
npm.cmd test
npm.cmd run scoreboard
```

Open `http://localhost:3000`. The app works without an AI key using safe local rules. To enable optional AI triage, copy `.env.example` to `.env.local`, add the key there, and never commit it.

## Review flow

1. Describe a scam; details are redacted before triage.
2. Follow the bank, supplier, mailbox and evidence steps.
3. Add evidence: it is fingerprinted in the browser and never uploaded.
4. Make, download and verify an incident pack.

Real callbacks to the person reporting are approved next scope but are not enabled. See `VOICE-CALLS.md` for Retell/+27 routing and setup checks.

## Product review and next build

- [Source of truth](SOURCE-OF-TRUTH.md): current versus approved features and build order.
- [Playbook provenance and reviewer sheet](PLAYBOOK-REVIEW.md): what the draft is based on and how to record feedback.
- [Build and evidence check-off book](REVIEW-AND-TEST-CHECKLIST.md): deployment/PWA, timer/outcomes, privacy/pack, languages/callbacks, contacts and comparison-test sheet.
