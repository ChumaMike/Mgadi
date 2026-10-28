# Mgadi: real voice, the 3D companion, SASL, and the design research

28 October 2026. Sources are linked where they are used. Facts about Retell were read from Retell's own documentation on 28 October 2026 and can change; the dashboard's language picker is Retell's live source of truth. Nothing in this document was proven by a real call: **no real Retell call has ever been made from Mgadi.**

## 1. Real voice has two separate parts

### A. A real conversation in the browser (built; never run)

A browser call does **not** need a phone number. Retell says so: "The Retell Web SDK creates the call and connects its audio; no phone number is involved." ([Retell: browser web calls](https://docs.retellai.com/deploy/web-call)). Owning a Retell number therefore does not make browser voice ready, and it is not needed for it.

**What Mgadi has:** the browser asks `/api/voice/session`; the server checks consent, quotas and an origin, then creates the call itself with the private key (the browser never holds that key), forcing `data_storage_setting: basic_attributes_only`, a time cap and no webhook. The adapter uses the current SDK (`retell-client-js-sdk` 3.0.3, `RetellClient.createWebCall`), which matches Retell's current documentation.

**What it needs, exactly** (names and defaults come from `entry/.env.example` and `server/voice.js`, which are the authority):

| Setting | Value | Where it comes from |
|---|---|---|
| `MGADI_VOICE_MODE` | `retell` (it is `mock` on the public site today) | you choose |
| `RETELL_API_KEY` | private key | Retell dashboard, API keys. **Server only. Never paste it in chat or commit it** |
| `RETELL_AGENT_ID_EN` | the English agent's id | Retell dashboard, Agents |
| `RETELL_AGENT_VERSION` | the published version number you tested | Retell dashboard (publish the agent first; pin the number) |
| `RETELL_PUBLIC_KEY` | `public_key_...` with **allowed domains** set to your site only | Retell dashboard, public keys. Needed only for live captions. Leave `MGADI_TRANSCRIPTS=off` to keep any key out of the browser and have no live captions |
| `MGADI_OPERATOR_TOKEN` | 24 or more random characters | you generate it (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `MGADI_VOICE_VERIFIED_LANGUAGES` | leave **empty** | add `en` only after the real audio test below passes. It is what makes voice public |
| `RETELL_AGENT_ID_AF` | optional Afrikaans agent | see section 1C. Stays blocked until the Afrikaans guide is complete |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`, `KV_REST_API_TOKEN`) | a shared store | Required for **public** voice on Vercel (the code refuses public calls without it). Not needed for an operator test. Creating one may cost money |
| `MGADI_OPERATOR_ALLOW_PRODUCTION` | `yes` only if you knowingly test on Production | Operator tests are allowed on Preview and refused on Production by default |

**Where to put them:** the Vercel dashboard, project `mgadi`, Settings, Environment Variables (choose Preview or Production), or `vercel env add NAME production` from a terminal you are logged in to. Never in Git, never in chat. After changing a variable, redeploy: a variable does not reach a running deployment.

**Retell dashboard setup (you):** a workspace used only for Mgadi; an English agent using the prompt in `VOICE-COMPANION.md`; **no webhook**; data storage set to the most limited option; a **spend limit** on the account; a public key restricted to the exact domain you will test on (`mgadi.vercel.app` for Production; Preview URLs change, so a Preview needs its own domain added each time); then publish the agent and note its version.

**Safest first test:** put the Retell variables on **Production** temporarily with `MGADI_OPERATOR_ALLOW_PRODUCTION=yes` and an empty `MGADI_VOICE_VERIFIED_LANGUAGES`. The public still gets no voice (languages are unverified and there is no store), and only someone holding the operator token can place a call, capped at 3 minutes and 5 a day by default. The public simulation is switched off while you do this. (A Preview works too, but Preview URLs sit behind a Vercel login and change on each deploy.)

**Network destinations the call needs:** your own server (`/api/voice/session`); `https://api.retellai.com` and `wss://api.retellai.com` (the page's CSP allows exactly these); the browser's microphone (HTTPS and the `microphone=(self)` policy are already set); and WebRTC media, which the CSP does not govern.

**The one unproven assumption most likely to fail first.** The vendored SDK bundle still contains a LiveKit address (`wss://retell-ai-4ihahnq7.livekit.cloud`). The earlier developer stubbed LiveKit out on purpose, reasoning that v3 web calls use Retell's "gateway" transport (plain WebRTC through `api.retellai.com`); a test asserts that path. Retell's v3 response can in principle say `transport: "livekit"` or `"gateway"`, and community reports show `"gateway"` in practice ([a developer's v3 migration notes](https://github.com/sarvadigital2023-cmyk/saypharma-voice-pharmacy/pull/1)). If your agent ever returned LiveKit, the stub fails loudly with "The LiveKit transport is not included in the Mgadi build", and the fix is to unstub it and allow LiveKit's hosts (`*.livekit.cloud` over TCP 443, per [LiveKit's firewall page](https://docs.livekit.io/home/cloud/firewall/)) in the CSP in **both** `server/app.js` and `vercel.json`. I did not change this: the evidence says it is not needed, and widening a security policy on a guess is the wrong move. The first real call settles it.

**Known third-party reports to check on that first call.** Two Retell community threads report that on the v3 gateway transport with SDK 3.0.1 the browser receives no live-transcript `update` event and no `agent_start_talking` / `agent_stop_talking` events, although audio flows ([thread 1](https://community.retellai.com/t/live-transcript-update-event-never-fires-under-v3-gateway-transport/3648), [thread 2](https://community.retellai.com/t/v3-gateway-transport-delivers-no-update-agent-start-talking-agent-stop-talking-events-to-the-browser-blocks-create-web-call-v2-migration/3654)). Mgadi does **not** depend on those events: captions come from a separate monitor WebSocket using the public key, and the avatar's speaking state comes from audio loudness. We ship SDK 3.0.3, not 3.0.1. Whether captions and avatar states work on a real call is unproven until it is run.

**The first real call (one, capped, synthetic speech only):** you say a made-up scenario; check (1) the browser asks for the microphone, (2) you hear a reply, (3) the caption bubbles match what was said by both sides, (4) the avatar switches between listening and speaking, (5) Mute works and the browser's recording indicator goes off, (6) End call stops audio and the indicator, (7) denying the microphone gives the recovery message, (8) the Retell dashboard shows no stored recording or transcript and the cost is what you expect. Write the result in `VOICE-TEST-RESULTS.md`. Only then add `en` to `MGADI_VOICE_VERIFIED_LANGUAGES`.

### B. A real phone callback (not built; blocked by calling routes)

No code places phone calls. Separately, South African numbers are not reachable the easy way. Retell's own list of countries that Retell-managed numbers can call is the US, India, Australia, Germany, Spain, the UK, Mexico, France, Japan, Canada, Italy, Indonesia, the Philippines, Malaysia and Thailand ([Retell: international calling](https://docs.retellai.com/deploy/international-call)); South Africa is not on it. For imported numbers, "international calling depends on your telephony provider's settings" ([Retell: outbound calls](https://docs.retellai.com/deploy/outbound-call)). So a callback to a +27 number needs your own telephony provider and a SIP trunk that can terminate to South Africa, a caller number you are allowed to use, Retell's identity checks before outbound calling, an explicit "I own this number and want to be called" consent, a quota store, and a spend limit. Check with your provider that you can lawfully place automated calls to South African numbers. **Do not offer or imply a callback until that exists and has been tested.**

### C. Languages

Retell's language page lists **Afrikaans (`af-ZA`)** as supported for both voice and speech recognition (voices from MiniMax, Fish Audio, ElevenLabs and OpenAI; recognition from Azure and Soniox), and lists **no isiZulu and no isiXhosa** at all ([Retell: supported languages](https://docs.retellai.com/build/language-support)). It has no South African English code; use `en-GB` or `en-US` and test the accent. So:

- English voice: can be tested as soon as the setup above exists.
- Afrikaans voice: possible in principle; needs its own agent and a real audio test by an Afrikaans speaker. It also stays blocked in Mgadi until the Afrikaans guide is complete (a deliberate rule in the code).
- isiZulu and isiXhosa voice: **not available** from Retell. Text guidance and, where a device has a matching voice, read-aloud are the honest options. Mgadi's server already refuses these two languages with Retell's reason, and the live site shows that message.
- No language is marked verified until a person has heard it work.

## 2. The 3D companion

**What it is.** An original procedural character drawn on a canvas (`public/accessibility/avatar.js`) with a small dock that reacts to the call (`public/voice/avatar-dock.js`). There is no downloaded model and no external renderer.

**What drives it.** The voice controller decides the state from real events and the panel passes it to the dock. The avatar is shown while a call is connecting, live or reconnecting, and hidden when it has ended or failed; the status text and any error message carry those two. Its accessible name has five states: *connecting*, *listening* (live, nobody speaking), *speaking* (the assistant's audio level is above a threshold, or caption text is arriving), *muted, so Mgadi cannot hear you*, and *resting*. The drawn pose has only three looks: resting, listening (leans in) and speaking. Ending a call stops the animation, hides the dock and resets it. With reduced motion the pose changes but nothing animates. Text-only and very large text hide it. If the canvas cannot be created, text and voice still work.

**What was verified (labelled simulation, desktop Chromium, the real UI):** speaking and listening states appear and are named for screen readers; the avatar hides when the call ends; reduced motion stills it; text-only hides it; size and hide buttons work by keyboard. This release also fixed the phone layout so the size and hide buttons sit beside the picture, not over the face.

**What is not verified:** a real agent reply driving the speaking state through Retell's audio samples; real phones.

**What it is not.** The *state* comes from real call events, but while the state is "speaking" the mouth opens and closes at a fixed rhythm. It does not follow how loud the audio is or what words are said. It is not lip-sync, not phoneme or viseme animation, and the interface and docs never call it that. It is a visual companion and says "not SASL translation" on screen.

## 3. South African Sign Language: the practical path

A talking avatar is not a signing interpreter, and nothing in Mgadi presents it as one.

**What the research says.**
- The World Federation of the Deaf and the World Association of Sign Language Interpreters caution against signing avatars as a replacement for human signers, with particular concern where information is live, complex or of significant importance to Deaf citizens, and name public emergency announcements as an example. They also say a word-to-sign translation is not possible, because any translation has to consider context and culture ([WFD and WASLI statement](https://wfdeaf.org/wfd-wasli-issue-statement-signing-avatars/)). Mgadi's guidance is first-hour emergency guidance, so this applies directly.
- Research on SASL avatars exists (University of the Western Cape's SignWriting-driven avatar; Stellenbosch's SASL machine-translation project) but is research, not a ready, validated product ([UWC paper](https://www.researchgate.net/publication/359618580_Rendering_South_African_Sign_Language_Sentences_From_SignWriting_Notation), [Stellenbosch project](https://www.researchgate.net/publication/228731308_The_South_African_sign_language_machine_translation_project_Issues_on_non-manual_sign_generation)). A published SASL gesture database holds only 31 static gestures ([UCT study](https://www.academia.edu/19399076/South_African_Sign_Language_Dataset_Development_and_Translation_A_Glove_based_Approach)). I found no large, validated, production-licensed SASL motion corpus. Large general sign datasets (for example [SignAvatars](https://signavatars.github.io/)) are research resources; their licences and their lack of SASL coverage would need checking, and I have not verified either.

**The practical path.**
1. **Reviewed, limited phrase set first, as human video.** Pick the 15 to 25 sentences that matter most (for example the step titles for the payment route). Have one or two Deaf SASL signers record them. Have Deaf reviewers check each clip for meaning, and add captions and a transcript. Record who recorded, who reviewed, when, and the licence under which Mgadi may use the clips.
2. **Register them.** Add each clip to `public/accessibility/signs.js` under its guidance id (the format is in the code comments) with `reviewed: true`, the reviewer and date, and serve the files from the same site with correct media types and range support. The existing player, "Sign this" button, captions and fail-closed rule already work; a clip that is missing or unreviewed shows "SASL translation unavailable" and the text.
3. **Only then consider an avatar**, and only one whose animation comes from motion capture of Deaf signers, reviewed by Deaf people, with a licence that allows this use. Broader translation (free text to SASL, or signing alongside a live call) needs a validated SASL lexicon, grammar and non-manual features, which the research above says is still unsolved; I would not promise it.

**What I need from you:** the phrase list; who signs and who reviews (names or organisation); written consent and the licence for the clips; the video files (MP4 or WebM); the captions. I can build and test everything around them once they exist.

**Camera-based sign recognition** is a separate research problem and is not built. The interface does not offer it.

## 4. Design research and what it changed

| Finding | Source | What I changed |
|---|---|---|
| A focused element must not be hidden by sticky headers, banners or panels (WCAG 2.2 Focus Not Obscured). | [W3C: What's New in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) | The keyboard skip link was hidden behind the sticky header and is now above it; scroll padding now includes the update banner; a test tabs through a screen and checks nothing focused is covered. |
| Touch targets of at least 24 by 24 CSS pixels (WCAG 2.2 Target Size, minimum); Mgadi's own rule is 44. | [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) | The step progress is 44px numbered buttons; the avatar buttons are 44px. |
| Do not make people re-enter what they already entered; keep help in the same place. | [W3C: What's New in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) | The update flow never reloads a page with entries; the bank button stays in the same header position on every screen. |
| One thing per page makes understanding and interaction simpler, especially for people who have problems reading, understanding or interacting with digital services; pre-populate answers when someone goes back. | [GOV.UK Design System discussion quoting the official guidance](https://github.com/alphagov/govuk-design-system/discussions/6105), [GOV.UK check answers](https://design-system.service.gov.uk/patterns/check-answers/) | The main action is on the first phone screen; the step progress no longer competes with it; going back to a step keeps the owner's answers. |
| Clear, common words, short blocks, and make the important tasks visually and programmatically prominent. | [W3C: clear and understandable content](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/), [W3C: cognitive design guide](https://www.w3.org/TR/coga-usable/design_guide.html) | "Ready offline" no longer takes the top of every screen; the primary action does. |
| Use familiar patterns and consistent labelling; state is not carried by colour alone. | [W3C: Making Content Usable for People with Cognitive and Learning Disabilities](https://www.w3.org/TR/coga-usable/) | Step states are a tick, an exclamation mark, a dash or a number, with words in the accessible name. |
| Sign-language avatars must not stand in for human signers where information is live or important. | [WFD and WASLI](https://wfdeaf.org/wfd-wasli-issue-statement-signing-avatars/) | No signing is shown without reviewed clips; the interface says the avatar is not a translator. |

I have not found a primary source for conversational-voice interface patterns that I would cite as authoritative, so the voice layout decisions (captions get the room on a phone; the labelled state, privacy chips and the bank button stay visible; Mute and End call are always reachable) rest on the existing design and on testing, not on a cited standard. WCAG 2.2 requires captions for live audio at Level AA; that is an additional reason the captions matter, and why real caption behaviour is on the first-call checklist.
