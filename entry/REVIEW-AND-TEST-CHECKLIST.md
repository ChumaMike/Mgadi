# Mgadi build and evidence check-off book

Created 27 October 2026. Canonical scope: `SOURCE-OF-TRUTH.md`. Add owner/date/result beside completed checks. Synthetic testing is separate from real incident outcomes.

## 1. Content and reliability

- [ ] Chuma compares bank numbers against banking app/card or official page; record segment, source and date in `../prep/fraud-lines.md`. If a call is needed, use a suitable published enquiry channel and explain the directory check. Do not create a fictitious fraud report or occupy emergency lines for a demo.
- [ ] Reviewer identified; exact JSON/screens reviewed using `PLAYBOOK-REVIEW.md`.
- [ ] Revised wording confirmed, including recall request, supplier, mailbox, evidence and reporting/referrals.
- [ ] Draft/review status visible; stale “pack feature is next” text corrected.
- [ ] Bank directory returns to current step without losing progress.
- [ ] Empty/long/unclear/not-paid input tested; unsure users are not forced to claim “I've called”.
- [ ] Hung API times out into local rules; immediate bank action works.
- [ ] Fresh held-out cases written before tuning; negation and injection tested. Bundled seven cases labelled smoke checks.

## 2. Vercel, PWA and brand

- [ ] Retain forest/ivory/amber brand and “The first hour, guided”; add icon/wordmark and browser/PWA icons.
- [ ] Vercel root is `build/entry` (or `entry` if importing the `build` repository). Verify actual Node detection/API routing, static files and security headers in preview; keep local npm start working.
- [ ] Secrets server-only; check request/body logging and cache settings.
- [ ] Link account/project, deploy HTTPS and record URL. Local compatibility is not a deployment pass.
- [ ] Manifest, optional installation and versioned service-worker caches implemented.
- [ ] Cache only public guides, directory, scripts and reviewed language assets; never incidents, callback/API responses or private packs.
- [ ] Confirm completed online preparation then airplane-mode reopen/reload on a real phone.
- [ ] Phone hashing, pack download, print/PDF and verifier work over HTTPS and offline.
- [ ] Show offline mode and guide/directory dates; test interrupted first load, updates and cache eviction. A first-ever offline visit cannot download Mgadi.
- [ ] State limits: AI/callback/live connections need connectivity. Ordinary cellular bank calls can work without mobile data but require telephone service.
- [ ] Review serverless quotas: per-process Map limits are not shared durable limits; paid calls need persistent deduplication/abuse controls.

## 3. Time, privacy and outcomes

- [ ] Calm elapsed timer starts at app opening; optional discovery time stays user-reported. No guaranteed one-hour deadline.
- [ ] Record guide shown, call tap, bank reached (user-confirmed), recall requested, reference and next follow-up independently.
- [ ] Optional bank/reference field with “not given yet”; reference comes from bank, never generated or scraped by Mgadi.
- [ ] Outcomes include pending, attempted, blocked, done, not applicable and unknown. Checklist completion is not incident resolution.
- [ ] Separate payment prevented, further access contained, recall requested and recovered money. Recovery needs amount/date/source; unknown stays unknown.
- [ ] Redaction preview/counts with editable masking and honest limits before sending; names are not auto-detected today.
- [ ] Readable one-page pack includes useful times, reference, outcomes and next steps alongside JSON/checksum.
- [ ] Sharing preview for original description/business/contact details; user chooses sensitive content. Evidence stays local.
- [ ] Privacy/demo indicators reflect actual traffic; voice disclosure covers number/audio processing.
- [ ] Explain session-only state/refresh loss. Any optional device save/resume needs retention and clear controls before claiming support.

## 4. Languages, real callback and human support

- [ ] Language and text/callback/sign assistance preserve one incident state.
- [ ] Track translation coverage for all routes/questions/errors/pack; native-speaker safety/comprehension review and routing tests per released language.
- [ ] Real reporter callback chosen. Retell AI assumed from Chuma's “resell” reply, subject to spelling correction.
- [ ] Verify +27 route: SA is absent from Retell's checked managed-number destination list. Confirm imported/custom telephony and actual charges before promising availability.
- [ ] Provider account, caller number, agent, server credentials and small explicit budget/operational owner configured. No secrets in chat/docs.
- [ ] Explicit callback request, destination authorisation, AI introduction, stop/hangup, bounded duration and reviewed conversation implemented. Reporting alone never triggers a call.
- [ ] Test recognition/voice with speakers of each exposed language, noisy conditions and mixed-language input; text fallback available.
- [ ] Expiring incident token, minimal call/task state, signed webhooks, deduplication, destination validation, durable quotas and deletion implemented. No transcript-bearing webhook body logs.
- [ ] Sync action events; distinguish provider connection facts from user-reported completion. User confirms/corrects important outcomes.
- [ ] Verify provider storage/recording controls. Action tracking does not authorise retaining full audio/transcripts; test disclosure/deletion.
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
