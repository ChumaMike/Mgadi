# Translating and reviewing Mgadi

Mgadi's interface is built to carry all eleven written official languages of South Africa. **Today only three have any translated text (isiZulu, isiXhosa, Afrikaans), all of it an unreviewed draft. The other seven show English and say so.** Nothing here is a claim of reviewed or complete translation. South African Sign Language (SASL) is a separate language with its own pathway: it is never produced by translating text.

| What | Where |
|---|---|
| The eleven languages and their `lang` codes | `public/accessibility/languages.js` |
| The translations (keyed by the exact English text) | `public/accessibility/catalog.js` |
| Who has reviewed what (names, date, scope) | `translations/REVIEW-STATUS.json` |
| Coverage per language and per part of the app (generated) | `TRANSLATION-COVERAGE.md` |
| A spreadsheet for a translator or reviewer (generated) | `node scripts/translation-export.mjs <code> --out file.csv` |

## How the product behaves

- A language the person chooses changes the text on the screen they are on. **Their incident, evidence, typed text and step answers are not reset.**
- Text with no translation stays English and is tagged `lang="en"`, so a screen reader pronounces it correctly. A short note on every screen says whether it is a draft, part English or English only.
- The note never says "reviewed". There is deliberately no such state in the screen text until `REVIEW-STATUS.json` records real reviewers (and a test is changed on purpose).
- Choosing a written language never switches on a spoken one. Live voice needs provider support, an agent and a test with speakers (see `docs/VOICE-SASL-DESIGN.md`). The provider lists no voice for any South African language except Afrikaans.
- Dates and times stay in English (en-ZA) because the sentences around them are English and the incident pack is a document for banks, police and insurers. Revisit this when whole sentences are translated.
- Every language here uses Latin letters, left to right. Sepedi (š, ê, ô) and Tshivenda (ḓ, ḽ, ṅ, ṱ, ṋ) use letters that some older phone fonts lack; check them on a real phone when text exists.

## What a reviewer does

1. Ask for the spreadsheet: `node scripts/translation-export.mjs st --out mgadi-sesotho.csv` (use the language code). Rows are sorted so **money and safety wording comes first** (bank call, "do not pay", supplier verification, consent, POPIA).
2. For each row, write *approve*, *change* or *reject*, and the corrected text. Keep placeholders such as `${...}` exactly as they are.
3. Check **meaning, not only spelling**, especially:
   - "Call your bank's fraud line now" and "only your bank can try to stop or recall the payment" must not imply that Mgadi or anyone else can stop money.
   - "Done", "Need help" and "Not applicable" must stay clearly different from each other. They become the person's own record.
   - "Mgadi cannot check it" and "nothing was sent" must survive translation.
   - Consent wording for voice and sharing must say what happens to the person's information.
4. Do not paste machine output as a final answer. A machine draft may be a starting point; a person who speaks the language decides.

## What a maintainer does with the answers

1. Add the approved text to `catalog.js` under the language code, using the exact English text as the key (see the existing entries). Keep one entry per string.
2. In `translations/REVIEW-STATUS.json` set the language's `status` (`in-review` or `reviewed`), list `reviewers`, `reviewedOn` and the exact `reviewedScope` (for example "payment-diversion guide only").
3. Run `node scripts/translation-coverage.mjs --write` and the tests. A test fails if the coverage file is stale, if a language is marked `reviewed` without reviewers, a date and a scope, or if a language marked `not-started` has any text.
4. Only then change the on-screen wording from "draft" to anything stronger, and only for the recorded scope.

## Priorities (in this order)

1. The payment-diversion guide, the bank screens, the entry choices and the supplier check.
2. Consent and privacy wording (voice, sharing, POPIA draft).
3. The hacked-mailbox, suspicious-message and ransomware guides.
4. Everything else.

## What is still missing

No professional translator or native-speaker reviewer is recorded for any language. The seven languages without text need translators first. Free-text triage ("describe it in your own words") is English only. SASL needs signers, deaf-community reviewers and licensed clips, not translation.
