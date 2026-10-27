# Mgadi: understand the playbook and accessibility build

Status: working accessibility foundation; draft translations; avatar and call experience are prototypes.
Branch: `feature/accessibility`. Your teammate should branch from this branch after pulling it. No merge into main or deployment is implied by a GitHub push.

## What is a playbook?

It is the app's written response guide. It tells Mgadi what to show after a user describes a problem or selects a situation. The AI does not write the safety instructions. It can only choose an incident label and confidence. The app reads the matching instructions from `public/data/playbook.json`.

Think of it as: choose the situation → show the reason → show the action → let the person confirm → move to the next step.

Each incident has a `title`, `summary` and ordered `steps`. Each step has:

| Field | Meaning | Example |
| --- | --- | --- |
| `id` | Stable identifier for integration and signing content | `bank` |
| `title` | The main instruction | Call your bank's fraud line now |
| `why` | Why this action matters | Your bank may be able to stop or recall payment |
| `do` | The instructions shown as a list | Choose the bank; explain the payment; keep the reference |
| `done` | The button the user presses to report completing it | I've called the bank |

A button press is the user's report, not proof that a bank answered or money was recovered. The existing timing field `firstActionAt` is not a measured successful bank intervention.

## The five existing routes

| Situation | Current guide |
| --- | --- |
| Possible payment diversion | Bank → trusted supplier contact → mailbox checks → evidence |
| Possible mailbox compromise | Secure the account → remove unknown forwarding/rules |
| Suspicious message with no payment | Do not pay/click/reply → verify using a trusted contact |
| Possibly not a cyber incident | Double-check; contact the bank if unfamiliar payment occurred |
| Unsure | Contact the bank if money moved |

The bank button remains available from the beginning. Opening bank contacts now preserves the previous screen and input when you return.

## Decisions for Chuma to confirm with the team

1. Is the payment-scam route above the main demo, or must another route be equally complete first?
2. Who will review the English safety guidance and bank directory? The current `reviewed: false` flag must stay false until actual review is recorded.
3. Who can check the isiZulu, isiXhosa and Afrikaans drafts for meaning and comprehension? The first bundle covers the main payment-diversion actions and selected interface text. Other text explicitly falls back to English. These are not complete, approved localisations.
4. Can a Deaf SASL user/interpreter supply or validate rights-cleared signing content? A 3D figure by itself is not a translator. We have not supplied invented SASL motions.
5. For a real callback: which funded provider, +27 telephone route, authorised test number, spending cap and operational owner will you use? The repository already selects real reporter callbacks, with Retell as a candidate. No provider is connected in this change.
6. Is signing output enough for the first working version? Understanding someone signing through a camera is a separate, unimplemented recognition capability.

## What this branch actually does

- Four language choices: English, isiZulu, isiXhosa, Afrikaans. Language switching updates bound text in place; form values and step position survive.
- Draft translations for the main payment-diversion guide and selected controls. Missing strings stay English and carry `lang="en"` for assistive technology.
- Explicit situation buttons let people choose a route without relying on an English free-text classifier. Free-text classification is labelled as unverified in the other languages.
- 100–200% text size, high contrast, reduced motion, keyboard controls and a low-data text-only setting. Settings last for the current page session; incident details are not saved to local storage.
- “Listen” uses an installed browser/device voice matching the displayed text's language. No matching voice means a clear text fallback, not a wrong-language voice. Read aloud requires explicit opt-in because device voices may use online services. Only selected guidance is read, not incident descriptions or evidence.
- “Sign this” opens a keyboard-accessible modal with the guidance transcript. Optional desktop hover opens the same panel; tap and keyboard remain supported.
- Original procedural 3D model: XYZ joint positions, articulated arms and five fingers per hand, perspective projection, depth sorting, model rotation and optional neutral movement. No downloaded model or external renderer dependency. **Neutral animation is not SASL.**
- Reviewed-sign registry fails closed: no reviewed matching content means “SASL translation unavailable”. The registry currently has zero clips.
- A call-experience walkthrough displays the current guidance and avatar. It does not dial, record, capture a camera/microphone or understand signing. The UI explicitly says so.
- Existing server protections remain: fixed-label triage, redaction, local evidence and restricted camera/microphone permissions.

## Code map for you and your friend

| File | Change here when… |
| --- | --- |
| `public/data/playbook.json` | Editing the source safety guide after review |
| `public/accessibility/catalog.js` | Reviewing or extending translations; English source strings are the current lookup keys |
| `public/accessibility/accessibility.js` | Adjusting settings, read aloud, modal and guidance-format controls |
| `public/accessibility/avatar.js` | Improving the original 3D geometry and renderer; do not label new motions SASL without validation |
| `public/accessibility/signs.js` | Registering reviewed SASL media by incident/step ID |
| `public/app.js` | Connecting screen elements to translation bindings and shared guidance-format controls |
| `public/styles.css` | Layout, text size, contrast and mobile accessibility |
| `test/accessibility.test.js` | Checking fallback language, fail-closed signing and safe static delivery |

`guidanceControls(nodes, messageId)` adds Listen and Sign this to a set of guidance nodes. Each node contains only trusted playbook text. For example, the bank step uses `payment_diversion.bank`. `bindText(node, englishSource)` updates that node when language changes. Do not bind a container whose children include user inputs: translation replaces its text.

The registry's future entry format is `{ language: 'sasl', reviewed: true, reviewer: 'Reviewer and review date', src: '/accessibility/media/approved-clip.mp4' }`. Before adding real clips, implement same-origin media delivery and correct MIME/range support on the selected host, record content rights, validate comprehension, add captions/transcript and run playback tests. No clips are shipped or claimed today. Text fallback always remains.

## What to say in the demo

“We have working accessibility controls and draft language support. This is our 3D signing-interface prototype. Validated SASL content and real phone calls are the next integrations.”

Do not say that the avatar translates arbitrary sentences, understands a Deaf user signing, or joins a real call. None of those capabilities is implemented here.

## Integration and testing

Run `npm test` from `entry/`. Run `npm start` for the app (`npm run dev` is equivalent). No dependency installation is required for rules-only mode.

Before merging, fetch your friend's latest work and resolve shared-file conflicts in `app.js`, `index.html` and `styles.css`. Feature branches isolate edits; they do not eliminate merge conflicts. Keep the accessibility modules separate and port the small integration hooks into any newer welcome-screen design.

Test manually: choose a language; enter fictional text; switch language; confirm input remains; use the incident-choice route; open bank contacts and return; check the same step; open Sign this; rotate/pause/close; confirm focus returns; try 200% text, keyboard-only controls and text-only mode. Verify voice presence on actual target devices, with native speakers. Automated tests do not certify WCAG compliance.

## Known limitations

- This branch extends the GitHub baseline, not an exported copy of the newer ChatGPT-hosted preview. That source was not available in this account.
- Non-English coverage is partial and unreviewed; English safety guidance also remains a draft.
- No real callback, microphone transcription, SASL translation/recognition or interpreter service.
- No new backend storage, save-and-resume, offline reopening/service worker or evidence-upload service is introduced.
- Native screen-reader, physical-phone, real device voice and Deaf-user validation remain required.
