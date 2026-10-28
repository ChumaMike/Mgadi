# Translation coverage (generated: do not edit by hand)

Regenerate with `node scripts/translation-coverage.mjs --write`. A test fails if this file is out of date.

**Every translation in Mgadi is an unreviewed draft.** No language is complete. Text that is not translated stays in English and is
marked `lang="en"` so screen readers pronounce it correctly. Nothing here is a claim of reviewed or complete translation.

| Part of Mgadi | Strings | Dynamic (built at run time) | isiZulu | isiXhosa | Afrikaans |
|---|---:|---:|---:|---:|---:|
| Emergency entry screens (choices, money question, one quick question) | 43 | 0 | 15 (35%) | 15 (35%) | 15 (35%) |
| Payment-diversion guide | 26 | 0 | 24 (92%) | 24 (92%) | 24 (92%) |
| Hacked-mailbox guide | 13 | 0 | 6 (46%) | 6 (46%) | 6 (46%) |
| Suspicious-message guide | 7 | 0 | 3 (43%) | 3 (43%) | 3 (43%) |
| Not-a-cyber-incident and unsure guides | 21 | 0 | 1 (5%) | 1 (5%) | 1 (5%) |
| Ransomware guide (steps, organisation note, trusted resources) | 66 | 2 | 0 (0%) | 0 (0%) | 0 (0%) |
| Bank directory and step screens | 19 | 1 | 7 (35%) | 7 (35%) | 7 (35%) |
| Voice panel: controls, consent and conversation states | 28 | 0 | 9 (32%) | 9 (32%) | 9 (32%) |
| Errors and connectivity notices | 15 | 7 | 0 (0%) | 0 (0%) | 0 (0%) |
| Evidence and incident packs | 45 | 1 | 1 (2%) | 1 (2%) | 1 (2%) |
| Accessibility settings and signing dialog | 22 | 0 | 5 (23%) | 5 (23%) | 5 (23%) |
| Supplier check, responder handoff and POPIA draft (screens and the texts they build) | 164 | 53 | 3 (1%) | 3 (1%) | 3 (1%) |

Catalog size: 89 entries per language (English, Afrikaans, isiNdebele, isiXhosa, isiZulu, Sepedi, Sesotho, siSwati, Setswana, itsonga, Tshivenda, South African Sign Language).
Percentages are translated strings divided by strings plus dynamic strings. Dynamic strings count as untranslated.

## What this means for people

- Only the payment-diversion path and a few core buttons have draft translations. The ransomware guide, the one quick question, the
  evidence and pack screens, the voice panel and every connectivity notice appear in English in all four interface languages.
- Free-text triage is English-first and unverified in isiZulu, isiXhosa and Afrikaans. The choices on the entry screen work in every language.
- Voice: isiZulu and isiXhosa never get voice (the provider lists no support). Afrikaans voice stays blocked because its guide is incomplete.
- Sign language (SASL) is a separate language, not a translation. No reviewed clip exists, so no signing is shown.

## How the count is made, and its limits

- Guidance and data strings are read directly from the data files, so they are exact.
- Interface strings come from a static scan of the literals passed to the translation helpers (`element`, `button`, `tr`, `bindText`, `el`).
  A string assembled at run time is listed as dynamic and counted as untranslated. A literal the scan cannot see would be missed, so
  treat counts as close, not exact. The catalog lookup itself is exact: the catalog entry must exist and differ from the English.
- Nothing here measures translation QUALITY. Every draft needs review by speakers of that language before it is relied on.
