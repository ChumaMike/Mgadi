# Mgadi final release handoff (28 October 2026)

Branch `feature/final-demo-integration`. Read this first for what is ready, what is blocked and the exact action each blocker needs. Every number is from a run on this branch; "not done" means not done.

## 0. The one-paragraph truth

The application is integrated and tested on a laptop: the supplier check now compares **trusted details against the request**, reads **PDFs locally**, and compares sources; the voice, avatar, packs, links, POPIA draft and offline copy are all on the branch and pass their tests. **It is not deployed, real voice has never been run, and nothing has been tested on a phone.** Those three need things only you can provide (a Vercel login, Retell credentials and a physical phone). Sections 2 to 4 say exactly what to do.

## 1. What this branch adds on top of `main` (def0aaf)

| Area | What |
|---|---|
| **Scene A: trusted details vs the request** | `public/shared/baseline.js`. The owner enters trusted bank details (from a contract, earlier invoice or saved record) and the details in the request; Mgadi shows field-by-field Same / Different, plain flags (account differs: High; holder differs: High; bank or branch differs: Medium; weak baseline: Medium) and "Verify before paying". Full account numbers stay in the browser: only the last four digits are shown, shared or saved. A button fills in a clearly labelled **synthetic example**. The independent-check status is shown at the top and is always "reported by the owner". |
| **Evidence Assist, local** | `public/shared/pdf-text.js` (bounded PDF text reader: plain or Flate streams, ToUnicode fonts, refuses encrypted and image-only files), `evidence.js` (candidate details with a source and a masked snippet; amounts, accounts, branch codes, names, references, invoice numbers, dates), `public/tools/evidence-ui.js` (the owner chooses what to use or types it; sources are compared; agreement is never called proof; a downloadable, verifiable evidence summary with file fingerprints, no file bytes). Instruction-like text in a document is reported as a warning and never followed. Nothing is uploaded. |
| **Joined up** | The comparison and the reviewed evidence travel inside the sealed link (second person sees them), the audit record and its fingerprint. A "Check documents" button is also on the incident pack screen. |
| **Release** | `engines.node` pinned to `22.x` (it was `>=20.12`, which made Vercel choose **Node 24**, which was never tested). `scripts/make-qr.mjs` makes a branded QR and **decodes its own output**. |

Not changed, on purpose: the voice controller, avatar dock and Retell adapter. I audited them against Retell's current documentation (see 6) and they match; I cannot improve what I cannot run against a real call.

## 2. A. GitHub

| | |
|---|---|
| Integration branch | `feature/final-demo-integration`. It was created from 8b0c5b5; Chuma merged that earlier state as PR #8 at 23:39 UTC on 27 October, so `main` already holds it, and this branch now holds only what is new (18 files) |
| Already on `main` | all earlier code, tests and scripts, and the documentation from PR #7 (PRs #2, #3, #6 and #8, merged by Chuma) |
| Open | **PR #9** (this branch, draft, base `main`). PR #4 (a stacked draft from an older branch) is redundant and can be closed: your call |
| Not merged by me | Nothing. Merge only with your explicit go-ahead |

## 3. D. Testing (this branch, desktop Chromium, synthetic data, local server)

| | Result |
|---|---|
| Unit | **257 / 257** (231 before, plus 26 for the baseline, PDF and evidence logic) |
| Browser, 8 suites | **441 checks, all pass** (run through `scripts/run-browser-suites.mjs`, which fails on any skip): browser 37, emergency 59, voice 88, real SDK vs mocked provider 37, offline 34, accessibility 76, tools 63, and the new **evidence-smoke 47** (comparison, real PDFs, pasted text, second person, no storage, two widths, axe on six new screens at two widths, server shut down). The earlier suites are unchanged. |
| Scoreboard | unchanged, 0 unsafe; sealed set hash matches |
| `npm audit` | 0 vulnerabilities |
| `vercel build` (the real CLI, run locally, nothing deployed) | completes; `links`, `triage`, `health` and `voice` functions are packaged with `server/` and `public/shared/`; security headers are in the generated routes; runtime `nodejs22.x` after the pin. `DEPLOYMENT.txt` used to say "pick Node 24.x"; it now says 22.x, the version every test here ran on |
| Mutation checks | 14 on the new logic; 2 survived at first (accounts sharing their last four digits were treated as equal; company words in names), tests added, both killed. 3 more on the browser suite (fieldset overflow, unmasked snippet, a flag removed): all three caught |
| Real PDFs | Invoice and proof of payment printed by Chromium (CID fonts with ToUnicode maps) are read correctly and uploaded through the real file input in the browser test, including with the server shut down |

**Not run:** any phone, any physical device, any screen reader, real Retell audio, a real shared store, the Vercel runtime itself (only the local build), a signed-out check of a live URL.

**Real defects found and fixed in this pass:** the evidence snippet showed a full account number; the summary's "conflicts" left out disagreements with the trusted details; the new fieldsets overflowed at 320px; manually typed amounts like "R 70 000,00" were not understood; Vercel would have run Node 24.

## 4. What only you can do (smallest exact actions)

**1. Vercel (deployment is blocked on this; I have no Vercel access).** Never paste credentials into the chat.
- Easiest: Vercel dashboard, Add New, Project, import `ChumaMike/Mgadi`. Set **Root Directory** to `entry`, Framework **Other**. Leave the build and output settings (they come from `vercel.json`). Deploy the branch `feature/final-demo-integration` as a Preview first.
- Or, from a terminal you are logged in to: `cd entry && vercel link --project mgadi`, then `vercel deploy`. (`vercel login` is interactive.)
- Check first whether a `mgadi` project already exists, so we do not create a second one. If the repo is already connected, the merge to `main` may already have produced a deployment: look in the Deployments tab.
- Then send me the Preview URL and I will run the HTTPS checks against it (headers, `/api/health`, triage, offline manifest, file hashing).

**2. Shared store (needed for the second-person link and the helper link on a hosted site).** Create an Upstash Redis database (directly, or from the Vercel Marketplace) and add its REST URL and token to the Vercel project as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` and `KV_REST_API_TOKEN`) for Preview and Production. Check its limits and any cost yourself. Without it, the hosted site shows "Sharing links are not available" (a 503), which is the intended safe behaviour. Everything else works without it.

**3. Judge-facing public URL.** In Vercel, Production environment, set `MGADI_VOICE_MODE=mock`. That shows the voice panel as a **labelled SIMULATION** (a visible SIMULATED badge) with no microphone and no cost. Do not set the Retell variables on Production. (Checked locally by emulating `VERCEL=1`, `VERCEL_ENV=production`, mock mode and no shared store: `/api/voice/config` answers 200 with `simulated: true` and English available, because the simulation runs in the browser and creates no server session. Not checked on Vercel itself.) Check Settings, Deployment Protection, and make sure the production URL opens **in a signed-out browser** (a protected preview will not work for judges).

**4. Real voice (Preview only, operator-restricted).** Follow `VOICE-REAL-TEST.md`. In the Retell dashboard: a dedicated workspace; a private key; a public key restricted to your Preview domain (Preview URLs change); an English agent with data storage `basic_attributes_only`, no webhook, the prompt from `VOICE-COMPANION.md`; a **spend limit**. In the Vercel Preview environment: `MGADI_VOICE_MODE=retell`, `RETELL_API_KEY`, `RETELL_PUBLIC_KEY`, `RETELL_AGENT_ID_EN`, `RETELL_AGENT_VERSION`, `MGADI_OPERATOR_TOKEN` (24+ characters). Then tell me; I will run the read-only preflight and ask you to approve **one** capped, labelled test call before anything chargeable happens. The result goes into `VOICE-TEST-RESULTS.md`.

**5. Real phone.** On an Android phone over the HTTPS URL: microphone prompt, audio heard, captions, bank button visible, supplier check, evidence PDF upload, pack download, then airplane mode and reopen. Tell me what you see; I will record device, browser, date, URL and commit.

**6. QR code.** Only after steps 1 and 3 give a URL that opens signed out: `MGADI_PLAYWRIGHT=... MGADI_QR_LIBS=<folder with qrcode, jsqr, pngjs> node scripts/make-qr.mjs https://the-final-url qr-out`. It writes a PNG and a PDF and fails unless the picture decodes back to exactly the URL. A person must still scan it with a different phone.

## 5. Release gates

| | Status |
|---|---|
| P0 stable integrated app, tests passing, no critical regression | **Met on a laptop** (sections 1 and 3) |
| P0 successful Vercel Preview | **Blocked: needs your Vercel login** (4.1). Local build verified |
| P0 payment-diversion journey, supplier check, incident pack | Met in tests |
| P1 verified real Retell voice, live captions, synchronised avatar | **Not verified.** Code path matches Retell's docs; never run against a real call (4.4) |
| P1 evidence extraction and source matching | **Met locally**, including real PDFs |
| P1 real shared store | **Not done** (4.2) |
| P1 real phone and offline test | **Not done** (4.5) |
| P2 Gmail connected discovery | **Not built, and I recommend not building it** (see 6) |
| P2 Android "Share to Mgadi" | **Not built** |
| P2 translation | Not improved: about 1% of the new screens' text has a draft translation; all unreviewed |

## 6. Decisions and findings worth knowing

- **Retell audit (current docs, 28 Oct).** `RetellClient.createWebCall()`, `/v3/create-web-call`, a proxied `fetch` that keeps the private key on the server, and the transcript socket needing the **public key in the browser** (domain-restricted, optionally reCAPTCHA) all match the existing adapter. Retell's own demo notes that a page rendering transcripts needs that key in the browser or a relay through an authenticated backend. This is the documented risk R1: captions are the only reason the public key is in the page. If the first real call shows captions are refused for that key, the safe fallback already exists (the app says "Live captions unavailable" and the call continues); do **not** widen the key. The `get-agent` path used by the preflight is still an assumption and the preflight fails closed.
- **Gmail.** `gmail.readonly` is a restricted scope. Google says an app in testing mode shows a tester warning screen, has a user cap and limited refresh-token lifetime, and that data stored on or transmitted through a server needs an independent security assessment. A browser-only flow would need Google's script on our page, which breaks our `script-src 'self'` rule. Not worth it for this release; the local PDF and pasted-message route covers the same need without any of that.
- **Sharing links and identity.** Possession of an approval link does not identify the person who used it. The screens already say so.
- **No false claims.** Nothing in the app says it contacted a bank, verified a supplier or delivered a report. A "Same" comparison says it does not make the request genuine; "Sources agree" says agreement is not proof. A test enforces this wording.
- **No parallel agents.** This session has no subagent or session-messaging tool, so I did the workstreams one after another on one branch. Nothing was delegated and no one else's work was integrated.

## 6b. The demonstration, with exact taps (about 70 seconds)

Use the synthetic fixtures only. Public URL: simulated voice (labelled). Operator Preview: real voice, only after section 4.4 has passed.

| Seconds | Tap or say | What to point at |
|---|---|---|
| 0 to 20 (A) | Home: **Check a supplier's changed bank details before paying**; **Fill in a synthetic example (for a demonstration)**; **Check for red flags** | "Account number: Different. Trusted ending 7890, request ending 1234." The High flag. **VERIFY BEFORE PAYING.** "Independent check: not recorded yet." Say: Mgadi compares; it cannot tell which account is genuine and it cannot stop a payment |
| 20 to 30 (C) | **Start again**, then **I have already paid: take me to the bank first** | The first step is "Call your bank's fraud line now". The bank button is in the header on every screen |
| 30 to 55 (B) | **Talk to Mgadi**, agree to the consent, **Start voice conversation** | Your words in the "You" bubble, the reply in the "Mgadi assistant" bubble, the avatar listening and speaking, **Mute microphone**, **Use text guidance**. On the public URL the **SIMULATED** badge is visible; say so |
| 55 to 70 (D, E) | Press **I've called the bank** only if true; continue to the evidence step; **Make incident pack**; **Check documents (PDF or message text)**, add the invoice PDF | The extracted details with where they were found, "Sources DISAGREE" on the account, the reminder that agreement is not proof; hold on the incident summary. Say: Mgadi helps check a suspicious payment, take the first response and keep a usable record |

**Backup if voice fails:** tap **Use text guidance**; the steps, timeline and pack are unaffected. **Backup if the network fails:** after one online visit the guide reopens offline (tested with the server shut down). **Backup if the PDF will not read:** type the account number by hand in the evidence panel (tested).

Press "I've called the bank" only if the person really did: it records the owner's own report, never that the bank acted.

## 7. Remaining reviews (unchanged, none done)

Practitioner review of the playbook and supplier-check wording; information officer or lawyer review of the POPIA text; translators for isiZulu, isiXhosa and Afrikaans; SASL reviewers (the clip registry is empty, so no signing is shown and the avatar is not presented as a translator); usability test with small-business owners; independent security testing. Automated accessibility checks are evidence, not a WCAG claim; internal security tests are not a penetration test.
