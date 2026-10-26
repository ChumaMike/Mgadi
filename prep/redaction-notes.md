# Redaction notes

Redaction runs **on the phone before sending, and again on the server**. Order matters: an email address contains dots and a link can contain digits, so links and emails go first.

| Order | Tag | What it catches | Example in → out |
|---|---|---|---|
| 1 | `[LINK]` | `http://`, `https://`, `www.` | `https://fnb-secure-verify.co.za/login` → `[LINK]` |
| 2 | `[EMAIL]` | anything@domain.tld | `accounts@ridge1ine.co.za` → `[EMAIL]` |
| 3 | `[AMOUNT]` | `R70k`, `R 70 000,00`, `R70,000`, `R500`, `70k` | `Pay R 70 000,00` → `Pay [AMOUNT]` |
| 4 | `[PHONE]` | SA numbers: `0` + 9 digits, `+27` + 9 digits, with spaces or dashes | `011 555 0199`, `+27 82 555 1234` → `[PHONE]` |
| 5 | `[NUMBER]` | any run of 6+ digits (account, ID, card, branch codes) | `62841937465` → `[NUMBER]` |
| 6 | `[NAME]` | words the owner types in "names to hide" (whole word, any case) | `Ridgeline` → `[NAME]` |

Also: input capped at 2 000 characters; control characters removed.

Known gaps (say so if asked)
- Names are hidden only if the owner lists them. Automatic name detection would need an NLP model; that's on the roadmap.
- Short numbers (invoice 2481, dates) are kept on purpose: they help triage and are not personal on their own.
- Street addresses are not detected.
- Over-redaction is the safe direction: a date written as `12 05 2026` becomes `[NUMBER]`.

Why it matters for the judges: the AI provider only ever sees tagged text, so a pasted scam email can't carry a working phone number or link into anything Mgadi shows. And personal information stays out of the cross-border transfer as far as we can manage.
