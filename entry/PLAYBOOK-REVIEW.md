# Mgadi playbook: provenance and review record

Status: draft, not practitioner-reviewed. Prepared 27 October 2026. Ransomware route and entry screen added the same day (see "Ransomware route" below); they are drafts too.

## What it is and where it came from

A playbook is a versioned set of instructions: who the steps are for, when to show them, what to do, why, outcomes to record and when to involve someone else. The app reads `public/data/playbook.json`; the classifier chooses a route. Fluent AI output does not approve the instructions.

The repository contains a team/AI-prepared draft in `../prep/playbook-for-review.md`, dated 26 October, and a shorter app implementation. This was assembled for Mgadi, not issued or certified by a bank. The old handout and app JSON differ: review exact app wording, all five routes and the background handout. There is no recorded sign-off. Existing research includes secondary reporting and international guidance; it does not establish bank endorsement or a complete South African procedure.

## Primary source map

Checked online 27 October 2026. These support specific actions, not blanket approval. Keep source URLs, check dates and reviewer decisions with each released version.

| Action | Source | Supported point / limitation |
|---|---|---|
| Contact bank after discovering fraud | [FNB incident reporting](https://www.fnb.co.za/security-centre/incident-reporting-process/) | South African reporting route; confirm customer segment and information requested. |
| Request recall of diverted payment | [FBI IC3 BEC guidance](https://www.ic3.gov/CrimeInfo/BEC) | Prompt originating-bank contact/recall; US source. Do not import US reporting requirements or assume identical SA procedures. |
| Verify changed bank details independently | [Absa BEC guidance](https://cib.absa.africa/home/insights-and-events/business-email-compromise/) | Known contacts; do not use contact details in suspicious email. Corporate contact channels can differ from retail/business ones. |
| Contain mailbox access and inspect forwarding | [Microsoft compromised-account response](https://learn.microsoft.com/en-us/defender-office-365/responding-to-a-compromised-email-account) | Access/session revocation, MFA and forwarding review. Many actions require an administrator; tell owners when to involve IT. |
| SASL assistance design | [W3C sign languages](https://www.w3.org/WAI/media/av/sign-languages/) | Sign languages differ by region; automatic avatars are not an adequate substitute without validation. Accessibility guidance, not fraud procedure. |

Preserving original messages/payment records is in the draft; ask the responder to confirm artefacts, format and ordering. SAPS reporting, insurer notification and Information Regulator wording need current South African primary sources and review before new operational claims are added. IC3 does not establish local reporting procedures.

## Ransomware route (added 27 October 2026, `ransomware_suspected`)

**Provenance.** Written by the AI lead developer from public guidance, not from a South African procedure and not by a practitioner. Sources, checked online 27 October 2026 (kept in `public/data/resources.json`, which allows only these hosts and only https):

| Used for | Source | Limitation |
|---|---|---|
| Isolate affected systems, preserve evidence, do not rely on paying | [CISA: I've been hit by ransomware](https://www.cisa.gov/stopransomware/ive-been-hit-ransomware) | United States government. Its reporting contacts do not apply in South Africa and are not copied. |
| Free decryption tools exist only for some kinds; never upload private files; why paying is discouraged | [No More Ransom: decryption tools](https://www.nomoreransom.org/en/decryption-tools.html) and [Q&A](https://www.nomoreransom.org/en/ransomware-qa.html) | Europol, police and security companies; international. |
| How organisations prepare for, respond to and recover from ransomware | [NIST IR 8374 Rev. 1](https://csrc.nist.gov/pubs/ir/8374/r1/final) | Written for IT and risk teams, not first-hour steps. US. |

No South African ransomware source is cited, because I did not verify one. Please suggest South African resources; do not let the draft imply any.

**What the owner sees:** seven steps (look without clicking; disconnect from the network; do not pay or reply yet; get a trusted specialist on a different device; keep what a specialist needs; protect backups; prepare a handoff and report). A note tells people at larger organisations to go to IT or security first. The guide never asks whether a payment was made. The bank button is on every screen, and step 3 points to it only *if* the owner has already sent money.

**Questions for the reviewer, because guidance genuinely varies:**
1. **Power.** Step 2 says to disconnect and *not* switch the machine off unless it cannot be disconnected, so clues are not lost. Some guidance prefers other handling. What should a non-technical owner be told?
2. **Photograph the screen with another phone** and do not click anything: appropriate? Anything to add (time, the machine name)?
3. **"Do not pay yet"** and "official guidance does not recommend paying": acceptable wording for an owner who faces a deadline and a threat to leak data? Anything to add about threats to publish data?
4. **Calling a specialist the owner already knows**, and the warning that criminals pose as helpers: anything to add about verifying a helper?
5. **Insurer:** "check your policy and ask what they need, and when": correct and sufficient?
6. **Backups** (do not connect a backup to the affected computer; do not restore until told): correct and sufficient for a small business?
7. **Reporting.** "Report the crime to SAPS. Ask your specialist about other duties. If personal information may have been exposed, they can advise whether the Information Regulator and the people affected must be told." This is **unreviewed South African legal and reporting wording** (POPIA). It deliberately stops short of saying what the law requires. Confirm or correct it, and say who should be told, how, and by when.
8. **Mixed incidents.** A story that mentions both a payment problem and locked files asks one question and keeps the bank step. Is that the right priority?
9. **Entry screen.** Are the five plain choices and the "what happened with the money?" sub-question understandable and complete for a small-business owner?

## How to request the review

Ask the Track 3 mentor to identify someone experienced in bank-fraud response or incident response. A business mentor/accountant can check clarity and supplier practice; bank, IT and privacy/reporting details may need different specialists.

Suggested request: “Could you spend 15–20 minutes reviewing our first-hour payment-diversion steps? Mark each exact instruction keep/change/remove, check the order and tell us when an owner must involve their bank or IT. We will record the scope of your feedback and won't call it institutional approval.”

1. Show the fictional scenario, all routes and actual screens/JSON, including unclear and unpaid cases.
2. For each instruction request **keep**, **change** (exact replacement), **remove**, or **needs specialist**. Ask for missing actions, dependencies, escalation triggers and bank pack fields.
3. Check what an owner can do safely versus what needs an administrator. Ask whether evidence should be captured before changing/deleting mailbox rules and whether actions should occur in parallel.
4. Implement agreed edits, update sources and test routes. Show the revised version for confirmation; the first conversation does not approve subsequent edits automatically.
5. Record role, date, exact version/commit, routes/languages covered, caveats and permission to display the name. Unreviewed routes/translations stay draft. Do not imply employer endorsement without permission.

## Review sheet

Reviewer/role: __________  Date: __________  Version/commit: __________

Scope/routes/languages: __________  Public attribution permitted: yes / no

| Route / exact instruction | Keep / change / remove / specialist | Replacement / missing action / reason | Source | Team edit and retest | Reviewer confirmation |
|---|---|---|---|---|---|
| Bank first / script / reference | | | | | |
| Supplier confirmation | | | | | |
| Mailbox containment / preserve evidence | | | | | |
| Suspicious unpaid request | | | | | |
| Unsure / ordinary payment problem | | | | | |
| Evidence / pack sharing | | | | | |
| Referral / reporting / language caveats | | | | | |
| Ransomware 1 Look without clicking | | | | | |
| Ransomware 2 Disconnect (and the power question) | | | | | |
| Ransomware 3 Do not pay or reply yet | | | | | |
| Ransomware 4 Specialist on a different device | | | | | |
| Ransomware 5 Keep what a specialist needs | | | | | |
| Ransomware 6 Protect backups | | | | | |
| Ransomware 7 Handoff, SAPS, Information Regulator wording | | | | | |
| Entry screen: five choices and the money sub-question | | | | | |
| Pack handoff wording ("reported by the owner", "no referral was made") | | | | | |

Voice consent wording and the cross-border note are **legal** review items, not playbook review items (see `RELEASE-READINESS.md` §5).

Open content fixes: remove stale “evidence pack feature is next” copy; render draft status; avoid asserting confirmed fraud before investigation; add session-revocation/admin escalation wording after review. This document does not silently approve those edits.
