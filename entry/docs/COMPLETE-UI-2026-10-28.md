# Mgadi UI implementation and acceptance record

Implemented from `main` at `52d10dbc`, in `entry/`, on `feature/complete-premium-ui-20261028`. No production merge or promotion.

## Screens

| Screen | Change |
| --- | --- |
| Landing | Complete authentic logo, bank shortcut and existing language/accessibility controls; concise welcome; accurately labelled browser readiness; text/call actions above the fold at 320×568; incident icon cards; secondary tools below. |
| Clarification | One question, short choices and Back. An answer immediately enters guidance. |
| Response | Incident, status-aware progress, Step X of Y, numbered instructions and bank action. Done / Need help / Not applicable before detail; previous-step navigation; expandable reasons, sources and draft status. |
| Voice | Full-screen grid: existing 3D/lite character at left, captions as the main content, shared current instructions and reserved bottom controls. Options contains privacy, previews, gestures, operator tests, actual language/accessibility settings, history and clearing. |
| Evidence | Optional non-modal prompt in page flow, native chooser, honest file-read errors, removable metadata and expandable hashes. Personal fields remain optional. Access explanation includes current-page memory lifetime. |
| Review | Masked description, inclusion choices, exact step outcomes and selected metadata; expandable additional report information. Revisit steps or return to evidence without losing data. |
| Result | Completion follows actual pack creation; summary/download first, Review again and New incident; expandable full report, fingerprint, verification and existing specialist tools. Printing expands the readable report. |

## Preserved behavior

The voice controller, Retell adapter, quota/consent enforcement, caption ordering and assistant-audio level input remain in their existing modules. The separate TalkBack workspace remains available through Options; its source is untouched. Existing read-aloud consent, language registry/fallback disclosures, reduced motion, low-data mode, high contrast, reviewed-sign lookup and screen-reader announcements remain.

Browser speech animation follows utterance start/end/error events and is labelled as having no measured audio level. Manual animation previews stay labelled. Illustrative gestures never claim validated SASL.

Existing incident state, owner-reported outcomes, redaction, triage, bank data, playbook advice, fingerprints, report format, tamper checks and supplier/document/POPIA/helper tools remain. New incident clears previous evidence/progress. The evidence picker reads only explicitly selected files, calculates metadata/fingerprints locally, and never uploads file contents.

## Open PR inspection

Inspected #15, #24, #25 and #26 before implementation. #15 is substantially diverged; #24 changes call entry and gesture defaults; #25/#26 overlap these UI screens. This branch starts from current main, implements unified call entry and previous-step navigation directly, and leaves those PRs open. Review overlap before merging. No voice controller or provider code was replaced.

## Verification

Run with Node 24.22.1 (project declares 22.x), local Chromium, Playwright and axe-core 4.11.0. Synthetic incidents/files only; no paid provider calls.

- Build passed: Retell bundle, icons and integrity-checked offline manifest.
- Unit tests: **300/300 passed**; baseline was 294/300. Updated stale language/handoff expectations, filled missing existing-source metadata, regenerated translation coverage, retained the review disclosure and added the previously missing browser suite.
- New `experience-smoke`: **103/103 passed**, covering all seven screens, axe WCAG A/AA checks, 320/390/768/1440 widths, 200% type and short landscape, native chooser/deny/cancel/read failures, metadata-only reports, actual JSON download, tamper rejection, shared progress, bank dialog announcements, Options settings and browser speech lifecycle. Screenshots inspected during implementation.
- Real SDK, mocked provider: **37/37 passed**. Navigation/Options selectors updated to reflect the new UI.
- WebRTC audio suite: **27/35 passed**. Mocked peers stayed in `new`; eight ICE/audio/mute measurements failed. This is not live audio acceptance. Controller, adapter and level algorithms were not changed.
- Rules scoreboard passed its safety gates: zero unsafe payment/ransomware/mixed cases, sealed set intact. Existing classification misses remain in the output; no fresh accuracy claim.
- `git diff --check` passed.

## Remaining acceptance

Real Retell, physical Android/iOS audio/file selection, TalkBack and VoiceOver still need testing. No validated SASL clips exist; translations and playbook remain draft-labelled.

The legacy general browser suite stopped at its inherited `Get safe next step` selector, which already differed from the baseline button. The full legacy batch was not certified; other old suites assume immediate incident-tile navigation or a floating avatar. Their migration remains outstanding. The new complete acceptance suite covers the current journey. `npm start` hit this runtime's `os.networkInterfaces()` restriction; browser suites used the same application through local `createApp` servers.

GitHub CI is inactive: the existing workflow lives under `entry/ci/`, not `.github/workflows/`. These are local results.


## Additional end-to-end demo enhancements (same branch, after the initial acceptance run)

This draft now also implements:
- A plain-language bank feedback field on the relevant step. It does not imply Mgadi contacted the bank; text is pattern-redacted and included only when the owner chooses the handoff details.
- **Go to evidence & report** from the response steps, without marking any remaining step as Done. The evidence screen can return to the active response step without losing progress.
- Privacy switches to exclude both evidence metadata and the timeline from the downloaded JSON. This choice is reflected in the review and generated report; original files are never embedded.
- Mobile sizing and focus affordances for the optional controls.
- New unit tests in `test/product-journey-ux.test.js` and expanded checks in `scripts/experience-smoke.mjs`.
- Read-only `.github/workflows/mgadi-ui.yml` for unit tests, build and redesigned Chromium journey checks.

**Verification distinction:** The 300-unit/103-browser/37-mocked-SDK results above were obtained before these additional commits. The new code and assertions were reviewed and committed through GitHub, but there is no completed GitHub Actions result for the final commit yet; **do not label the new head tested** until CI actually runs and passes. The Vercel status for the latest head reports a build-rate-limit failure, not a confirmed source-code failure. A prior READY preview belongs to an earlier commit and does not include all enhancements.

No production deployment, branch merge, secret changes, provider calls or release approval was performed.
