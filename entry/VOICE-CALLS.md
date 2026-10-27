# Voice-call feature decision

**Updated 27 October 2026:** Chuma chose a **real phone callback to the person reporting**. This is approved implementation scope; it is not active yet. His suggested “resell” is interpreted as **Retell AI**, unless corrected. The following earlier options remain background; the owner-callback option is now selected.

## What works in the MVP now

Mgadi provides a **tap-to-call official bank fraud line** from every screen. It uses a normal `tel:` link, so the business owner chooses to place the call with their own phone and SIM. No phone number or incident information is sent to a voice provider.

## What “AI calling” would require

Antigravity can help write integration code, but it is not the telephone service. A live AI call requires a separate telephony/voice-AI provider, a verified caller number, account credit, a server-side API key, a webhook endpoint, consent copy and a clear call script.

## Safe scope choices

1. **Owner-initiated bank call (built):** the owner taps a bank number; Mgadi prepares the words to say. No automated outbound call.
2. **Opt-in callback (selected next feature):** the owner enters an authorised number and explicitly asks Mgadi to call them. The call guides a reviewed emergency script/interview. Minimise number retention and define deletion for both Mgadi and the provider before activation.
3. **AI calls a supplier or bank:** do not build this for the hackathon. It needs strong identity checks, legal/compliance review, recording consent and human escalation. It can create risk during a live fraud incident.

## Minimum safeguards before a real callback

- Explicit checkbox: “I own or am authorised to use this number and want Mgadi to call me now.”
- No calling based on extracted numbers from an email, message or uploaded evidence.
- Rate limit, maximum call duration and no recording by default.
- No account, OTP, PIN, password, card number or sensitive payment details requested in the script.
- Provider key only on the server; never in the browser or Git history.
- Show that voice is an optional guide, not legal, bank or emergency-service advice.

## Selected journey and readiness

Text/initial report first, then language and assistance choice: continue by text, call me, or working sign-language content/service. Keep bank action immediate. No registration required. Mode changes preserve one incident/task state. Reporting alone does not trigger a call.

The callback reads reviewed playbook steps, asks constrained questions, offers repeat/slow/stop and identifies itself as Mgadi's AI guide. Capture structured actions with time and source. A call-link tap is not proof the bank answered; an AI summary is not proof a task happened. Ask the user to confirm/correct important outcomes. Action tracking is separate from retaining recordings/transcripts.

### Retell feasibility

- [Create phone call](https://docs.retellai.com/api-references/create-phone-call): server calls the authorised destination using a configured caller number/agent.
- [International destinations](https://docs.retellai.com/deploy/international-call): the checked managed-number table does **not include South Africa**. Verify a suitable imported/custom telephony route, destination permissions, caller identity and actual charges before promising +27 calls.
- [Languages](https://docs.retellai.com/agent/language): recognition and voice must both support the language. Dashboard combinations and native-speaker tests decide what Mgadi offers.

Provider account, caller number, credentials, credits, operational owner and explicit small cost cap are not configured by this documentation session. No real call or purchase was made.

### Data and integration

Vercel can host initiation/webhook endpoints; the telephone/voice provider handles the conversation. Minimal access-controlled incident/call state, expiring browser token, signed webhook verification, deduplication and browser polling/reconnect are needed. Per-process limits are insufficient across serverless instances. Specify short retention/deletion; evidence file bytes remain local.

Voice changes the privacy boundary: a provider processes the destination number/audio and may process transcripts. Explain that before opt-in; do not apply the text-only redaction promise to voice. Configure provider storage/recording controls, discard unexpected sensitive webhook fields and never log full payloads. Check [API storage fields](https://docs.retellai.com/api-references/create-phone-call) and [Retell privacy policy](https://www.retellai.com/legal/privacy-policy) against actual settings before activation.

Human support uses reviewed service contacts or separately labelled manually entered trusted contacts. User previews/approves shared fields. Preparation, sent request and accepted task are separate. Actual connection requires a willing receiving service and real availability; Mgadi cannot supply an on-call responder/interpreter by itself. No automatic external-party calls.

See `REVIEW-AND-TEST-CHECKLIST.md` section 4 for acceptance checks. Use synthetic incidents and authorised demo participants first; preserve text/bank actions during provider failure.
