# Mgadi UI/UX audit and incremental improvement — 28 October 2026

## Source of truth
Branch starts from main commit `52d10dbcde000ba697025725eb2b0cccfeb8e78e`. Reviewed open PR #24 (unified live call and 3D signing preview) and PR #15 (older, diverged mobile redesign). The compact voice and evidence permission branches are already behind main; their relevant code exists in main. This work deliberately avoids rewriting voice controllers, consent, evidence hashes or backend services.

## Screen inventory and primary job
| Screen | Main user job | Result |
|---|---|---|
| Landing / choose an incident | Understand how to start, pick the closest incident | Preserved existing five choices, text/voice and tools; removed forced focus on voice after choosing |
| Describe incident / AI triage | Describe uncertainty; get safe route, with fallback | Preserved; backend verification still required |
| Clarification / paid vs not paid | Answer the one necessary follow-up | Preserved |
| Emergency step guide | See one response action; mark Done, Need help or Not applicable | Added Previous step navigation and grouped Start new incident |
| Bank contact directory | Find fraud numbers quickly without Mgadi calling | Preserved |
| Browser voice workspace | See active call status, captions, visual companion and current action | Preserved. Existing optional visual gestures are not validated SASL |
| Evidence selection | Explicitly choose files and record fingerprints | Simplified evidence copy, grouped optional inputs; retained native file picker and non-blocking optional prompt |
| Pack privacy review | See exactly what will be included; opt into extra details | Clearer privacy-focused heading and pending generation feedback |
| Generated pack | Download report; inspect technical/tamper data when desired | Download moved ahead of long summary; technical details remain under disclosure |
| Supplier-change verification | Verify instructions before paying | Preserved, no backend changes |
| PDF/message checks | Examine evidence locally | Preserved |
| POPIA template and handoff | Prepare optional communication | Preserved |
| Language/accessibility | Change display language and accessibility preferences | Preserved, not certified or reviewed |
| TalkBack demo/gesture preview | Alternative demonstration or illustrative animation | Preserved but not claimed as live verified SASL or real voice |

## Important limitations and audit observations
- The older draft PR #15 is 84 commits behind main and overlaps app/CSS; do not merge it automatically.
- PR #24 is three commits ahead of main and modifies the call entry; review and integrate separately.
- The landing retains multiple paragraphs and may exceed one screen at 320px; this change does not claim a complete landing redesign.
- Browser voice may require secret Retell credentials, a verified language, shared quotas and a real microphone acceptance test. Provider output has not been validated in this task.
- Accessibility needs real phone, keyboard, 200% zoom and assistive-tech testing. Static inspection is not certification.
- Evidence access means selecting files manually, never general device access. The original files do not go into the report.
- The existing logo artwork was preserved, not replaced or duplicated.
- Backend incident rules, reviewed playbooks, hashing, redaction, pack verification, consent and language fallbacks remain intact.
- A working local clone and graphical browser were not available in this execution environment. No live voice, native file-picker, production site or browser acceptance testing is claimed.

## Release gates
1. Run `cd entry && npm ci && npm test && npm run build && npm run test:browser`.
2. Test 320/375/390/768/desktop at 200% zoom, keyboard, reduced motion, screen reader.
3. Test payment-diversion bank-first sequence, Done/Need help/Not applicable, evidence Deny/Accept picker and incident pack generation on HTTPS.
4. Verify actual Retell audio, both speakers' captions and 3D controls on protected preview; mark any simulated mode explicitly.
5. Confirm PR #24 integration order before merge; request owner approval before production release.

## What changed in this branch
- `public/app.js`: evidence/report journey information hierarchy, backwards navigation, in-progress feedback, and de-emphasis of technical hashes.
- `public/product-ux.css`: narrow-phone-friendly reusable styling for report stages and actions.
- `public/index.html`: loads the scoped enhancement stylesheet.
No core controller, server or model changes.
