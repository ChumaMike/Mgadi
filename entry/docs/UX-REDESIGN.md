# Mobile-first redesign: what changed, what was tested, what is not done

Branch `feature/final-mobile-ux`, based on `main` at `3243267` (which contains the update-flow and experience work from PR #11 and the WebGL avatar from PR #13). Draft pull request only: nothing here is merged, and nothing was deployed from this branch. **The voice and avatar engineer's PR #14 is still open; see section 7 for how the two fit together and what I tested.**

**Read this first.** The brief mentions an attached "Mgadi mobile-first redesign package". No such file reached this workspace (the uploads folder was empty), so the visual direction was taken from the brief's written style rules, the existing logo and the existing calm ivory-and-forest theme. **No usability testing with people was done**, no real phone was used, and no screen reader was run. Everything below that sounds like a user benefit is a design judgement checked by automated tests, not research.

## 1. Screens redesigned

| Screen | What changed | Why |
|---|---|---|
| **Home** | Five equal-weight cards and a hero card replaced by **two doors**: "I think something has gone wrong" (the five situations as a compact list inside it, one tap each) and "Check before paying". Talk to Mgadi, check a PDF or message, build an incident pack and language/accessibility are calm rows underneath. A "Continue your incident" card appears only while an incident is open on the page. | "Check before paying" was 1,500px down the page under "More than advice". At 390px the page was 2,065px tall; the emergency choices were below a hero card. |
| **Supplier payment check** | One 2,858px-tall form became **three short steps** with a step tracker: Describe, Review, Record. Optional parts (what looked odd, compare the old and new bank details) are folded away. "Already paid" is a bank-first banner on every step. The verdict is a status with a symbol and words: **Confirmed by your call** (green), **Unverified** (amber), **Rejected** (red), each saying what it does not mean. | The form asked for 20 inputs on one screen (5 text and choice fields, 6 tick boxes, 9 bank-detail fields). The three outcomes were two colours of one paragraph. |
| **Evidence Assist** | Stages are now named in order: Evidence selected, Information found, Possible matches, Missing or contradictory, Facts you confirmed, Ready to export. Source chips show the kind and a file fingerprint. Facts are masked to the last four digits of an account number. | The pieces existed but were not separated. |
| **Incident pack** | The six actions are grouped by what they do, each with one line saying so, under a banner "Draft on this device: nothing has been shared" that explains "link created" versus "acknowledged". Hidden in print. | Six buttons of different widths gave no clue which ones share anything. |
| **Settings** | Eleven languages, a plain status line for the chosen language, and a line saying whether live voice exists for it. | See section 5. |
| **Unchanged on purpose** | The guide steps, bank directory, voice panel and avatar, handoff screens, POPIA draft. | They already passed their own suites; changing them was not needed for the brief. |

Before-and-after screenshots of every screen at 320, 360, 390, 430, 768, 1280 and 1920px are in the delivery folder (`ux-redesign/before`, `after`, and side-by-side `compare`).

## 2. Measured differences (same machine, same method, before and after)

| Measure | Before | After |
|---|---:|---:|
| Home page height at 390px | 2,065px | 1,796px |
| "Check before paying" starts at (390x844 screen) | about 1,500px down | on the first screen |
| Supplier check, step 1 card height at 390px | 2,858px | 1,328px |
| First load of the home screen (raw bytes) | 1,096 KB | 433 KB |
| Same, with gzip as the live host applies it (estimate) | about 847 KB | about 184 KB |
| Offline copy saved on first visit | 1,096,268 bytes | 448,518 bytes |

The size change is one fix: the supplied logo is a 743 KB, 1254px picture drawn at about 100 to 190px. The build now makes a 62 KB copy (`public/brand/mgadi-logo-384.png`, same square proportions and colours, averaged down, no new dependency) and the page and offline copy use it. **The original logo file is untouched.** The live host gzips text but cannot shrink a PNG.

## 3. Functionality integrated (nothing replaced by a static mock)

| Feature | Status | Checked by |
|---|---|---|
| Supplier Payment Check, verdict, second-person approval, links | Working; restructured into three steps | tools-smoke 63, ux-smoke, a11y-smoke |
| Cyber triage, entry choices, payment/mailbox/message/ransomware guides | Working, unchanged logic | emergency-smoke 60, browser-smoke 37 |
| Bank fraud-contact directory | Working, header button on every screen | browser-smoke, pwa-smoke, ux-smoke |
| Voice companion (labelled SIMULATION in this build), live captions, floating 3D avatar | Working, untouched | voice-smoke (88 with PR #14; 81 on main today), retell-sdk-smoke 37, experience-smoke |
| Evidence and SHA-256 fingerprints, Evidence Assist (PDF and pasted text read on the device) | Working; stages added | evidence-smoke 47 |
| Incident pack, POPIA draft, responder handoff | Working; actions regrouped | tools-smoke, ux-smoke |
| Offline guidance, update flow | Working | pwa-smoke 34, update-smoke 19 |
| Accessibility preferences | Working; voice availability and language status added | a11y-smoke 79, ux-smoke |
| Security controls (strict CSP, no inline scripts or styles, text set as text, no browser storage) | Unchanged; a source scan test still forbids HTML-from-strings | unit tests, ux-smoke (storage check) |

Not working or not verified is listed in section 8.

## 4. Mobile interaction results (ux-smoke, 75 checks, real Chromium)

- Two primary doors, each with an accessible name; five situations inside the first; all five on the first screen at 390x844; the first three at 360x740.
- Every control on the home screen is at least 44px tall. Every text field is at least 16px, so a phone does not zoom when the keyboard opens. Account number and branch code ask for the numeric keypad; no field offers to remember what was typed.
- No sideways scrolling at 320, 360, 390, 430, 768, 1280 and 1920px on the home screen, supplier check step 1 and step 2, Evidence Assist with a pasted message, and the incident pack (35 measurements).
- No word on a situation, step-answer or supplier-check button is cut across two lines at 320, 360 and 390px, or at 200% text on 320px. (This check found two real defects, below.)
- "Continue your incident" returns to the same step with earlier answers kept. A reload leaves nothing to continue and the page says why. Nothing is written to localStorage, sessionStorage or cookies.
- **The demo scenario as one journey:** supplier warning, "already paid", bank-first guide, the labelled voice simulation (the header bank button stays clear), four steps reported Done, finished incident pack: **12 taps, nothing typed.**
- The home screen loads only from Mgadi itself: no other host, no web fonts, no tracker.

## 5. Languages

All eleven written languages are in the picker, in one registry (`public/accessibility/languages.js`). Switching changes the text on the screen but **not** the incident: typed text and step answers survive four language changes in a row (tested). South African Sign Language is deliberately not in the list: it is a separate pathway and is never produced by translating text.

| Language | Code | Status | Translated of 535 counted strings | Reviewer | Live voice |
|---|---|---|---:|---|---|
| isiZulu | zu | Unreviewed draft | 91 (17%) | none recorded | none (provider lists none) |
| isiXhosa | xh | Unreviewed draft | 91 (17%) | none recorded | none |
| Afrikaans | af | Unreviewed draft | 91 (17%) | none recorded | provider lists it; not verified here; blocked in the product |
| Sesotho, Setswana, Sepedi (Sesotho sa Leboa), siSwati, isiNdebele, Xitsonga, Tshivenda | st, tn, nso, ss, nr, ts, ve | **No translation: English shown, and said so on every screen** | 0 | none | none |

(The exact figures are generated into `TRANSLATION-COVERAGE.md` and a test fails if that file is stale; the table above is a copy.)

**Why seven languages show English.** I did not machine-write money, safety or consent instructions in languages where I cannot check the meaning, and no native speaker has been available. The brief allows either labelled drafts or a transparent English fallback; the fallback is the honest one here. To get real text: `node scripts/translation-export.mjs <code> --out file.csv` makes a spreadsheet for a translator (money and safety wording first); `docs/TRANSLATION-REVIEW.md` is the workflow; `translations/REVIEW-STATUS.json` records reviewers, date and scope, and tests refuse a "reviewed" claim without them.

I added four draft strings to isiZulu, isiXhosa and Afrikaans (the two door titles, "Start the supplier check", "More ways to use Mgadi"). They are mine, they are unreviewed, and they are labelled as drafts like the rest.

Other facts: the page language and every untranslated line are tagged correctly for screen readers (tested for all seven fallback languages); the interface uses Latin letters left to right, and Sepedi and Tshivenda letters (š, ê, ô; ḓ, ḽ, ṅ, ṱ, ṋ) were **not** checked on a real phone font because no text exists in those languages yet; dates and times stay English (en-ZA) because the sentences around them are English and the pack is a document for banks and police. Interface language does not unlock a spoken one: every language is known to the voice service and only English and Afrikaans can ever have a provider voice (tested).

## 6. Accessibility findings

Automated evidence only. Not a WCAG conformance claim, and no assessment by an accessibility specialist was done.

**Passed (machine-checked):** axe-core (WCAG 2.0/2.1/2.2 A and AA tags plus best practice) found no serious or critical issue on the home screen, all three supplier-check steps, Evidence Assist with a source, the incident pack and the isiNdebele English-fallback home, at 390 and 320px; colour contrast in high-contrast mode; keyboard reaches the situation buttons in a few presses with a visible 3px focus ring, and Enter works; "Reduce movement" and the device's reduce-motion setting both remove transitions; 200% text at 320 and 390px has no sideways scroll.

**Defects found by these tests and fixed in this branch:**
1. At 200% text on a 320px phone the words inside the situation buttons broke letter by letter (the text column was 28px wide). Cause: spacing is in `rem`, so it doubled with the text, and an older rule padded the home card. Fixed by scaling spacing down at 150% and 200% text and dropping decorative arrows and icons there.
2. "Not applicable" broke mid-word ("applica / ble") on a 390px phone. Fixed: the three answers sit as Done on its own row and the other two side by side (stacked at large text).
3. The pack's "Check documents" button was dropped by my first version of the new action list; a test caught it and it is back.
4. A sticky update banner scrolled over a button makes axe report overlapping targets. That is a scroll artefact, so that audit now runs at the top of the page; whether focused content stays clear of the banner is checked separately.

**Not tested, and needed:** a screen reader on a real phone (TalkBack, VoiceOver); a real keyboard on iOS and Android; switch and voice control; a person with low vision at real browser zoom (the 200% test uses Mgadi's own text-size setting, which is not the same as browser zoom); anyone with a cognitive or reading difficulty; anyone who has never seen Mgadi. The spacing tokens, contrast pairs and components are in `docs/DESIGN-SYSTEM.md`.

## 7. Coordination with the Voice and Avatar work (PR #14)

The voice and avatar engineer's work is in two parts: PR #13 (merged: the WebGL avatar) and **PR #14 (open draft, `feature/final-voice-avatar`: rebuilt panel, nine states, microphone-first, new tests)**. Its handoff (`VOICE-AVATAR.md`, section 4) sets the rules between us. I read it and followed it:

- **I did not modify** `public/voice/**`, `test/voice-*.test.js`, `scripts/voice-*.mjs`, `scripts/retell-sdk-smoke.mjs` or `docs/RETELL-AGENT-PROMPT.txt`. I had earlier fixed stale assumptions in `scripts/voice-smoke.mjs`; I removed those edits and restored `main`'s version, because PR #14 rewrites that file.
- **One edit in voice territory:** `server/voice.js` gained seven language entries, all "no provider voice", so a written language can never switch on a spoken one (locked by `test/languages.test.js`). Please review that one table.
- `public/index.html` is the shared file. PR #14 links `/voice/voice.css` after `experience.css`; I link `/design.css`. `design.css` does not touch `.voice-panel`, `.vp-*` or `.avatar-*`, so the order `experience.css`, `voice.css`, `design.css` is correct.
- I took the handoff's suggestion that `initVoice(...).catch(...)` in `app.js` should not swallow errors silently: it now writes the reason to the console and text guidance is unaffected.
- The handoff says the old `.vp-stage` rules in `experience.css` are dead. **They are dead only after PR #14 merges:** on `main` today the old panel still builds a `.vp-stage` element, so I left them. Delete them in a follow-up once #14 is in.
- The handoff lists four baseline failures on `main`: the CI runner test (the runner named `experience-smoke` but the file was missing), the handoff-default test, `browser-smoke` and `emergency-smoke`. **All four are fixed in this branch** (the missing suite is added; step labels are read as text; pack outcomes are in the pack by default and the test says so).

**What I tested, exactly.** (a) This branch alone on `main`. (b) A local merge of this branch with PR #14's head (`5d4810f`), which I did not push anywhere. The merge has three trivial conflicts, resolved like this:

1. `public/index.html`: keep both links, in the order `experience.css`, `voice/voice.css`, `design.css`.
2. `scripts/run-browser-suites.mjs`: the union of both suite lists.
3. `TRANSLATION-COVERAGE.md`: generated, so run `node scripts/translation-coverage.mjs --write`.

After that, in the merged tree: unit tests **312 / 312**; browser suites browser 37, emergency 60, **voice 88, voice-avatar 87, voice-live 35**, SDK 37, offline 34, accessibility 79, tools 63, evidence 47, update 19, experience 34 (three checks about the old avatar dock and panel are printed as NOT APPLICABLE and not counted, because the voice suites own that behaviour now), ux 75 (including the demo journey with the new panel open). So the two pieces work together; neither was edited to fit the other beyond the files above.

**The ux and experience suites open the voice panel.** If PR #14 later changes the panel's labels, the checks that break are `ux-smoke` demo 4 ("SIMULATED", "Use text guidance") and `experience-smoke`'s panel checks; they are mine to update.

## 8. Known limitations and what is still untranslated or unreviewed

- Every translation is an unreviewed draft; seven languages have none. The ransomware guide, the quick question, the pack screens, the voice panel, connectivity notices, the supplier check and the POPIA draft are English in every language.
- Free-text triage ("describe it in your own words") is English only.
- Live AI voice has never run against the real provider. Captions and avatar states on a real call are unproven. No voice exists for isiZulu, isiXhosa or any other South African language except Afrikaans (not verified here).
- SASL: no reviewed clip exists, so nothing is signed. The avatar does not sign or translate and does not lip-sync.
- The supplier check does not verify bank ownership and says so; the pack never claims a helper accepted anything.
- Evidence Assist lists every field even when nothing was found for it; collapsing empty fields would shorten it but changes its tested behaviour.
- About 120 older colour literals in `styles.css` and `experience.css` are not yet expressed through the tokens.
- The supplier check's long forms still need one scroll on a 320px phone.
- The service worker's offline copy and the update flow are tested in Chromium only.
- Nothing was deployed from this branch. The live site (https://mgadi.vercel.app) was last deployed from an earlier build.

## 9. Exact results

**This branch alone (on `main` at `3243267`).** Unit tests: **272 / 272**. Browser suites (real Chromium, local server, no external services): browser 37, emergency 60, SDK 37, offline 34, accessibility 79, tools 63, evidence 47, update 19, experience 37, ux 75, all passed. **`voice-smoke` is 81 / 88 on this branch: that is `main`'s own result (the voice engineer reported the same number), caused by the old panel's assumptions, and PR #14 fixes it (88 / 88). I did not edit that file.**

**This branch merged with PR #14 (local test, section 7).** Unit tests 312 / 312; all 13 browser suites passed (experience 34, with three old-panel checks not applicable, as explained).

`npm audit`: 0 vulnerabilities. Triage scoreboard: 0 unsafe on the sealed set (hash matches). Baseline before this work, on the previous `main` plus unpushed test files: 261 unit tests, 498 browser checks.

One intermittent failure to be aware of: in one of seven full runs, `tools-smoke` stopped with a Playwright timeout near its start (32 seconds in); it passed 63 / 63 on four immediate reruns and in every other full run. I did not identify the cause (it happened while other commands were running on the same machine). Treat a single such timeout as a rerun, not as a defect, and tell me if it recurs.

Run: `cd entry && npm ci && npm run build && npm test && npm run test:browser` (browser suites need Playwright and axe-core; set `MGADI_PLAYWRIGHT` and `MGADI_AXE`).
