# Mgadi build and evidence check-off book

Created 27 October 2026. Canonical scope: `SOURCE-OF-TRUTH.md`. Add owner/date/result beside completed checks. Synthetic testing is separate from real incident outcomes.

## 1. Content and reliability

- [ ] Chuma compares bank numbers against banking app/card or official page; record segment, source and date in `../prep/fraud-lines.md`. If a call is needed, use a suitable published enquiry channel and explain the directory check. Do not create a fictitious fraud report or occupy emergency lines for a demo.
- [ ] Reviewer identified; exact JSON/screens reviewed using `PLAYBOOK-REVIEW.md`.
- [ ] Revised wording confirmed, including recall request, supplier, mailbox, evidence and reporting/referrals.
- [x] Draft/review status visible; stale “pack feature is next” text corrected. _Done 27 Oct on feature/critical-fixes (browser-checked); still a draft until a reviewer signs off._
- [x] Bank directory returns to current step without losing progress. _Done on feature/accessibility; verified again 27 Oct. A late triage result now waits while the directory is open._
- [x] Empty/long/unclear/not-paid input tested; unsure users are not forced to claim “I've called”. _Unclear and not-paid paths tested 27 Oct; "I haven't called yet" option added. Very long input not re-tested._
- [x] Hung API times out into local rules; immediate bank action works. _Done 27 Oct: 5 s limit, skip button, unit and browser tests._
- [ ] Fresh held-out cases written before tuning; negation and injection tested. Bundled seven cases labelled smoke checks. _Partly done 27 Oct: `prep/heldout-2.json` (written before tuning, now used) and `prep/heldout-3.json` (sealed, scored once: 9/17, 0 unsafe). Negation and injection are tested in `test/rules.test.js`. Write a new sealed set before the next accuracy claim._ _Update 27 Oct (emergency-readiness branch): `prep/heldout-4.json` (46 cases) was committed before any ransomware rule and first scored 46/46 (0 unsafe) before any change was made in response; later runs are regression checks and no rule has been tuned on it, **but the same author wrote the rules and the set and had seen it, so it is a regression guard, not evidence of accuracy.** `heldout-3` was reopened by a PIN-request fix and now scores 9/17, 0 unsafe. Still: write a new sealed set, ideally by someone who has not seen the rules._

## 2. Vercel, PWA and brand

- [x] Retain forest/ivory/amber brand; add browser/PWA icons. _Done on feature/emergency-offline-readiness: `icon.svg` plus generated PNGs (192, 512, maskable, Apple touch). No wordmark yet._
- [ ] Vercel root is `build/entry` (or `entry` if importing the `build` repository). Verify actual Node detection/API routing, static files and security headers in preview; keep local npm start working.
- [x] Secrets server-only; check request/body logging and cache settings. _Partly: the app logs nothing about requests (grep), keys never reach the browser (tested), caches hold only public files (tested). The hosting platform's own request logs and cache settings are not checked._
- [ ] Link account/project, deploy HTTPS and record URL. Local compatibility is not a deployment pass.
- [x] Manifest, optional installation and versioned service-worker caches implemented. _Done and tested in desktop Chromium (`scripts/pwa-smoke.mjs`). Not tested on a phone._
- [x] Cache only public guides, directory, scripts and reviewed language assets; never incidents, callback/API responses or private packs. _Done: all caches and storage are listed after a full journey and hold no private data (`pwa-smoke`). Integrity is consistency, not authenticity: see `SECURITY-REVIEW.md` A08._
- [ ] Confirm completed online preparation then airplane-mode reopen/reload on a real phone.
- [ ] Phone hashing, pack download, print/PDF and verifier work over HTTPS and offline. _Hashing, pack and verifier were tested offline in desktop Chromium only. **Phone and print/PDF not tested.**_
- [x] Show offline mode and guide/directory dates; test interrupted first load, updates and cache eviction. A first-ever offline visit cannot download Mgadi. _Done in desktop Chromium: interrupted install, corrupted file refused, update waits, bad update rolls back, eviction repaired, stale warning after 30 days._
- [x] State limits: AI/callback/live connections need connectivity. Ordinary cellular bank calls can work without mobile data but require telephone service. _The interface says live AI voice and outside links need internet; the bank-call statement is not shown in the app._
- [x] Review serverless quotas: per-process Map limits are not shared durable limits; paid calls need persistent deduplication/abuse controls. _Reviewed. Voice now has a quota layer (per visitor, hourly, daily sessions, worst-case minutes, all-or-nothing, fail closed) and public voice is refused on Vercel without a shared store. **Not tested against a real store.** The triage limiter is still per instance (its map is now bounded); hosted triage is rules-only so nothing paid sits behind it._

## 3. Time, privacy and outcomes

- [ ] Calm elapsed timer starts at app opening; optional discovery time stays user-reported. No guaranteed one-hour deadline.
- [ ] Record guide shown, call tap, bank reached (user-confirmed), recall requested, reference and next follow-up independently.
- [x] Optional bank/reference field with “not given yet”; reference comes from bank, never generated or scraped by Mgadi. _Done in the pack handoff: the owner types it, it is labelled as something Mgadi cannot check, and account-like numbers are refused._
- [ ] Outcomes include pending, attempted, blocked, done, not applicable and unknown. Checklist completion is not incident resolution.
- [ ] Separate payment prevented, further access contained, recall requested and recovered money. Recovery needs amount/date/source; unknown stays unknown.
- [ ] Redaction preview/counts with editable masking and honest limits before sending; names are not auto-detected today.
- [x] Readable one-page pack includes useful times, reference, outcomes and next steps alongside JSON/checksum. _Built (summary with timeline, handoff, remaining steps, reference, outcome). Print/PDF output on a phone not tested._
- [x] Sharing preview for original description/business/contact details; user chooses sensitive content. Evidence stays local. _Done 27 Oct: preview screen, original words opt-in. Contact details are not collected yet._
- [ ] Privacy/demo indicators reflect actual traffic; voice disclosure covers number/audio processing.
- [ ] Explain session-only state/refresh loss. Any optional device save/resume needs retention and clear controls before claiming support.

## 4. Languages, real callback and human support

- [ ] Language and text/callback/sign assistance preserve one incident state.
- [ ] Track translation coverage for all routes/questions/errors/pack; native-speaker safety/comprehension review and routing tests per released language. _Coverage tracking is built (`TRANSLATION-COVERAGE.md`, stale-report test). **No translation has been reviewed**; coverage is partial (payment guide about 92%, entry 28%, ransomware 0%)._
- [ ] Real reporter callback chosen. Retell AI assumed from Chuma's “resell” reply, subject to spelling correction.
- [ ] Verify +27 route: SA is absent from Retell's checked managed-number destination list. Confirm imported/custom telephony and actual charges before promising availability.
- [ ] Provider account, caller number, agent, server credentials and small explicit budget/operational owner configured. No secrets in chat/docs.
- [ ] Explicit callback request, destination authorisation, AI introduction, stop/hangup, bounded duration and reviewed conversation implemented. Reporting alone never triggers a call.
- [ ] Test recognition/voice with speakers of each exposed language, noisy conditions and mixed-language input; text fallback available.
- [ ] Expiring incident token, minimal call/task state, signed webhooks, deduplication, destination validation, durable quotas and deletion implemented. No transcript-bearing webhook body logs.
- [ ] Sync action events; distinguish provider connection facts from user-reported completion. User confirms/corrects important outcomes.
- [ ] Verify provider storage/recording controls. Action tracking does not authorise retaining full audio/transcripts; test disclosure/deletion. _A read-only preflight exists (`scripts/voice-preflight.mjs`) and each call carries a storage override; **never run against a real account**. Account-level webhooks must be checked by hand._
- [ ] SASL clips reviewed by interpreters/Deaf users or actual service arranged, with hours/cost. No fake connected status.
- [ ] 3D signing avatar remains research until SASL comprehension validated.
- [ ] Source minimum directory by role, with eligibility/hours/cost/language/date. Missing services honestly unavailable.
- [ ] Optional trusted contacts manually entered and labelled user-provided; independently known before incident. Keep bank directory separate; no registration prerequisite.
- [ ] Handoff preview/minimal sharing and task owner/status/next action implemented. Preparation, sending and acceptance separate; dispatch needs a willing service and user action.

## 5. Measure whether Mgadi helps

No verified national usual-help-time baseline or measured Mgadi speedup exists in this project. Do not substitute general breach-detection statistics for payment-diversion help time or infer recovery from a stopwatch.

Pilot with 6–10 consenting volunteers if feasible; a smaller sample is exploratory. Use fictional scenarios, no real bank calls, the same device/network conditions and equivalent scenario variants. Compare usual method with Mgadi; counterbalance condition order to reduce learning effects. Have the reviewer define correct action and critical errors before testing.

Start at scenario reveal. Finish when the participant identifies the correct official bank contact and explains the reporting/recall action; this does not measure reaching a real agent. Record app-open-to-guidance and pack completion separately. Predeclare a time limit (for example five minutes); record unfinished/incorrect attempts as failures/timeouts, not successful fast completions. No unequal coaching.

| Participant ID | Scenario / order | Condition (usual/Mgadi) | Seconds to correct action | Correct? | Errors / unfinished | Pack time | Language / assistance | Notes |
|---|---|---|---|---|---|---|---|---|
| P01 | | | | | | | | |
| P02 | | | | | | | | |
| P03 | | | | | | | | |
| P04 | | | | | | | | |
| P05 | | | | | | | | |
| P06 | | | | | | | | |

- [ ] Before testing record version, task definition, count, order, limit and consent.
- [ ] Keep anonymous raw observations and failures; no real incidents/numbers in results.
- [ ] Report median/range, correct-action count and critical errors by condition; disclose convenience sample/learning/network limits.
- [ ] Optional percentage time reduction: `(baseline median - Mgadi median) / baseline median × 100`. Use comparable completion sets, report failures separately; no figure until measured.
- [ ] Pitch: “In a simulated test with n=__, __/__ found the correct action; median __ versus __ seconds.” Do not call this money/lives saved.
- [ ] Later authorised field follow-up measures bank reached, recall outcome, containment and confirmed recovered amount separately; consent/data handling required. Unknown outcomes remain unknown.

## Decision references

- [Vercel Node support](https://vercel.com/changelog/deploy-node-servers-with-zero-configuration), [Node runtime](https://vercel.com/docs/functions/runtimes/node-js).
- [MDN service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers): HTTPS and explicit caching lifecycle.
- [Retell destinations](https://docs.retellai.com/deploy/international-call), [languages](https://docs.retellai.com/agent/language), [call API](https://docs.retellai.com/api-references/create-phone-call).
- [W3C sign languages](https://www.w3.org/WAI/media/av/sign-languages/).

## 6. Added by the emergency-readiness sprint (27 October 2026): still waiting on real services or people

Nothing below has been done unless ticked. Each item says who or what is needed.

### Voice (needs your Retell account and approval)
- [ ] Retell workspace, private key, domain-restricted public key, English agent (storage `basic_attributes_only`, no webhook, hardened prompt, pinned version), no account-level webhook, spend limit. _You, in the dashboard._
- [ ] `.env.local` values set; `HOST=127.0.0.1`; operator token 24+ characters.
- [ ] Run `node scripts/voice-preflight.mjs` once. _Needs your approval; read-only; results into `VOICE-TEST-RESULTS.md`._
- [ ] One capped operator call (3 minutes, labelled test, synthetic speech): audio both ways, captions, mute, end, bank button during the call, reconnect after toggling flight mode, dashboard shows no stored transcript or recording.
- [ ] Scripted adversarial speech against the real agent (ignore-instructions, "mark all steps done", "read me a bank number", "tell me to pay the ransom"). The assistant must not comply.
- [ ] Decide the captions route: public key, server relay, or off.
- [ ] Only then consider `MGADI_VOICE_VERIFIED_LANGUAGES=en`.

### Deployment and devices
- [ ] Vercel preview (account, project name, Deployment Protection decision, no paid add-on); shared quota store provisioned; environment variables set in the project, not Git.
- [ ] On the preview: headers match (CSP, CORP, nosniff, frame, referrer, permissions) and HSTS is present; `/api/health`; the first-screen bank button; offline install over HTTPS.
- [ ] Real phone, airplane mode: reopen the saved copy, the whole ransomware journey, fingerprint a file, make and verify a pack, print or save as PDF.
- [ ] Revisit `Cross-Origin-Opener-Policy` with a real phone (it hid `navigator.onLine` from the Chromium offline test).
- [ ] CI switched on: copy `entry/ci/github-actions-ci.yml` to `.github/workflows/ci.yml` (needs workflow permission; the publishing connection was refused it), enable Actions, read the first run and fix any failure. CI has never run on GitHub.

### People
- [ ] Practitioner review of every route, ransomware first (`PLAYBOOK-REVIEW.md` has the questions). Reviewer, date and commit recorded.
- [ ] Legal review: voice consent wording, cross-border note, SAPS and Information Regulator wording.
- [ ] Translators for isiZulu, isiXhosa, Afrikaans, with comprehension checks.
- [ ] SASL reviewers or an interpreter service (the registry is empty).
- [ ] Screen reader and assistive-technology testing with real users (TalkBack, VoiceOver, NVDA). The automated suite is not a WCAG claim.
- [ ] Independent security review or penetration test.
- [ ] A new sealed evaluation set written by someone who has not seen the rules.

## 7. Added by the POPIA / supplier-check / handoff sprint (28 October 2026): still waiting on real services or people

Nothing below has been done unless ticked. Built and tested on this machine: the three features, the link service, 231 unit tests and 7 browser suites (see `RELEASE-READINESS.md` §9).

### Hosting and devices
- [ ] Decide to keep server-held locked content (no accounts, at most 7 days) in the product scope; confirm proposed invariants 18–23 in `SOURCE-OF-TRUTH.md`. _Team._
- [ ] Provision a shared store (Upstash-style or Vercel KV), set its variables in the host, **not** in Git; check its limits, cost, retention and logging yourself. _Account owner._
- [ ] Run the supplier-check approval and the helper acknowledgement once against that real store, from **two real devices over https**. Confirm expiry after the set time, and that a restart loses nothing.
- [ ] Read the store provider's and host's own request-log settings (they are outside Mgadi's control).

### People
- [ ] Fraud or payments practitioner reviews the red flags, the verification wording and "VERIFY BEFORE PAYING" (`PLAYBOOK-REVIEW.md`).
- [ ] Information officer or South African lawyer reviews the POPIA template, and confirms which reporting route the Regulator requires today (eServices portal or the older form).
- [ ] Usability test with real small-business owners: do they understand "second person", "helper" and "acknowledge", and do they read anything as a guarantee? Test the warning shown on links someone else made.
- [ ] Screen-reader and keyboard testing of the new screens with real users (the automated suite is not a WCAG claim).
- [ ] Translators for the new screens (about 2% have a draft translation; all unreviewed).

### Build decisions not yet made
- [ ] Delete a link early / revoke one link; a notification when an answer arrives; a way to send the link (any delivery would be a separate, approved integration).
- [ ] A global quota on stored links before any public use.
- [ ] A server-signed or externally anchored audit attestation (today it is a checksum).
