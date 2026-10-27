# Mgadi voice companion: "Talk to Mgadi"

Branch `feature/live-voice-companion`. A browser voice conversation with a Retell AI agent, with live captions, a floating
avatar, and a link to the same incident journey as the text screens. **A telephone callback is not the primary path.**
Nothing here has been run against a real Retell account: see "Not verified" below.

## What works, and how it was checked

| Capability | State | Evidence |
|---|---|---|
| Browser voice with the **current** Retell SDK (`retell-client-js-sdk` 3.0.3, v3 `RetellClient`, "gateway" WebRTC transport) | Built | Real SDK bundle run in Chromium against a mocked provider: 20/20 (`scripts/retell-sdk-smoke.mjs`) |
| Server-side authorization: private key never in the browser | Built | Server tests, mutation-checked; browser test finds the key nowhere |
| Consent before any provider audio processing | Built | Server refuses without the consent header; UI blocks Start until agreed |
| Live transcript, You vs Mgadi assistant, history stays visible while speaking | Built | Browser checks (simulation and real SDK) |
| Connecting, listening, speaking, muted, reconnecting, failed states | Built | Controller unit tests (fake clock) and browser scenarios |
| Mute/unmute, end call, "Use text guidance" without losing progress | Built | Browser checks |
| Current action always visible; bank button always reachable | Built | Playwright click actionability at 320 to 1280 px |
| Floating 3D avatar (idle/listening/speaking; larger/smaller/hide; reduced motion; keyboard) | Built | Browser checks incl. canvas animation test |
| Reviewed-SASL player | Built, **empty**: no clip exists | Registry validation tests; the interface says none exists |
| Languages: English and Afrikaans voice, isiZulu and isiXhosa text only | Built | See "Languages" |
| Tasks (confirmed/pending), visual timeline, privacy indicators | Built | Browser checks |
| **Real** Retell call with real audio | **Not tested** | Needs your authorization, keys and an agent |
| The **SIMULATION** (`MGADI_VOICE_MODE=mock`) | Mock, labelled "SIMULATED" in the panel | Used for demos and tests only |

## How authorization works (verified from Retell's docs and the SDK source)

1. **Creating the call**: `POST /v3/create-web-call` needs an API key. Ours stays on our server (`server/voice.js`). The
   SDK's `fetch` option is replaced (`public/voice/retell-adapter.js`) so its request goes to our `/api/voice/session`
   with none of the SDK's credentials. Our server ignores any agent, override or prompt text a visitor sends and builds
   the Retell request itself. It forces `data_storage_setting: basic_attributes_only`, a maximum duration and no webhook
   on **every** call.
2. **Joining the call**: Retell returns a per-call `access_token`. The SDK uses it only for WebRTC signalling to
   `https://api.retellai.com/webrtc-proxy/...`.
3. **Live transcript**: Retell streams it over a separate WebSocket, `wss://api.retellai.com/v2/monitor-call/{call_id}`.
   Per Retell's docs a server authenticates with the API key, and a **browser** with a **public key** passed as a
   WebSocket subprotocol. The SDK does this for us when given `transcript: true`. So the transcript socket needs a Retell
   public key in the browser. That is by design (domain-restricted), but it is the one credential the browser holds.
   We never relay the transcript through our server, so Mgadi never sees it.
4. **Unverified**: the SDK's own comments say the transcript stream "needs Call.Write, which a public key scoped to web
   calls alone won't have". The public-key docs describe only allowed domains and reCAPTCHA. Whether *your* public key can
   open the monitor socket must be tested. The SDK does not report a failed transcript stream, so the controller
   detects it (assistant audio heard, no caption after 7 seconds) and shows "Live captions unavailable".

## Privacy

- Mgadi stores no audio and no transcript. Messages live in page memory only (a test asserts nothing reaches browser storage).
- Only event **types** go to the incident timeline ("Voice conversation started"), never words.
- What Retell receives: your voice, plus these reviewed, non-personal variables: language, incident title, current step,
  reviewed guidance, draft status. No incident description, names, numbers or evidence.
- The consent text says Retell processes audio, possibly outside South Africa, and that the assistant is an AI. **That
  wording is a draft and needs privacy/legal review (POPIA) before public use.**
- Provider-side retention: enforced per call by our server (`basic_attributes_only`) and checked on the agent before a
  language is offered. Retell's docs say this stores no transcripts, recordings or logs; webhook events (which we do not
  register) would still carry them. **Confirm in your dashboard** and consider a short `data_storage_retention_days`.

## Security header changes (the only two)

- `Permissions-Policy`: `microphone=()` became `microphone=(self)`. Camera, geolocation and payment stay blocked.
- CSP `connect-src`: added `https://api.retellai.com wss://api.retellai.com`. Scripts, styles, framing and everything else
  are unchanged. No LiveKit hosts: v3 uses the gateway transport. The SDK is served from our own origin
  (`npm run vendor` builds `public/vendor/retell-client.js`), so there is no CDN script.

## Languages

Retell's `language` list (API spec revision 2026-10-26) includes English locales and `af-ZA`. It has **no isiZulu and no
isiXhosa**. So:

| Language | Interface | Voice conversation |
|---|---|---|
| English | yes | Offered when an English agent is configured, verified and passes the privacy check |
| Afrikaans | yes (draft text) | Same, plus every string of the current guide must exist in our Afrikaans catalog. **Today the catalog is incomplete, so Afrikaans voice stays blocked** and says why |
| isiZulu | yes (draft text) | **Never offered.** Text and, if the device has a matching voice, browser read-aloud |
| isiXhosa | yes (draft text) | **Never offered.** Same |

Changing language mid-call ends the call, keeps the whole conversation, and says what is and is not available.
The avatar and anything in the app is **not** a SASL translator. Signing appears only from the reviewed-clip registry
(reviewer, date, rights, captions all required), which is empty. The assistant must not claim otherwise.

## Provider configuration still required (nothing below has been done)

1. Retell **private API key** (restrict permissions if possible), set only as `RETELL_API_KEY` in `.env.local` or the host's
   secret settings.
2. Retell **public key** with **allowed domains** = your deployed host (+ `localhost` for development). Do not enable
   reCAPTCHA unless a token flow is added. Test that it can open live-transcript sockets.
3. An English **agent** (language `en-US` or `en-GB`), agent speaks first, **Data storage = Basic Attributes Only**, **no
   webhook**, max duration ≤ 10 minutes. Optionally an Afrikaans agent (`af-ZA`) after the catalog is complete.
4. Set `MGADI_VOICE_MODE=retell`, `RETELL_AGENT_ID_EN`, `RETELL_PUBLIC_KEY`. Add `MGADI_VOICE_VERIFIED_LANGUAGES=en` only
   after real speakers have tested English voice on real phones.
5. Run `node scripts/voice-preflight.mjs` (read-only call to Retell; run once approved).
6. A Retell **spend limit**, and review `MGADI_VOICE_PER_HOUR`. Worst case is `MGADI_VOICE_PER_HOUR` x
   `MGADI_VOICE_MAX_MINUTES` of audio per hour at your per-minute price. These counters are in memory, so on Vercel they are
   per instance, not global: add a shared store before public launch.
7. Privacy/legal review of the consent text; practitioner review of the playbook; Deaf/SASL reviewers for any clip.

### Agent prompt (Retell dashboard). The variable names must match exactly

```
You are the Mgadi assistant, an AI voice assistant that helps a small-business owner in South Africa in the first hour
after a suspected payment-diversion scam. Say at the start that you are an AI, not a person. Speak {{app_language}} in
short, calm sentences.

You may ONLY explain and read out the reviewed guidance below. Give no other instructions. Give no legal, financial or
recovery advice and never promise that money can be recovered.
Guidance status: {{guidance_status}}
Situation: {{incident_title}}
Current step: {{current_step}}
All steps and their status:
{{reviewed_guidance}}

Rules:
- Never say, spell or invent any phone number, email address, website or account number. If asked for the bank's number
  say: "Please tap the red Bank fraud line button in the app and choose your bank."
- You cannot call anyone and you cannot mark steps done. Only the person can tick a step in the app. When they say they
  have done something, remind them to tap the button themselves.
- Never ask for passwords, PINs, one-time codes, card numbers or full account numbers. If they start to say one,
  interrupt kindly and tell them not to share it.
- If you do not know, say so and point them to the text guidance in the app.
- Do not discuss anything unrelated to this situation.
```

Optional agent guardrails: platform-integrity (jailbreak) input topic.

## Not verified / blocked

- No real Retell call, real microphone, real audio quality, or real transcript authorization has been tested.
- Afrikaans voice is blocked until every guide string has an Afrikaans catalog entry, and any language needs speaker tests.
- The avatar is a visual companion only. No SASL clip exists. Camera/sign recognition is out of scope.
- Consent wording, playbook and translations are unreviewed drafts.
- Serverless rate limits are per instance. No reCAPTCHA. No WCAG claim; no native screen reader or physical phone test.
- On a narrow screen at 150% text or more, the floating avatar steps aside (a fixed avatar cannot be kept clear of content
  that scrolls); the panel scrolls instead.

## Commands

```
npm install && npm run vendor          # builds public/vendor/retell-client.js (required for real voice)
MGADI_VOICE_MODE=mock npm start        # labelled simulation: ?mockvoice=fast,fail-mic,fail-provider,drop,nocaptions
npm test                               # 93 tests, provider mocked
MGADI_PLAYWRIGHT=... node scripts/voice-smoke.mjs        # 78 browser checks (simulation)
MGADI_PLAYWRIGHT=... node scripts/retell-sdk-smoke.mjs   # 20 checks: real SDK, mocked provider
```
