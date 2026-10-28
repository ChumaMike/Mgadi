# Translation coverage (generated: do not edit by hand)

Regenerate with `node scripts/translation-coverage.mjs --write`. A test fails if this file is out of date.

**Every translation in Mgadi is an unreviewed draft.** No language is complete. Text that is not translated stays in English and is
marked `lang="en"` so screen readers pronounce it correctly. Nothing here is a claim of reviewed or complete translation.

## Coverage by language

Mgadi's interface lists all eleven written official languages. Strings counted: 535 (the exact total is in the table below; strings built at run time count as untranslated).

| Language | Code | Status | Translated | Share | Reviewer | Voice |
|---|---|---|---:|---:|---|---|
| isiZulu | `zu` | Unreviewed draft | 91 of 535 | 17% | None recorded | No provider voice |
| isiXhosa | `xh` | Unreviewed draft | 91 of 535 | 17% | None recorded | No provider voice |
| Afrikaans | `af` | Unreviewed draft | 91 of 535 | 17% | None recorded | Provider lists it; not verified here |
| Sesotho | `st` | No translation: English shown | 0 of 535 | 0% | None recorded | No provider voice |
| Setswana | `tn` | No translation: English shown | 0 of 535 | 0% | None recorded | No provider voice |
| Sepedi (Sesotho sa Leboa) | `nso` | No translation: English shown | 0 of 535 | 0% | None recorded | No provider voice |
| siSwati | `ss` | No translation: English shown | 0 of 535 | 0% | None recorded | No provider voice |
| isiNdebele | `nr` | No translation: English shown | 0 of 535 | 0% | None recorded | No provider voice |
| Xitsonga | `ts` | No translation: English shown | 0 of 535 | 0% | None recorded | No provider voice |
| Tshivenda | `ve` | No translation: English shown | 0 of 535 | 0% | None recorded | No provider voice |

**Drafts exist for:** isiZulu, isiXhosa, Afrikaans. **No translation yet (English is shown, and says so):** Sesotho, Setswana, Sepedi (Sesotho sa Leboa), siSwati, isiNdebele, Xitsonga, Tshivenda.
The review record is `translations/REVIEW-STATUS.json`. A language moves to "reviewed" only when named reviewers, a date and a scope are written there.

## Coverage by part of Mgadi (languages that have drafts: isiZulu, isiXhosa, Afrikaans)

| Part of Mgadi | Strings | Dynamic (built at run time) | isiZulu | isiXhosa | Afrikaans |
|---|---:|---:|---:|---:|---:|
| Emergency entry screens (choices, money question, one quick question) | 40 | 0 | 26 (65%) | 26 (65%) | 26 (65%) |
| Payment-diversion guide | 26 | 0 | 24 (92%) | 24 (92%) | 24 (92%) |
| Hacked-mailbox guide | 13 | 0 | 6 (46%) | 6 (46%) | 6 (46%) |
| Suspicious-message guide | 7 | 0 | 3 (43%) | 3 (43%) | 3 (43%) |
| Not-a-cyber-incident and unsure guides | 21 | 0 | 1 (5%) | 1 (5%) | 1 (5%) |
| Ransomware guide (steps, organisation note, trusted resources) | 66 | 2 | 0 (0%) | 0 (0%) | 0 (0%) |
| Bank directory and step screens | 15 | 3 | 10 (56%) | 10 (56%) | 10 (56%) |
| Voice panel: controls, consent and conversation states | 29 | 0 | 11 (38%) | 11 (38%) | 11 (38%) |
| Errors and connectivity notices | 13 | 7 | 0 (0%) | 0 (0%) | 0 (0%) |
| Evidence and incident packs | 33 | 2 | 1 (3%) | 1 (3%) | 1 (3%) |
| Accessibility settings and signing dialog | 22 | 0 | 5 (23%) | 5 (23%) | 5 (23%) |
| Supplier check, responder handoff and POPIA draft (screens and the texts they build) | 183 | 53 | 4 (2%) | 4 (2%) | 4 (2%) |

Catalog size: 93 entries per drafted language (English and isiZulu, isiXhosa, Afrikaans).
Percentages are translated strings divided by strings plus dynamic strings. Dynamic strings count as untranslated.

## What this means for people

- Only the payment-diversion path and a few core buttons have draft translations, and only in isiZulu, isiXhosa and Afrikaans. The ransomware guide, the one quick question, the
  evidence and pack screens, the voice panel and every connectivity notice appear in English in every language.
- Choosing one of the seven languages with no translation keeps everything in English, says so on every screen, and keeps text, bank and step guidance working.
- Free-text triage is English-first and unverified in every other language. The choices on the entry screen work in every language.
- Voice: no provider voice exists for any South African language except Afrikaans, and Afrikaans voice stays blocked because its guide is incomplete.
  Choosing a written language never switches on a spoken one.
- Sign language (SASL) is a separate language, not a translation. No reviewed clip exists, so no signing is shown.

## How the count is made, and its limits

- Guidance and data strings are read directly from the data files, so they are exact.
- Interface strings come from a static scan of the literals passed to the translation helpers (`element`, `button`, `tr`, `bindText`, `el`).
  A string assembled at run time is listed as dynamic and counted as untranslated. A literal the scan cannot see would be missed, so
  treat counts as close, not exact. The catalog lookup itself is exact: the catalog entry must exist and differ from the English.
- Nothing here measures translation QUALITY. Every draft needs review by speakers of that language before it is relied on.
- Adding a language or reviewing one: see `docs/TRANSLATION-REVIEW.md`.
