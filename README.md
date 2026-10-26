# hacksecure-soloDolo: Mgadi (Cyber Security Guard)

Team soloDolo · HackSecure 2026 · Track 3, SMME Cyber Protection

Mgadi is a no-install emergency web app that guides an owner-run South African small business through the first hour after a payment-diversion (business email compromise) scam, one safe step at a time, and hands the bank a tamper-evident incident pack.

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
