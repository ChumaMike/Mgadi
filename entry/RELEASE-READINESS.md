# Mgadi release readiness (27 October 2026)

Branch: `feature/emergency-offline-readiness`, stacked on `feature/live-voice-companion` (PR #3) on `feature/critical-fixes` (PR #2) on `main`. **Nothing has been merged, deployed or pushed to `main`. No real voice call has ever been made.** Every number below is from a run on this branch; "not tested" means exactly that.

## 1. Status at a glance

| Question | Answer |
|---|---|
| Can it be demoed today? | **Yes, on a laptop, with synthetic data**: symptom-first entry, ransomware and payment guides, the bank button, offline reopen with the server stopped, the handoff and incident pack with tamper check, the **labelled SIMULATED** voice conversation, accessibility controls. |
| Is real AI voice working? | **Not verified.** The code, the operator test path and the preflight are written and tested against fakes. No real Retell account has been contacted. |
| Is it deployed? | **No.** There is no URL. Deploying needs your decisions (§5). |
| Is the guidance reviewed? | **No.** All guides are drafts and say so on screen. The ransomware guide was written from public CISA, No More Ransom and NIST material and has had no practitioner review. |
| Is it accessible / secure? | It passes the **automated** accessibility checks written for it and a self-review for security (`SECURITY-REVIEW.md`). That is evidence, **not** WCAG conformance and **not** a penetration test. |
| Does it work on a phone? | **Not tested on any physical phone.** Offline mode additionally needs HTTPS; on a plain-http wifi address the app says it is unsupported. |

## 2. What was verified, and how

Run on this branch from a clean build (`npm run build`). Browser suites use the bundled Chromium (Playwright 1.56) against a local server that blocks every other host.

| Area | Result | Where |
|---|---|---|
| Unit and security tests | **175 / 175** | `npm test` |
| Browser: original flows | 37 / 37 | `scripts/browser-smoke.mjs` |
| Browser: symptom entry, ransomware route, handoff and pack | 59 / 59 | `scripts/emergency-smoke.mjs` |
| Browser: simulated voice, layout, offline loss mid-call | 88 / 88 | `scripts/voice-smoke.mjs` |
| Browser: the **real** Retell browser SDK against a **mocked** provider, incl. hostile transcript and insecure-page operator box | 37 / 37 | `scripts/retell-sdk-smoke.mjs` |
| Browser: offline PWA with the HTTP server shut down | 34 / 34 | `scripts/pwa-smoke.mjs` |
| Browser: axe-core + keyboard + target size + language honesty + SASL gate (12+ screens at 390 and 320 px) | 49 / 49, no serious or critical findings, no minor ones | `scripts/a11y-smoke.mjs` |
| Rules scoreboard (unsealed sets) | smoke 8/8, test-cases 20/20, heldout 10/10, heldout-2 22/22, ransomware-dev 34/34, **0 unsafe** | `npm run scoreboard` |
| Dependency audit | 0 vulnerabilities (27 Oct 2026) | `npm audit` |
| Credential check of every line this branch adds | nothing credential-shaped except the clearly fake `TESTONLY` test fixtures. **GitHub's own secret scanner could not be used** (Advanced Security is not enabled), so this is my own pattern scan, not a guarantee | `SECURITY-REVIEW.md` §7 |
| Reproducible build | byte-identical across two builds in one install, **and across two separate installs** (this working copy against a clean clone of the published branch, same fixed date): engine bundle, 4 icons, offline manifest | `SECURITY-REVIEW.md` §7 |
| Fresh-clone check of the **published** branch | a clean `git clone`, `npm ci`, build, 175 unit tests, scoreboard (the sealed set's hash matches its record) and all six browser suites (304 checks) passed with the numbers above. Run on the branch as published before the final documentation commit; after it only documentation and the scoreboard's printed label changed | `git clone` of `feature/emergency-offline-readiness` |

**Mutation checks** (a defence was deliberately broken, the test confirmed to fail, then restored) were done for: the ransomware rules tests, the handoff and redaction tests, the transcript-hardening tests (unit and through the real SDK), the security and HTTP-probe tests (including a deliberately catastrophic regex), the offline suite (3 mutants) and the accessibility suite. They were **not** done for the older `browser-smoke` and `voice-smoke` suites or the routing checks in `emergency-smoke`, so a green result there shows the checks pass, not that each would catch a regression.

**Sealed evaluation sets, honestly.** `prep/heldout-4.json` (46 synthetic cases, SHA-256 `906406f7…332b8c`) was committed **before** any ransomware rule was written and **first scored** 46/46 before any change was made in response to it (later runs of the scoreboard, including the fresh-clone check in the table above, are regression checks on a file whose hash still matches its sealed record; no rule has been tuned on it): no unsafe payment, ransomware or mixed-incident routing, no over-triage. **Caveat: the same author wrote the rules and the set and had seen it, so this is a regression guard and not evidence of real-world accuracy.** `prep/heldout-3.json` was **reopened** (a PIN-request fix was made after reading one case) and now scores 9/17 with 0 unsafe; its misses go to the one-question clarify screen. Free text in isiZulu, isiXhosa and Afrikaans is not verified.

## 3. What is implemented but NOT verified against anything real

| Item | Why it is unverified | What would verify it |
|---|---|---|
| A real Retell call: audio, microphone, captions, the agent's behaviour | No account was contacted | The approved first call in `VOICE-REAL-TEST.md`, results written into `VOICE-TEST-RESULTS.md` (currently an empty template) |
| Agent preflight (`scripts/voice-preflight.mjs`, read-only) | Only run against a local fake | Run once with your key, after you approve |
| The Retell public key being allowed to open the transcript socket | Documented as unclear | The same first call |
| The shared quota store (Upstash REST / Vercel KV) | Only a fake REST store was used | Provision one, run the preview |
| HTTPS and the Vercel build and runtime | No deployment exists | A preview deployment (§5) |
| Offline mode and installation on a **phone** | Only desktop Chromium | A real phone over HTTPS, airplane mode |
| Screen readers, real assistive technology users | Only automated checks | Testing with real users and TalkBack/VoiceOver/NVDA |
| CI on GitHub | **Not active.** The workflow could not be published to `.github/workflows/` (the connection was refused permission), so it sits at `entry/ci/github-actions-ci.yml`. Its steps were run locally | Copy it to `.github/workflows/ci.yml` with an account that has workflow permission, then read the first run |

## 4. What is still simulated

`MGADI_VOICE_MODE=mock` is a scripted conversation with a visible **SIMULATED** badge; no microphone is used and nothing leaves the device. In `scripts/retell-sdk-smoke.mjs` the real SDK runs, but Retell's REST API, WebRTC gateway and transcript socket are mocked. The operator-test flows, the quota store and the preflight were exercised against fakes.

## 5. Waiting on you

Numbered so you can answer by number. Nothing here has been done.

1. **Merge order.** Recommended: PR #2 (`feature/critical-fixes`) first, then PR #3 (`feature/live-voice-companion`; retarget to `main` once #2 is in), then the new PR. I have not merged anything and will not without your explicit go-ahead.
2. **Practitioner review** of all playbook routes, especially ransomware (`PLAYBOOK-REVIEW.md`), and review of the South African reporting and POPIA wording (SAPS, Information Regulator): drafted from public sources, unreviewed.
3. **Legal review** of the voice consent wording and the cross-border note (the provider may process audio outside South Africa).
4. **Translators** for isiZulu, isiXhosa and Afrikaans (`TRANSLATION-COVERAGE.md` shows what exists: e.g. payment guide about 92%, entry screen 28%, ransomware guide 0%; all unreviewed drafts). **SASL reviewers**: the reviewed-clip registry is empty, so the signing dialog says plainly that no reviewed clip exists.
5. **Retell account steps** (you, in the dashboard; never paste keys into chat or Git): a private API key; a public key restricted to your allowed domains; an English agent with data storage `basic_attributes_only`, no webhook, the hardened prompt from `VOICE-COMPANION.md`, a pinned version; **no account-level webhook**; a **spend limit**; ideally a dedicated workspace. Then `.env.local` values (`MGADI_VOICE_MODE=retell`, `RETELL_API_KEY`, `RETELL_PUBLIC_KEY`, `RETELL_AGENT_ID_EN`, `RETELL_AGENT_VERSION`, `MGADI_OPERATOR_TOKEN`; `HOST=127.0.0.1`).
6. **Approve the preflight and ONE capped operator test call** (3 minutes, labelled as a test, synthetic speech only, including the scripted adversarial lines in `VOICE-REAL-TEST.md`). Record the result in `VOICE-TEST-RESULTS.md`. Only after that, consider `MGADI_VOICE_VERIFIED_LANGUAGES=en`.
7. **Vercel preview** (needs: which account or team, project name, whether Deployment Protection stays on, that no paid add-on is bought). Build command comes from `vercel.json` (`npm run build`). Environment variables go in the project settings, not Git. A **shared store** (Upstash or Vercel KV, may cost money) is required before the public may use voice; without it public voice stays refused. Operator tests work on a preview and are refused on production unless you set `MGADI_OPERATOR_ALLOW_PRODUCTION=yes`.
8. **CI** (a small action for you): copy `entry/ci/github-actions-ci.yml` to `.github/workflows/ci.yml` on this branch (GitHub web UI: Add file > Create new file), enable Actions if it is off, and read the first run. I could not do this: the connection I publish with is refused permission to write workflow files. Until you do, nothing runs automatically on the pull request.
9. **Decision after the first real call**: captions via the public key, a server relay, or captions off.
10. Judging criteria for the hackathon were not provided; send them and I will map the demo to them.

## 6. Exact blockers to "deployed and demo-ready on a phone"

(a) Your Vercel decisions (item 7). (b) A real phone over HTTPS to confirm offline and installation. (c) Real voice is blocked on items 5 and 6. (d) The guidance carries a draft badge until item 2 is done. None of these can be completed by writing more code.

## 7. The strongest truthful demo available now

Laptop, `localhost`, synthetic data. Say only what is shown.

1. Open the app. **Five plain choices** and the verified bank button are on the first screen. Nothing asks the person to name an attack.
2. Choose **"My device or files are locked"**. Show the ransomware guide: the **draft badge** (not reviewed by a practitioner), the "go to IT or security first" note for larger organisations, "do not pay or reply" without asking whether a payment was made, trusted resources (CISA, No More Ransom, NIST) marked as outside Mgadi and needing the internet.
3. **Offline.** Visit once online (wait for "Ready offline"), stop the server, reload: the app reopens from the saved copy with its security headers intact, and the whole journey, evidence fingerprinting and pack work. Say: "shown in Chromium on a laptop; phones are not tested."
4. **Handoff.** Add optional details, preview what goes in the pack, make it, read the specialist summary ("reported by the owner (a tap)", never "completed"; "No referral was made"), change one value and show the **tamper check** fail. Say: a checksum, not a signature.
5. **Voice, simulated.** Run with `MGADI_VOICE_MODE=mock`: the SIMULATED badge, live captions, the avatar, tasks and timeline, the bank button during a call. Say plainly that real voice is not yet verified.
6. **Accessibility.** 200% text, the language switch (untranslated text stays English and is marked so), the signing dialog that says no reviewed clip exists.

Do **not** say: reviewed, secure, WCAG compliant, offline on phones, real-time AI voice, accurate in isiZulu/isiXhosa/Afrikaans, or "46/46 accuracy" without the caveat in §2.

## 8. Commands

```
cd entry
npm ci && npm run build
npm test
npm run scoreboard
npm run test:browser        # needs Playwright 1.56 and axe-core outside the lock file; see entry/ci/github-actions-ci.yml
MGADI_VOICE_MODE=mock npm start     # simulated voice for the demo
```

---

## 9. Addendum: POPIA draft, supplier payment-change check, responder handoff (branch `feature/popia-supplier-check-handoff`, 28 October 2026)

Stacked on `feature/emergency-offline-readiness` (PR #4, draft). **Nothing is merged, deployed or pushed to `main`; no external service, account or paid product was used or created.** The data statement is `LINKS-DATA.md`; the security addendum is `SECURITY-REVIEW.md` §10.

### 9.1 Built, mocked, not built

| | Built (real code, tested) | Mocked or only simulated | Not built |
|---|---|---|---|
| **POPIA draft** | Template built in the browser from the incident pack; downloadable text; says "template for the information officer, not legal advice" first and last; leaves the section 22 decision to the information officer; sends nothing | — | Review by a lawyer or information officer; translations; filling the Regulator's own form; any submission |
| **Supplier payment-change check** | Request log, red flags, "VERIFY BEFORE PAYING", independent-verification record (a number from the request itself does not count), second-person approve/reject by link with no account, first answer wins, replay harmless, SHA-256 audit record with export and a verifier, "already paid" goes to the bank-first guide. Never blocks or releases a payment | The "second person" is a second browser profile on the same machine in the tests | Notifying the second person (the owner shares the link); proving who the second person is; a server-signed attestation; Mgadi keeping an audit copy; practitioner review of the red flags |
| **Responder handoff** | Owner-approved preview, smaller than the pack, shared by link; contact presses **Acknowledge**; statuses draft / sent / acknowledged; acknowledging is never "accepted"; the sender cannot acknowledge their own summary | Same second-profile caveat | Any delivery (email, SMS, WhatsApp); a responder accepting or declining; task tracking beyond this |
| **Link service** | Create / read / decide / acknowledge, 7-day expiry, hashed codes, locked content, memory store, Upstash-style REST store, fail-closed on errors, refusal on Vercel without a shared store, Vercel adapter `api/links.js` | **The shared store is only a fake that speaks the same protocol.** It has never talked to a real Upstash or Vercel KV store | A real store; "delete now"; revoking one link; a global quota |

### 9.2 What was verified (28 October 2026, desktop Chromium, synthetic data, local server, no external hosts)

| Area | Result | Where |
|---|---|---|
| Unit, HTTP and security tests | **231 / 231** (175 existing + 56 new) | `npm test` |
| Browser: the new tools (two separate browser contexts as owner and second person) | **63 / 63** (four of them with the server shut down) | `scripts/tools-smoke.mjs` |
| Browser: accessibility, now including 10 new screens at 390 and 320 px and keyboard/focus/target checks on them | **76 / 76**, no serious or critical findings (was 49) | `scripts/a11y-smoke.mjs` |
| Browser: the existing suites, unchanged | browser 37, emergency 59, voice 88, real SDK vs mocked provider 37, offline 34 (all passing) | `npm run test:browser` runs all 7 suites; 394 checks in total |
| Mutation checks on the new tests | 67 runs including re-runs; 8 survived at first (7 real test gaps in 3 areas, 1 vacuous mutation of mine); all closed. See `SECURITY-REVIEW.md` §10.5 | by hand |
| Real bugs found by the tests | 3 fixed: retry re-sealed with a new IV (owner stuck on a lost reply), memory store never removed expired entries, handoff accepted non-string lines | `SECURITY-REVIEW.md` §10.4 |

**One unexplained intermittent failure.** `tools-smoke` failed **once**: the first run after I edited three of its checks timed out waiting for the "This link cannot be used" screen in the section that opens tampered links in a fresh browser context. The **12 runs that followed all passed 63/63** (one run, then eight in a row, then three straight after a rebuild). I did not capture the failed run's full output, so **I do not know whether it was a slow start-up of the test machine or a real race in how the app boots on a link address.** If it recurs in CI, treat it as a possible race in `openFromHash` at start-up and look there first.

**Offline (tested with the HTTP server shut down, desktop Chromium):** the supplier check with its red flags and VERIFY BEFORE PAYING, and the POPIA draft with its download, work from the saved copy (4 checks in `tools-smoke`). Making, reading or answering a link needs the internet: the screens say "This needs an internet connection. Nothing was sent.", the helper summary stays a draft, and no link is made. The saved copy picked up the new public files automatically (the precache version changed); `pwa-smoke` still passes 34/34.

**Not run on this branch or not repeated:** any phone, any second real device, any screen reader, any real store, any deployment.

### 9.3 Waiting on you (numbered; continues from §5)

11. **Confirm the scope change.** Mgadi's server now keeps locked content for up to 7 days (no accounts, nothing readable). `LINKS-DATA.md` lists it exactly. Proposed invariants 18–23 are in `SOURCE-OF-TRUTH.md` §5.
12. **Choose a shared store before any hosted use.** On Vercel, links are refused without one. An Upstash-style store needs an account **you** create (check its limits and any cost yourself; I have not signed up for anything). Until then a hosted preview shows the feature as unavailable, which is the intended fail-closed behaviour.
13. **Who reviews the wording.** POPIA draft: an information officer or lawyer. Supplier-check red flags and verification questions: a fraud or payments practitioner. Both are drafts and say so. The "second person" and "helper" wording needs a usability test with real small-business owners (not done).
14. **Decide the sharing channel guidance.** Today the screens say the link can be read by whoever carries it. Decide whether to recommend a channel.
15. Still open from §5: items 1–10 (merge order, Vercel account, Retell, CI, practitioner review, translators, and so on).

### 9.4 The strongest truthful demo of the new features

Laptop, `localhost` (WebCrypto needs https or localhost), synthetic data, **two browser windows (the second one private) standing in for two people on one machine**. Say only what is shown.

1. Home screen: the five choices and bank button are unchanged. Open **"Check a supplier's changed bank details before paying"**. Point to the first notice: Mgadi cannot stop, block or release a payment.
2. Enter a synthetic supplier, "banking details changed", "by email", tick "they asked me not to phone". Show the red flags with their written levels and **VERIFY BEFORE PAYING**.
3. Record a verification. First choose "a number taken from the request" and show it does **not** count; then choose "an old invoice", tick "I made this call myself" and save. Say: this is the owner's report; Mgadi cannot check the call.
4. Create the link for the second person. In the **private window** open it: the second person sees the request and the owner's report with a warning that Mgadi has not checked who sent it. Press Approve. Show the owner's page change **by itself** (checks every 8 seconds) with the server's time. Reload the second person's link: nothing to press. Say: first answer final.
5. Make the audit record: SHA-256 fingerprint, "not a signature", "Mgadi does not keep this record". Export it, change one word in the file, load it in the checker: "This record has been changed."
6. Make an incident pack. Show **Draft a POPIA notification (template)**: the disclaimer first and last, the blanks, the decision left to the information officer, no breach asserted. Download it.
7. **Send a summary to a helper**: the preview, what is not included, the draft status, tick approve, create the link; open it in the private window and press Acknowledge. Say: acknowledged means seen, not accepted.
8. Show `LINKS-DATA.md`: what the server keeps and for how long.

Do **not** say: Mgadi approves, verifies or protects a payment; the second person is "verified"; POPIA compliant or legally reviewed; works on phones; delivered; end-to-end secure against a hostile server; or that the shared store works.

### 9.5 Exact blockers to "hosted and demo-ready"

(a) A shared store (item 12) before links work on Vercel. (b) A real second device over https to see two people use it. (c) Wording review (item 13). None can be completed by writing more code.
