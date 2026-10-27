# Mgadi: HackSecure 2026 entry

**Before changing anything, read [SOURCE-OF-TRUTH.md](SOURCE-OF-TRUTH.md).** It is the current product, safety, architecture, ownership and change-log document for this build.

Phone-first guidance for the first hour after a possible payment-diversion scam, and for locked files or a ransom demand (a draft route, not yet reviewed). Works offline after one online visit (tested in desktop Chromium; not yet on a phone). **Status, evidence and what still needs your decision: [RELEASE-READINESS.md](RELEASE-READINESS.md).** Security self-review: [SECURITY-REVIEW.md](SECURITY-REVIEW.md). Real voice has never been run against a real account: [VOICE-REAL-TEST.md](VOICE-REAL-TEST.md).

Claude Code coordinator: read `../CLAUDE.md` and `../team/COORDINATOR-PROMPT.txt`. The prompt starts an interview with both team members and coordinates app, security, pitch and deployment work through a shared task board.

Vercel setup and publication status: `DEPLOYMENT.txt`. The checked-in Node adapters initially use rules-only triage; local adapter tests do not establish a successful cloud deployment.

## Run locally

```powershell
npm.cmd ci
npm.cmd run build          # voice engine bundle, icons, offline manifest (needed for the offline copy)
npm.cmd start
npm.cmd test
npm.cmd run scoreboard
npm.cmd run test:browser   # needs Playwright and axe-core outside the lock file; see entry/ci/github-actions-ci.yml (the CI workflow; not active until copied to .github/workflows/)
```

Open `http://localhost:3000`. The app works without an AI key using safe local rules. To enable optional AI triage, copy `.env.example` to `.env.local`, add the key there, and never commit it.

## Review flow

1. Choose what happened from the five plain choices, or describe it; details are redacted before triage.
2. Follow the bank, supplier, mailbox and evidence steps.
3. Add evidence: it is fingerprinted in the browser and never uploaded.
4. Optionally add details for a bank or specialist, then make, download and verify an incident pack.
5. From the incident pack: draft a **POPIA notification template** for the information officer (not legal advice; sends nothing), or send a short **summary to a helper** by link that the helper can acknowledge.
6. Before paying a supplier whose banking details changed, use **"Check a supplier's changed bank details before paying"**: red flags, a recorded independent check, and a second person who approves or rejects by link. Mgadi never blocks or releases a payment. What the server keeps for these links, and for how long: [LINKS-DATA.md](LINKS-DATA.md).

Real callbacks to the person reporting are approved next scope but are not enabled. See `VOICE-CALLS.md` for Retell/+27 routing and setup checks.

## Product review and next build

- [Source of truth](SOURCE-OF-TRUTH.md): current versus approved features and build order.
- [Playbook provenance and reviewer sheet](PLAYBOOK-REVIEW.md): what the draft is based on and how to record feedback.
- [Build and evidence check-off book](REVIEW-AND-TEST-CHECKLIST.md): deployment/PWA, timer/outcomes, privacy/pack, languages/callbacks, contacts and comparison-test sheet.
