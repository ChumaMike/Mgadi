# Voice, live transcript and 3D companion: final work and handoff

Branch `feature/final-voice-avatar`, from `main` at `feb3826` (which already contains PR #9, #10 and #11).
**Nothing here has been run against a real Retell account.** The first real call is blocked on the owner's setup (section 6).
Everything marked "tested" below was tested against the labelled simulation, or against the **real Retell browser SDK and a real
WebRTC peer connection with a mocked provider**. Neither proves that the real service works.

Read with `VOICE-COMPANION.md` (how the integration and its authorization work), `VOICE-REAL-TEST.md` (the one capped real test) and
`SOURCE-OF-TRUTH.md` (product rules). Nothing in the safety invariants was weakened.

## 1. What a person gets (the acceptance journey)

They open Mgadi on a phone, tap **Talk to Mgadi**, agree, allow the microphone, and say "I paid a supplier, but the supplier says
those weren't their banking details."

| Step | What happens | Evidence |
|---|---|---|
| Microphone is requested **first**, before any server call | A person who taps Block creates no provider call and uses no quota (this was backwards before: the SDK asks after the call exists) | `test/voice-adapters.test.js` (5 new tests), `voice-smoke` |
| Our server creates the call; the private key stays on the server | unchanged, re-verified | existing server tests, `voice-live-smoke` (key found nowhere in the browser) |
| Speech appears as one message labelled **You**, exactly as recognised, however many partial and duplicate events arrive | Replace-by-id, plus a rule that a late snapshot can never shrink a message | `voice-live-smoke`, 6 controller tests |
| The reply appears as **Mgadi assistant (AI)**; both stay in order by the provider's own `time_sec`, even when Retell's snapshot arrives after newer updates | New: the old code showed first-seen order | controller tests (ordering, late snapshot, long conversation) |
| The floating avatar listens, thinks, speaks, shows **Mic muted**, and stops when the call ends | see section 3 | `voice-avatar-smoke`, `voice-live-smoke` |
| **Bank fraud line** stays on screen: full width, 44 px or taller, never covered, at 320, 360, 390, 430, 768, 1024 and 1280 px | The panel was rebuilt so the conversation and the emergency button both fit | `voice-avatar-smoke` (real click actionability, not just geometry) |
| Mute, unmute, end, read earlier messages, switch to text guidance, all without losing incident progress | unchanged behaviour, retested | `voice-smoke`, `voice-live-smoke` |

## 2. The nine states

`idle`, `connecting`, `listening`, `thinking`, `speaking`, `muted`, `reconnecting`, `failed`, `ended` (`VOICE_STATES` in `controller.js`).
One pure function, `deriveVoiceState`, produces the value: while live, **speaking wins** (a muted person still hears the assistant),
then `muted`, then `thinking`, then `listening`. Every other phase maps to itself.

Where each state comes from, honestly:

| State | Source |
|---|---|
| connecting, reconnecting, failed, ended, idle | the controller's own lifecycle |
| listening | live and nothing else is happening |
| speaking | assistant **audio** above a noise gate (real signal), or assistant caption text changing in the last 1.3 s |
| muted | the person pressed Mute (and we told the SDK) |
| **thinking** | **An inference, not a provider signal. Retell reports none.** The person's last turn stopped growing at least 1 s ago, nothing has come back, and it was under 15 s ago. Only with real captions, never while muted. It can be briefly wrong if someone pauses mid-sentence. |

## 3. The 3D companion

### What it is
A friendly head-and-shoulders character, **original geometry written for Mgadi** (smooth-lit ellipsoids drawn by a few hundred lines of
WebGL, no library, no model file, no texture, no licence to track). Files in `public/voice/avatar/`:

| File | Job |
|---|---|
| `pose.js` | The animation model: pure, no DOM. State to pose, blink scheduler (every 2.3–6 s, 130–180 ms, occasional double), breathing, non-repeating head drift, small nods while listening, gaze glances, mouth from audio level. Seeded, so tests are repeatable. |
| `webgl.js` | The renderer and a performance governor. |
| `lite.js` | Fallback: flat 2D drawing, 12 fps, about 25 canvas calls per frame. |
| `index.js` | Picks WebGL, then lite, then "none" (the dock's text status still works). Weak phones (2 or fewer cores, or 2 GB or less) start on lite. |

`public/accessibility/avatar.js` (the arms-and-fingers mannequin used by the **Sign this** dialog) is **untouched**: the new character has
no arms or hands, so it cannot be mistaken for signing.

### What drives the mouth, and what must never
* **Only the assistant's audio.** The Retell SDK's `onAudio` analyser is attached to the **remote** track (`attachRemote`), never the
  local microphone. This is checked three ways: the SDK's own docs say the samples "contain incoming audio"; a test reads the installed
  SDK source and fails if the analyser is ever created from anything but the remote track (so an SDK upgrade cannot silently break the
  rule); and `voice-live-smoke` runs the real SDK with a **loud fake microphone and a silent assistant** and asserts the avatar never
  says speaking, then plays assistant audio and asserts it does. Deliberately wiring the microphone into the avatar makes that test fail
  (mutation-checked).
* **Retell supplies no phoneme or viseme data** (SDK 3.0.3, docs read 28 Oct 2026). The mouth follows loudness: *approximate* lip
  movement. **It is not phoneme-level lip-sync** and must not be described as such. If a call has captions but no audio levels at all,
  the pose model can fall back to a generic speaking flap; that is movement tied to real caption activity, not to amplitude.

### Quality decisions
* **Considered a licensed GLB/glTF model; did not add one.** A rigged human model with a face needs a renderer library (hundreds of KB, a
  WebGL requirement, bigger offline copy), a licence that allows redistribution in a public repository, and provenance we can prove. No
  model could be verified offline, and nothing may be bought without approval. The renderer interface is small and shared
  (`play, pause, setMood, setLevel, setReducedMotion, snapshot, getStats, destroy`), so a licensed model can replace `webgl.js` without
  touching the dock, controller or tests. **Asset and licensing status: no third-party asset in this branch.**
* **Honest verdict:** the character is clearly more readable than the old mannequin (the head fills roughly half the frame instead of about a quarter,
  which is an estimate from the screenshots and not a measurement; smooth shading, eyes, brows, teeth and an interior when the mouth opens) but it is a stylised illustration, not a premium rigged character.
  It has had no user testing, no review by designers, and nobody has judged it on a real phone.

### Floating behaviour
Bottom-left on phones (right beside the panel on desktop). Compact and expanded sizes, hide and restore, 44 px touch targets around the
30 px buttons, a **Mic muted** badge, a state outline that is never the only signal (badge, status text and spoken name all say it too),
and the permanent label "Visual companion, not a sign language translator". It steps aside while the on-screen keyboard is open
(`visualViewport`), at very large text on narrow screens (existing rule), and in low-data mode.

### Reduced motion
`prefers-reduced-motion` or the in-app setting: the face changes with the state but **nothing moves**: zero frames drawn in 1.2 s (counter,
not a screenshot), the render loop stopped, no drift, blink, breathing or lip flap; speaking shows a still half-open mouth.

### Performance (measured, with caveats)
Chromium on a 4-core cloud container, CPU-throttled to imitate a slower phone, 4 s of "speaking", main-thread cost per drawn frame:

| CPU throttle | Old mannequin | New, WebGL | New, lite |
|---|---|---|---|
| none | 11.2 ms, 33 fps | 0.23 ms, 36 fps | 0.14 ms, 29 fps |
| 4x | **58 ms, 10 fps**, 4.0 s of long tasks | 0.9 ms, 27 fps | 0.4 ms, 28 fps |
| 6x | **83 ms, 7 fps**, 4.0 s of long tasks | 1.5 ms, 26 fps | 0.5 ms, 30 fps |

Caveats that matter: WebGL here is **software (SwiftShader)**, so GPU time is not measured and not representative; WebGL showed a few
long tasks (9–11, about 650–730 ms in all over 4 s under throttling) that I attribute to the software rasteriser but have not proven;
**no real Android phone has been tried**. The governor (30 fps, then 20 fps with a smaller mesh, then still frames) is tested with a
fake clock, not on a slow device.

## 4. Contract for the UI/UX agent

The voice work owns these and their tests; **please do not restyle or move them**: `public/voice/**` (including `voice.css`),
`test/voice-*.test.js`, `scripts/voice-*.mjs`, `scripts/retell-sdk-smoke.mjs`, `docs/RETELL-AGENT-PROMPT.txt`.

**One shared edit:** `public/index.html` now links `/voice/voice.css` after `experience.css`. `voice.css` overrides `.voice-panel`, `.vp-*`
and `.avatar-*` only. The old `.vp-stage` rules in `experience.css` are now dead (no element has that class) and can be deleted.

### Reading the state from anywhere

```js
document.addEventListener('mgadi:voice-state', (e) => {
  // e.detail = { uiState, phase, muted, captions, messageCount }   (no transcript text, ever)
});
document.documentElement.dataset.voiceState   // the same uiState, for CSS: html[data-voice-state="speaking"] { ... }
```

`uiState` is one of the nine. `phase` is `idle|connecting|live|reconnecting|failed|ended`. `captions` is `unknown|on|unavailable`.

### Attributes and variables the layout uses

| Name | Meaning |
|---|---|
| `html[data-voice="open"\|"closed"]` | the panel is open (existing) |
| `html[data-avatar="min"\|"max"\|"off"]` | the avatar's size, or not shown (existing name, new sizes) |
| `html[data-keyboard="open"\|"closed"]` | the on-screen keyboard is up (new, from `viewport.js`) |
| `--kb-inset` | height of the keyboard in px; the panel and avatar lift by it (new) |
| `--avatar-w`, `--avatar-h`, `--avatar-gap` | the gutter the call controls reserve beside the avatar (existing names, new values) |
| `--voice-h`, `--header-h` | set by `panel.js`; the app uses them for `scroll-padding` (existing) |
| `.avatar-dock[data-state, data-size, data-renderer]` | state, size and which renderer drew it |

### Things I noticed in files I do not own
* `public/app.js`: `initVoice(...).catch(() => ({ launchButton: () => document.createDocumentFragment() }))` swallows every start-up
  error silently. It hid a bug of mine for several minutes. Suggest `.catch((error) => { console.error('voice init failed', error); return ... })`.
* **Baseline test failures on `main`, not caused by this branch:** (1) `test/ci-runner.test.js` "covers every browser suite": the runner lists
  `experience-smoke` but `scripts/experience-smoke.mjs` does not exist; (2) `test/handoff.test.js` "nothing is typed: no handoff is offered by default";
  (3) on `main`, `browser-smoke` 35/37 and `emergency-smoke` 50/59 (selector drift after the UI refresh, e.g. step labels are now upper-cased by CSS).
* The shared stylesheet rule `.vp-controls .vp-start ~ .button { flex-basis: auto }` made the call buttons wrap at 320 px; `voice.css` overrides it.

## 5. What is genuinely working, simulated, and untested

| | Status |
|---|---|
| Consent, microphone-first, server-created call, private key never in the browser | **Working** (real SDK, mocked provider) |
| Real WebRTC connection, mic audio reaching the far end, assistant audio reaching the browser | **Working** against a test peer in the same page; **never against Retell** |
| Mute really silences what the far end receives; unmute restores it; end releases every microphone track | **Working**, measured at the far end of a real peer connection |
| Live captions, You / Mgadi assistant, no duplicates, correct order, long conversations | **Working** with the real SDK and a mocked transcript socket; **the real Retell socket and public-key permission are unverified** |
| Reconnect, network loss, offline, failure messages, text-guidance fallback | **Working** (simulation and unit tests with a fake clock) |
| Nine states, avatar states, audio-level lips, reduced motion, fallbacks, governor, keyboard, layouts at 7 sizes | **Working** in Chromium (desktop, emulated phone sizes) |
| Spoken prompt injection | The person's words are inert text: no markup runs, nothing becomes a link or a tap-to-call, no step is marked done, the call carries on (`voice-live-smoke`, 5 checks) |
| The assistant's own behaviour under attack | **Untested.** It lives in the Retell agent and its prompt. The prompt now states the rules and is tested for them, but no real agent has been attacked |
| Real Retell call, real audio quality, real accents, real latency, real cost | **Not done. Blocked.** |
| Any real phone, TalkBack, VoiceOver, Safari/iOS, Firefox | **Not tested** (Chromium only) |
| Afrikaans voice | **Not offered** (see section 7) |
| Screen readers / WCAG | Not tested with assistive technology; **no WCAG claim** |

## 5b. Test results (28 October 2026, Node 22.22, Playwright 1.56 Chromium, desktop with emulated phone sizes, synthetic data, no network beyond localhost)

| Suite | `main` at feb3826 | this branch |
|---|---|---|
| Unit tests (`npm test`) | 260 tests, 258 pass, 2 fail | **300 tests, 298 pass, the same 2 fail** (40 new tests) |
| `voice-smoke` (panel, simulation) | 81 / 88 | **88 / 88** |
| `voice-avatar-smoke` (new: avatar, states, fallbacks, governor, keyboard, 7 layouts) | n/a | **87 / 87** |
| `voice-live-smoke` (new: real SDK, real WebRTC peer, mocked provider) | n/a | **35 / 35** |
| `retell-sdk-smoke` (real SDK, mocked provider) | 37 / 37 | **37 / 37** |
| `browser-smoke` | 35 / 37 | 35 / 37 (the same 2 checks fail) |
| `emergency-smoke` | 50 / 59 | 50 / 59 (the same 9 checks fail) |
| `a11y-smoke` (axe-core 4) | 75 / 76 | 75 / 76 (the same 1 check fails: isiZulu / ransomware step) |
| `pwa-smoke`, `tools-smoke`, `evidence-smoke`, `update-smoke` | not run on `main` | 34 / 34, 63 / 63, 47 / 47, 19 / 19 |

The failing checks on this branch are **exactly the failing checks on `main`**, compared by name. None was caused by, or fixed by, this work.

**Do these tests catch real mistakes?** Deliberate bugs were inserted one at a time. Unit level: 16 mutations, 15 caught; the one left is an
*equivalent* mutant (a redundant "captions exist" guard on "thinking": user text can only arrive through captions, so it cannot be observed).
Three misses at first exposed real test weaknesses (a gate comparison that was trivially true, and an assertion on the visible state that
could not see an internal one); both were fixed and re-run. Browser level, all 5 caught: wiring the **user's microphone** into the avatar
(the lip-sync rule), Mute doing nothing, End not releasing the call and microphone, the dock ignoring reduced motion, and removing the
avatar's gutter beside the controls. Two assertions that looked right but could not fail were found and rewritten (a canvas hash read from
a WebGL canvas, and an exact-equality check that was fooled by a first-screenshot artifact).

**What these numbers do not show:** nothing ran on a phone, in Safari, Firefox, TalkBack or VoiceOver; WebGL ran on a software
rasteriser; nothing contacted Retell.

Screenshots (idle, connecting, listening, speaking, thinking, muted, reconnecting, expanded, error at 320 and 390 px; plus 360, 430, tablet and
desktop) were produced by `voice-avatar-smoke` with `MGADI_SHOTS_DIR`. They are not committed (the GitHub connection used to publish this branch can only write text); re-create them with the command in section 9.

## 6. What the project owner must do (nothing here may be pasted into chat or committed)

All values go only in `entry/.env.local` (git-ignored) or the host's secret settings. Full ordered steps are in `VOICE-REAL-TEST.md`.

| Needed | Variable / place | Notes |
|---|---|---|
| Private Retell API key, ideally limited to creating web calls and reading agents | `RETELL_API_KEY` | server only |
| Public key, **allowed domains only** (`localhost` first), reCAPTCHA off for now | `RETELL_PUBLIC_KEY` | a browser holds this; use a Retell workspace used only for Mgadi (it can follow any call in its workspace) |
| English agent, language `en-US` or `en-GB` (no `en-ZA` exists), paste the prompt from `docs/RETELL-AGENT-PROMPT.txt` unchanged | `RETELL_AGENT_ID_EN` | the prompt gained three safety rules in this branch; please review them |
| A **published agent version number** | `RETELL_AGENT_VERSION` | so the version checked is the version tested |
| Agent privacy: Data storage **Basic Attributes Only**, a short retention period, **no webhook on the agent and none at account level**, jailbreak guardrail on | Retell dashboard | the preflight checks the first three through the API; the account webhook can only be checked by eye |
| A prepaid balance, auto-recharge off, any spend limit the dashboard offers | Retell dashboard | each test call is capped at `MGADI_OPERATOR_MAX_MINUTES` (default 3) |
| An operator token, 24 or more random characters, generated locally | `MGADI_OPERATOR_TOKEN` | honoured only over https or from the same computer |
| `HOST=127.0.0.1` for the local test | env | |
| **Explicit approval** to run the read-only preflight (`node scripts/voice-preflight.mjs`, one GET per agent, no call) and then **one** capped call with synthetic information | | I will not run either without that approval |

Do not set `MGADI_VOICE_VERIFIED_LANGUAGES`. English becomes public only after the real test passes, South African speakers have tried it,
and the consent text has had a privacy/legal review. On Vercel, public voice also needs the shared quota store.

Rows 17 to 19 were added to `VOICE-REAL-TEST.md` for this branch: the thinking state, mouth movement against what you actually hear, and
the microphone-first behaviour.

## 7. Languages

Checked against Retell's "Supported languages by provider" page (28 Oct 2026): **Afrikaans (`af-ZA`) is supported by the platform** (voices from
several providers; speech recognition through Azure and Soniox). **isiZulu and isiXhosa are not listed at all.** The dashboard picker is
Retell's own source of truth.
Mgadi still offers **English voice only, once configured and verified**. Afrikaans stays blocked until an Afrikaans agent exists, the guide is
fully translated (it is not: see `TRANSLATION-COVERAGE.md`) and Afrikaans speakers have tested it. isiZulu and isiXhosa stay text only, with
device read-aloud where the device has a matching voice. The avatar is not a South African Sign Language translator and makes no signs.

## 8. Security and privacy checks

* The private key is not in any browser request, header, page content or `/api/voice/config` (`retell-sdk-smoke`, `voice-live-smoke`).
* The browser cannot choose an agent, prompt, override or any call parameter (existing server tests, unchanged).
* Quotas, consent header, operator gate, origin checks, language gating: unchanged and passing.
* No inline `style` attributes and no new origins: the CSP (`script-src 'self'`, `style-src 'self'`) reported no violation in any suite. Two headers were
  already changed on an earlier branch (`microphone=(self)`, `connect-src api.retellai.com`); **nothing new was added to either.**
* No transcript text in storage, timeline, the `mgadi:voice-state` event, or any request (checked).
* The prompt file contains no number, address, key or link, and its `{{variables}}` are exactly those the server sends (tested).
* A pattern scan of every changed line found only the synthetic `...TESTONLY...` placeholders the existing tests already use. **GitHub's own secret scanner could not run** (the repository does not have GitHub Advanced Security), so no second scanner has looked.

## 9. How to run it

```
cd entry && npm ci && npm run build
MGADI_VOICE_MODE=mock npm start                    # labelled simulation; add ?mockvoice=fast | slowconnect | drop | nocaptions | fail-mic | fail-provider | avatar=lite
npm test                                            # unit tests
export MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs
node scripts/voice-smoke.mjs                        # panel behaviour (simulation)
node scripts/voice-avatar-smoke.mjs                 # avatar, states, fallbacks, layouts at 7 sizes (MGADI_SHOTS_DIR=dir saves screenshots)
node scripts/voice-live-smoke.mjs                   # real SDK + real WebRTC peer, mocked provider: who moves the avatar, mute, cleanup, injection
node scripts/retell-sdk-smoke.mjs                   # real SDK against a mocked provider (existing)
```

## 10. Not done, on purpose

No real call; no purchase; no deployment; no webhook; no telephone callback; no change to `main`; no speech-driven routing (using what the
person *says* to change the guidance would be a product decision that needs the team: invariant 5); no third-party avatar asset.

## 11. For the coordinator: lines to add to `SOURCE-OF-TRUTH.md`

`SOURCE-OF-TRUTH.md` is a shared 59 KB file and was deliberately not edited in this branch (so it cannot be damaged by a hand-copied rewrite).
Please paste this row at the top of the §10 change-log table:

| 2026-10-28 | Claude (lead voice and avatar engineer) | `public/voice/` (controller, panel, dock, adapter, new `avatar/`, `viewport.js`, `voice.css`), `public/index.html` (one stylesheet link), `docs/RETELL-AGENT-PROMPT.txt`, `scripts/voice-*.mjs`, tests, `VOICE-AVATAR.md` | Branch `feature/final-voice-avatar` from `main` feb3826. **Added:** nine voice states (thinking is inferred, not a provider signal), microphone requested before the server creates a call, provider-time transcript order that survives a late snapshot, "No sound?" hint that does not need captions, a new original WebGL head-and-shoulders companion (lite 2D and no-canvas fallbacks, performance governor, reduced motion = zero frames, mouth follows the ASSISTANT's audio level only), floating avatar restored and the panel rebuilt so the conversation and the Bank fraud line both fit at 320 px and up, keyboard-aware layout, `mgadi:voice-state` event, prompt file with three added safety rules. Sign dialog avatar untouched. | See `VOICE-AVATAR.md` section 5b for exact counts. **Real Retell call: NOT done (owner setup and approval needed). No real phone, screen reader or WCAG claim. Not merged, not deployed.** |

and replace the inventory row "Floating 3D avatar during voice" in §3 with:

| Floating 3D avatar during voice | Rebuilt on `feature/final-voice-avatar` (see `VOICE-AVATAR.md`) | Original WebGL head-and-shoulders companion with lite 2D fallback; nine states incl. an inferred "thinking"; mouth follows the assistant's audio level (approximate, not phoneme lip-sync); mic-muted badge; larger/smaller/hide; reduced motion draws nothing; steps aside for the keyboard and at 150%+ text on narrow screens. A visual companion, not a SASL translator. The Sign dialog still uses the old mannequin |
