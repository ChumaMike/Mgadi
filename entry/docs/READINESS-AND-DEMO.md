# Mgadi: readiness, demo script and release checklist

28 October 2026. Branch `feature/final-mobile-ux`, built on `main` at `3243267` (which holds the merged update, experience and avatar work). Live: https://mgadi.vercel.app (Vercel project `mgadi`, team `chumamikes-projects`).

Status words: **verified working** = exercised end to end and the result recorded here. **implemented but unverified** = the code exists and unit or mocked tests pass, but the real thing has not been run. **simulation/prototype** = labelled as such on screen. **blocked** = cannot work until something outside the code exists. **not implemented**.

A passing test or a visible button is not proof of a working feature. "Evidence tested" says what was really run, where, and with what. Everything below was run with synthetic data, on desktop Chromium, on this laptop's network, unless it says otherwise. **Nothing was tested on a phone, with a screen reader, or with a real microphone or speaker.**

## 1. Readiness

| Item | Status | What works | Evidence tested | Missing dependency | Next action |
|---|---|---|---|---|---|
| Guided text journey and incident classification | **verified working** (rules only) | Five plain choices, or your own words. A fixed-label classifier picks one of five labels; the approved playbook (`public/data/playbook.json`) supplies every step. The AI never writes advice. Hosted triage is rules-only: no AI key is set. | 272 unit tests; scoreboard 0 unsafe on sealed sets; 569 of 576 browser checks on the redesign branch alone (the 7 are `main`'s own `voice-smoke` failures, fixed by the voice PR #14), and 695 of 695 (13 suites) once merged with it; 498 on the earlier build that is live; 11 of 11 live end-to-end checks on the public HTTPS URL (payment route, steps, pack, offline) | Practitioner review of the playbook (it is still "draft guidance" on screen) | Get the playbook reviewed. Only add an AI key after distributed abuse controls exist |
| Step outcomes and revisiting | **verified working** | Every step offers Done, Need help, Not applicable. Progress buttons let you revisit and correct any step; the order for a payment scam is bank, supplier, mailbox, evidence. "Need help" says on screen that nobody is contacted. | experience-smoke (37), handoff unit tests, live check 4 and 5 | none | Chuma to confirm one behaviour change (section 4) |
| Supplier checks | **verified working** | Trusted details vs the request, last four digits only, flags, independent-check status; second-person link works locally | tools-smoke 63, evidence-smoke 47, live check | A shared store for the hosted second-person link (see below) | Create the store |
| PDF and message extraction | **verified working** | Real Chromium-printed PDFs and pasted text read on the device; instructions inside a document are reported, never followed; scanned PDFs are refused honestly | evidence-smoke 47; live PDF and pasted-text checks | none | none |
| Evidence fingerprints and incident packs | **verified working** | SHA-256 on the device; pack with a tamper check; works offline | pwa-smoke 34; live pack made, downloaded and verified over HTTPS | none | none |
| Handoff and reporting drafts, and sharing | **drafts verified; hosted sharing blocked** | POPIA notification draft (template, not legal advice) and responder summary. Sharing links work with a local store. On the hosted site they answer "not available" (503) by design | tools-smoke 63; live check shows the 503 message | An Upstash/Vercel KV store (`UPSTASH_REDIS_REST_URL` and `_TOKEN`) | Chuma creates the store (account step; may cost money) |
| Language coverage | **partial draft; nothing complete** | English is the source. isiZulu, isiXhosa and Afrikaans have draft translations of parts of the app. Each screen now says what you are reading: "draft translation", "part English", or "this screen is in English". No language is marked reviewed. | translation-coverage unit tests; experience-smoke checks the labels. Real numbers: payment guide 92%, ransomware guide 0%, supplier tools 1%, voice panel 38% (see `TRANSLATION-COVERAGE.md`) | Native-speaker review of every language | Reviewers for isiZulu, isiXhosa, Afrikaans |
| Accessibility | **implemented; automated evidence only** | Text size to 200%, contrast, reduced movement, text-only mode, keyboard use, visible focus, 44px targets, sticky bars that do not hide focus | axe: no serious or critical issues on the start, step, seven-step, supplier, evidence, update and voice screens at 390 and 320px (a11y 79, ux 75, evidence 47, update 19). A keyboard check proves no focused control is covered | A screen reader session (TalkBack, VoiceOver, NVDA) and real people | Run the manual checks in section 3 |
| Read-aloud | **implemented but unverified** | Uses the device's own voice, with consent; says so when no matching voice exists | Unit and browser tests of the controls | A device with installed voices and a speaker | Listen on a real phone in each language |
| Real conversational voice (browser microphone) | **blocked** | The whole path is built: server session, consent, quotas, captions, controls. It has never made a real call. | retell-sdk-smoke 37 runs the real Retell SDK against a mocked provider. Live: `mode: mock` only | Retell workspace, agent, keys, the settings in `VOICE-SASL-DESIGN.md`, shared quota store, your microphone | Follow the setup in `VOICE-SASL-DESIGN.md` |
| Live captions | **simulation only** | The simulation shows captions as bubbles. For a real call they come from a separate Retell monitor WebSocket using a domain-restricted public key. | Simulation checks; mocked WebSocket | A real call. Retell community threads report the SDK's `update` transcript event not firing on the v3 gateway transport; Mgadi does not use that event, but this is unproven until a real call | First capped test call (section 5 of the voice doc) |
| 3D companion rendering and behaviour | **verified in the simulation; real-call states unverified** | Original procedural character. Accessible states: connecting, listening, speaking, muted, resting; it is shown while a call connects or runs and hidden and reset when it ends or fails. Reduced motion stills it; text-only hides it; losing 3D never blocks text or voice. The mouth moves at a fixed rhythm while the state is "speaking"; it does **not** follow loudness or words and is **not** lip-sync. | voice-smoke (88 with the voice PR #14, 81 on main today) and experience-smoke (the avatar's states are recorded as the call runs on the old panel); live simulation run (speaking state seen, avatar hidden after End call) | A real agent reply to confirm the audio-level path on Retell's transport; real phones | Check on the first real call |
| Text-to-SASL signing | **not implemented** | "Sign this" opens the guidance transcript and says SASL translation is unavailable. The reviewed-sign list is empty, so nothing is ever shown as signing. | Unit tests that the list fails closed | Rights-cleared, Deaf-reviewed SASL video of a limited phrase set | See the SASL path in `VOICE-SASL-DESIGN.md` |
| Camera-based sign recognition | **not implemented** | Nothing. The interface does not offer it or imply it. | n/a | A research-grade recogniser and a SASL data set that do not exist here | Out of scope |
| Phone callback | **not implemented and blocked** | Nothing places phone calls. | n/a | Retell-managed numbers call only 15 listed countries and South Africa is not one; a +27 route needs custom telephony (SIP trunk) | See the voice doc |
| Hosting and production APIs | **verified working** | Static site, `/api/health`, `/api/triage` (rules), `/api/voice/config`, `/api/links` (503 without a store), security headers, offline copy | Fetched and tested on the live URL; live files are byte-identical to the tested build | A custom domain if wanted | none |
| Updates for returning browsers | **verified working** | An older installed copy now reaches the newest one without developer tools or clearing data; an untouched page switches by itself; a page with typed work keeps its entries and shows a visible banner | update-smoke 19 (a real old service worker as a fixture); on the live URL a browser holding the previous version switched by itself in about 3 seconds with no click | none | none |

## 2. What changed in this release

- **Stale-UI bug.** A waiting service-worker update only took over when every tab was closed, and a reload forgot it. Now: an old install is moved to the new version automatically (the open screen is not reloaded; one more reload shows it); an untouched page switches by itself; a page with entries shows a sticky banner "A newer version of Mgadi is ready. Your answers are kept until you switch." with a 48px button, and never reloads under the person. Tested with the real old worker and on the live URL.
- **Layout.** The step progress is numbered 44px buttons on a phone (seven step titles used to wrap letter by letter); the main action (for a payment scam, "Choose a bank fraud line") is on the first phone screen; "Ready offline" moved to the bottom while all is well and stays at the top when it matters; the voice panel title and SIMULATED badge were hidden behind the desktop header and are not any more; the phone voice panel gives the captions room and the avatar buttons no longer cover the face; the skip link was hidden behind the sticky header when focused and is not any more.
- **Honest labels.** A note on each screen says whether you are reading a draft translation, part English, or English only. "Need help" says it only marks the step.
- **Pack.** Once any step has been reported, the owner's step outcomes are in the pack by default (the owner sees them in the preview and can untick).
- **Tests.** Three stale test assumptions were corrected (text read through CSS `text-transform`, the simulation's wording, content inside a closed `<details>`). Two suites were added: `update-smoke` (19) and `experience-smoke` (37).

## 3. Demo script (about 3 minutes, synthetic incident, public link on a phone)

*Updated for the redesigned home screen on branch `feature/final-mobile-ux`. The live site at https://mgadi.vercel.app still shows the previous home screen until that branch is merged and deployed, so use whichever version you are showing.*

Prepare: open the link once online so it saves itself ("Ready offline" appears at the bottom). Have `demo-files/SYNTHETIC-invoice.pdf` on the phone. The whole path below is tested as one journey (ux-smoke: 12 taps from the supplier warning to a finished pack, nothing typed).

1. **Open** the link. Point at the logo and the **Bank fraud line** button: "The bank is always one tap away." Point at the two doors: "Something has gone wrong, or check before paying."
2. **The scenario.** "A supplier emails changed bank details." Tap **Start the supplier check**, then **Fill in a synthetic example (for a demonstration)**, then **Check for red flags**. Show **Step 2 of 3**: the warning, "Account number: Different" with only the last four digits, and the red flags. Say: "Mgadi cannot verify that an account belongs to anyone, and it says so."
3. **"We already paid."** Tap **I have already paid: take me to the bank first**. The first-hour guide opens on step 1, "Call your bank's fraud line now", with **Choose a bank fraud line** on the first screen. Say: "The AI only chooses the situation; the advice is from the approved playbook."
4. **Voice (only the labelled simulation unless the real test below has passed):** tap **Talk to Mgadi**, tick consent, **Start voice conversation**. Say aloud: "This is a simulation, so no microphone is used." Show the **SIMULATED** badge, the caption bubbles, the avatar speaking, **Mute**, **End call**; the bank button stays visible. Choose **Use text guidance** to return to the same step.
5. **Report the steps yourself.** **Done** on step 1, **Need help** on step 2, **Not applicable** on step 3; tap number **2** in the progress row and change it to **Done**. Point at the tick, tick and dash. Say: "Only the person can report a step. Need help does not call anyone."
6. **The record.** Finish step 4, **Review what goes in the pack**, **Make incident pack**. Show "Draft on this device: nothing has been shared" and the outcomes in plain words. Say: "A link being made is not the same as someone receiving it, and Mgadi never shows a fake accepted status."
7. **Documents (optional):** **Check documents (PDF or message text)**, choose the invoice PDF, pick the account number. Say: "It reads on this phone; nothing is uploaded."
8. **Language (optional, honest):** open **Language and accessibility**, choose isiZulu. Say: "These are drafts no isiZulu speaker has checked, and the note on screen says so." Choose isiNdebele: "No translation yet, so it shows English and says so. Nothing is secretly machine translated."

Prefer the text-first path? Door 1 ("I think something has gone wrong"), **Money or a payment problem**, **I paid after bank details changed** reaches the same guide.

## 4. Fallback script

- **Voice unavailable or the real call fails:** tap **Use text guidance**; the journey, outcomes and pack are unaffected. Say what it is: "Live voice needs a connection and a configured provider."
- **Microphone denied:** the panel says "Microphone permission was blocked" and offers text guidance. Show that this recovery works.
- **No network:** reopen the page; it opens from its saved copy (tested with the server shut down and on the live site). Voice says it needs the internet.
- **PDF will not read:** type the account number into the box under "or type it yourself".
- **Old screen on a returning browser:** reload once. If the banner appears, tap **Switch to newer version**.

## 5. Final checklist

Results I recorded myself:

| Check | Result |
|---|---|
| 272 unit tests | PASS |
| `feature/final-mobile-ux` alone: unit 272; browser suites all pass except `voice-smoke` 81/88 (that is `main`'s own result; the voice work's PR #14 fixes it) | PASS, with that one known gap |
| `feature/final-mobile-ux` merged with the voice PR #14 (local test): unit 312; all 13 browser suites pass | PASS |
| `npm audit` | PASS (0 vulnerabilities) |
| Scoreboard: 0 unsafe, sealed set intact | PASS |
| Live files byte-identical to the tested build (build 43600eafdd23, deployed earlier; **this branch is not deployed**) | PASS |
| Live end-to-end on the public HTTPS URL: 11 of 11 | PASS |
| Live: fresh visit shows the new UI and the logo | PASS |
| Live: a browser holding the previous version switches by itself, no click | PASS |
| Live: voice simulation, SIMULATED badge, captions, avatar, End call | PASS |
| Live: voice configuration reports `mock`, English only; isiZulu and isiXhosa refused with Retell's reason | PASS |
| Real voice call, audible reply, captions matching it | **NOT TESTED** (needs Retell setup and a person) |
| Avatar responding to a real call | **NOT TESTED** |
| Afrikaans voice | **NOT TESTED** (not enabled; Retell lists Afrikaans, but no audio test exists) |
| isiZulu or isiXhosa voice | **NOT AVAILABLE** (Retell does not list them) |
| Phone, TalkBack, VoiceOver, keyboard-only person | **NOT TESTED** |
| Native-speaker review, practitioner review, POPIA review, SASL review | **NOT DONE** |

## 6. Do not claim

- That the voice you showed was a real AI call (unless the real test passed and you ran it).
- That Mgadi stops, blocks, holds or recovers a payment, contacts a bank, or contacted anyone when a step says "Need help".
- That any translation is reviewed or complete, or that isiZulu or isiXhosa work by voice.
- That the avatar signs, translates SASL, understands signing, or lip-syncs. It moves with audio loudness only.
- WCAG conformance, a completed accessibility audit, or a penetration test. Automated checks are evidence only.
- That the playbook is practitioner-reviewed.

## 7. One decision for Chuma

I changed one earlier default: step outcomes (Done, Need help, Not applicable) are now ticked into the pack by default once any step is reported, because the pack is meant to record them accurately. They hold no typed text, they appear in the preview, and the owner can untick them. Free text typed into the handoff form is still opt-in as before. If you prefer outcomes to stay opt-in, revert `defaultPackOptions` in `public/shared/summary.js` and the two tests that name it.
