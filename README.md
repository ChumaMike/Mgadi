# hacksecure-soloDolo: Mgadi (Cyber Security Guard)

Team soloDolo · HackSecure 2026 · Track 3, SMME Cyber Protection

Mgadi is a no-install emergency web app that guides an owner-run South African small business through the first hour after a suspected payment-diversion scam, one step at a time, and creates an owner-controlled incident record with evidence fingerprints. Its checksum is not a digital signature or proof of authenticity. Guidance is a draft pending practitioner review.

## Continue with Claude Code

Open this repository in the coordinator tab and read `CLAUDE.md`, then use `team/COORDINATOR-PROMPT.txt`. It includes the product context, a two-person flow/design interview, worker-tab coordination, read-only WhatsApp capability checks, and the authorised GitHub/Vercel handover. Current truth is `entry/SOURCE-OF-TRUTH.md`; deployment setup/status is `entry/DEPLOYMENT.txt`.

Run the event entry with `cd entry` then `npm.cmd start`. Run `npm.cmd test` and `npm.cmd run scoreboard` there. `presentation/` contains the pitch snapshot and brand palette; check its claims against the current entry before presenting.

| Folder | What it is |
|---|---|
| `PLAN.md` | The plan: verdict, architecture, security story, two-day timeline, demo script, fallbacks |
| `BUILD-GUIDE.md` | Step-by-step guide to building it at the event, with commands and judge Q&A |
| `prep/` | Preparation content: draft playbook for review, fraud-line sources, test cases, adversarial cases, redaction notes |
| `rehearsal/` | **PRACTICE BUILD, NOT THE HACKSECURE ENTRY.** A complete working version made on 26 Oct to learn the build and test the demo |
| `entry/` | The entry, built during the event (27 to 28 Oct 2026) |

Quick start (rehearsal):
```bash
cd rehearsal
npm install        # optional: only needed for the AI path
npm start          # http://localhost:3000
npm test
npm run scoreboard
```

All incidents, emails, businesses and amounts in this repo are fictional. No real victim data is used.
