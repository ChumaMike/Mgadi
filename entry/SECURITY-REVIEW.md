# Mgadi security review (self-review, 27 October 2026)

**This is a developer's self-review of this branch. It is not a penetration test, not an independent audit, and not a certification.** Nobody outside the build has examined this code. Treat everything below as "what the author checked and could show", and book an independent review before any claim of "secure" is made.

Scope: branch `feature/emergency-offline-readiness` (stacked on `feature/live-voice-companion` and `feature/critical-fixes`). Method: reading the code, writing targeted tests, probing the running server over real HTTP, mutation-testing the new tests (break the defence, confirm the test fails), and running the dependency audit.

## 1. What was and was not examined

| Examined | Not examined |
|---|---|
| Node server, routing, headers, body handling, rate limiting | Retell's, Vercel's and Upstash's platforms and their own security |
| Voice authorization, operator gate, quota layer (against a fake provider) | **Any real Retell call.** Real audio, the real agent prompt in the dashboard, real captions authorization |
| Service worker, cache integrity, update and rollback (real Chromium, server shut down) | Real phones, real browsers other than the bundled Chromium, Safari/iOS service-worker behaviour |
| Browser DOM handling of untrusted text (typed, transcript, pack fields) | TLS and DNS configuration (the platform's), HSTS on a real deployment |
| Dependencies: lockfile, install scripts, `npm audit`, what ships to the browser | Social engineering, physical access, insider access to the Retell or Vercel account |
| Regular-expression speed on adversarial input | Fuzzing beyond that, load testing, denial-of-service at scale |

## 2. Assets and who might attack them

Assets, most important first: (1) the owner's safety: they must reach the bank step fast and never be misled; (2) the owner's privacy: the story, voice, evidence; (3) the provider budget (voice calls cost money); (4) the operator token; (5) integrity of the guidance and of the offline copy.

Realistic adversaries for this product: a scammer who is on the phone with the owner or whose text the owner pastes; a bot or script that finds the voice endpoint and tries to spend the budget; another website trying to use a visitor's browser; someone on the same wifi as a demo laptop; a provider stream that misbehaves; and the stressed owner themselves, who will type things they should not.

## 3. Findings fixed during this sprint

Severity is the author's own judgement (Low / Medium), not a CVSS score. Each fix has a test, and each test was checked by breaking the defence and watching it fail.

| # | Finding | Severity | Fix | Pinned by |
|---|---|---|---|---|
| S1 | The operator test token travels in an HTTP header. On a demo laptop served over plain http on the wifi (`server.js` binds `0.0.0.0` by default so phones can reach it) it could be read by anyone on that network, and it gates paid calls. | Medium | The server honours the token only on https (proxy says so) or from the same machine; otherwise it is ignored, answered as the public view, and **not** counted toward the lockout. The page switches the token field off when it is not a secure context. | `test/security-hardening.test.js` (transport rules, over real HTTP, lockout not advanced), `scripts/retell-sdk-smoke.mjs` (no token header ever sent from an insecure page) |
| S2 | The voice transcript is untrusted text (the person, a scammer on a speaker, the assistant, all through a provider) and was accepted without limits: unbounded length, count and id size, control and direction-override characters, and a malformed update could throw. | Low | Updates must be arrays of objects with a known role, string content and a usable id; text is cut to 4,000 characters, 100 items per update; control and bidirectional-override characters are removed; the bookkeeping collections are bounded. Malformed data no longer claims captions are working. | `test/voice-controller.test.js` (3 new tests), `scripts/retell-sdk-smoke.mjs` (hostile frame through the real SDK: markup stays text, nothing runs, no step changes, no request to the address in the message) |
| S3 | The in-memory rate limiter never removed expired entries, so a stream of unique addresses could grow its map without limit. | Low | Bounded at 10,000 keys: expired entries go first, then the oldest. (It is still per instance. See R2.) | `test/security-hardening.test.js` |
| S4 | The incident pack carries the **masked** story by default, but masking only hid digit runs of 6 or more, so "my PIN is 5521" or "password: hunter2" went into a pack meant to be shared with a bank, SAPS or an insurer. | Medium (privacy) | A value typed straight after PIN, OTP, password, CVV, passcode or "verification/security/login/one-time code" is hidden; the **name stays**, so the guidance and rules still see that a PIN was asked for. Output for every text the old patterns already handled is unchanged (0 of 174 evaluation texts changed, compared before and after). It is still pattern based: a secret written another way is missed. | `test/shared.test.js` (3 new tests), `test/handoff.test.js` |
| S5 | In the new handoff code a step "state" looked up in an object by key, so a hostile value such as `__proto__` returned a prototype object instead of "not reported". (Only taps set that value in the app; the function is exported.) | Low | `Object.hasOwn`. | `test/handoff.test.js` (found by the test, then fixed) |
| S6 | The handoff "reference number" is deliberately not masked (masking would hide the number a bank asks for), so someone could paste an account or phone number there. | Low | A purely numeric value of 8 or more digits is refused and the preview says why; odd characters and over 40 characters are refused. A heuristic, not a guarantee. | `test/handoff.test.js`, `scripts/emergency-smoke.mjs` |
| S7 | `Cross-Origin-Resource-Policy` was not set. | Info | `same-origin` added (server and `vercel.json`, parity tested). | `test/security-hardening.test.js` |

**Considered and not adopted: `Cross-Origin-Opener-Policy: same-origin`.** I added it, and the offline browser test then failed 6 times out of 6. A/B on the real offline flow: with COOP, Chromium under Playwright's offline emulation reported `navigator.onLine = true` for the whole observation (no `offline` event), without it `false` at once; the page itself still loaded from the saved copy either way. I did not establish the browser mechanism, and I have not seen a real phone either way. A header that hides the offline indicator from my own verification is not worth its small benefit here: framing is already blocked (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), external links use `noopener noreferrer`, and nothing opens popups. Revisit with a real phone. A test pins its absence with a pointer to this paragraph.

## 4. OWASP Top 10 (2021) walk-through

A self-review against the category names, not an ASVS assessment.

| Category | What applies here | Controls and evidence | Residual |
|---|---|---|---|
| A01 Broken access control | No accounts. Voice test access, static files, cross-site use of the API | Operator token (24+ chars, timing-safe compare, 10 attempts per 10 minutes then lockout, refused on `VERCEL_ENV=production` unless explicitly allowed, https or same machine only). Origin checks on voice and triage (`Sec-Fetch-Site`, `Origin` vs `Host`). Static files are served only for an extension allowlist and only inside `public/`: 20 traversal, encoding, dotfile and source-file probes return 400/404 and leak nothing. Voice routes are `LABELS` ∩ playbook. | Origin checks stop other **websites**, not scripts (R3). |
| A02 Cryptographic failures | TLS, secrets, hashing | TLS is the platform's. Secrets live only in server environment variables; the private Retell key never reaches the browser (tested end to end: not in any request, header or page). Fingerprints are SHA-256 and are described everywhere as detecting change, **not** proving authenticity. | HSTS is set by the platform on Vercel, **not verified here**; the local server must not send it over http. |
| A03 Injection | Typed text, AI prompt, transcript, pack fields, the DOM | No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `eval` anywhere in app code (test walks every file), none in the shipped engine bundle (checked). CSP `script-src 'self'`, `style-src 'self'`, no inline script. User, transcript and pack text is set with `textContent`. AI triage output must match a fixed schema (`label` + `confidence` only; extra keys rejected); the triage prompt treats the text as data. Hostile triage input and hostile transcript content were tested through real browsers. | An AI model can still be misled into a **wrong label**; routing then falls to the cautious path (low confidence, mixed incident, rules guards). Never claimed otherwise. |
| A04 Insecure design | The product's safety model | Bank action visible from the first screen and never waits on a network call; every provider failure falls back to local rules; quotas **fail closed**; public voice is refused on Vercel without a shared store; the assistant has no way to tick a step, call anyone or read out a number it was not given. | The voice assistant can still *say* something wrong. R4. |
| A05 Security misconfiguration | Headers, binding, deployment | Seven headers with parity between local server and `vercel.json` tested; same headers on 404/405/413/415/400 responses. Operator test refused on production by default. | `server.js` binds `0.0.0.0` so phones can reach it: use `HOST=127.0.0.1` when real keys are configured (R9). Vercel Deployment Protection is the owner's decision. |
| A06 Vulnerable and outdated components | Dependencies | Production closure: **17 packages** (the Retell browser SDK 3.0.3 and its tree), build tool esbuild 0.25.12; every package has an integrity hash and resolves from `registry.npmjs.org`; only esbuild has an install script and `npm ci --ignore-scripts` works. `npm audit`: **0 vulnerabilities on 27 October 2026** (registry data of that day). The browser receives a 34,867-byte bundle: `livekit-client` is replaced by a local stub, and the CSP allows no LiveKit host. | Advisories change daily: the CI audit job is advice, not proof. |
| A07 Identification and authentication failures | Only the operator token | Lockout, timing-safe comparison, token never stored (not in cookies, storage or the URL; the field empties itself), a wrong token is answered like no token. | One shared secret, no rotation tooling: rotate by changing the environment variable. |
| A08 Software and data integrity failures | Offline copy, build, CI | Service worker install is all-or-nothing and every file is checked against a SHA-256; a failure deletes the half-built copy and keeps the previous version. A waiting update never takes over mid-use. Build is reproducible (see §7). CI actions are pinned to full commit SHAs. | **Integrity is not authenticity:** the manifest and the files come from the same origin, so a compromised server or CDN could ship a malicious update. No signing. Accepted for this stage. |
| A09 Security logging and monitoring failures | Abuse detection | The app deliberately logs nothing about requests (privacy). | **There is no audit trail for abuse.** Use the platform's request logs and set Retell's own spend alert and limit. Stated as a gap, not a feature. |
| A10 Server-side request forgery | Outbound calls | The server only calls fixed or operator-configured hosts (Retell, the quota store, Anthropic). No URL comes from a request. | `RETELL_API_BASE` is an environment override for tests: keep it unset in real deployments. |

## 5. Voice-specific threats

- **Prompt injection by speech.** A caller, a scammer on a speaker, or the owner can say "ignore your instructions". Controls: the hardened agent prompt in `VOICE-COMPANION.md` (not yet exercised against a real agent), and, more importantly, **the app never acts on what is said**: transcript text is rendered as text only, nothing parses it, the only things reported to the incident timeline are six fixed-wording events, and a step changes only when the person taps. Shown end to end through the real SDK with markup, "tap done for the owner" and "all steps completed" in the stream.
- **Transcript and event manipulation.** Covered by S2. The transcript socket carries a Retell **public** key by design; whether Retell authorises that key for the monitor socket is unverified (R1). If it does not, captions are absent, the app says so, and calls still work.
- **Session replay.** The server stores no call token. Each session creation spends quota, so replaying the creation endpoint spends allowance, not unlimited budget. The token lifetime is Retell's, and I did not independently verify it.
- **Budget abuse.** Per-visitor, per-hour, per-day session and worst-case-minute caps, taken all-or-nothing, hashed visitor ids, fail closed on a store error; operator calls capped at 3 minutes and 5 a day and labelled as tests. These bound **our** side. Retell's own spend limit must also be set (user action) and is the real backstop.
- **Provider retention.** Each call carries a `basic_attributes_only` override and the read-only preflight checks the agent for storage settings, a webhook and language. It cannot see an **account-level** webhook; that is a manual dashboard check. The preflight has been run only against a local fake.
- **Offline.** A live AI call needs the internet. The app says so, ends a dropped call cleanly, keeps the conversation and points to the guide on the phone.

## 6. Offline copy and service worker

Scope is the whole origin, so the rules are strict and tested in a real browser with the HTTP server shut down: no runtime caching (nothing typed, no API reply, no voice session, no evidence and no pack is ever stored; checked by listing every cache and storage after a full journey); `/api/` and `/vendor/` bypass the worker; non-GET, range and cross-origin requests bypass it; the original security headers, including the CSP, are kept on responses served from the copy; cookies are stripped from cached responses; a corrupted file fails the install; an update waits until the page is closed; a bad update rolls back; cache eviction is detected and repaired. Staleness is shown (a warning after 30 days). What this does not give: authenticity (A08), a first-ever offline visit (impossible), or any claim about phones. Chromium on a laptop is what was tested.

## 7. Supply chain and reproducibility

- Lockfile v3, 44 entries, integrity hashes on every package, one registry host.
- Build twice and compare, with `SOURCE_DATE_EPOCH` fixed and a file's modified time changed in between: icons, engine bundle and manifest were **byte-identical**. Without it, the only difference is the informational `builtAt` timestamp; the content-derived version and all 31 asset hashes matched. The CI workflow, once switched on (see below), repeats this on every pull request. The comparison **across two separate installs** (this working copy against a clean clone of the published branch, both with the same fixed date) was also done: the engine bundle, all four icons and the offline manifest were byte-identical.
- The CI workflow (`entry/ci/github-actions-ci.yml`) uses no secrets, never contacts a provider, never deploys, has read-only repository access, pins both actions by commit SHA, and treats a skipped browser suite as a failure. Its credential check is a crude tripwire (it was shown to fire on a planted string), not a scanner. **It is NOT ACTIVE and has never run on GitHub:** the connection used to publish this branch was refused permission to write under `.github/workflows/`, so the file sits at the path above until someone with workflow permission copies it to `.github/workflows/ci.yml`. Until then there is no automated gate on pull requests.

### Credential check actually done on this branch

GitHub's own secret scanner **could not be used**: the tool reported that GitHub Advanced Security is not enabled for the repository. What was done instead: a pattern scan (cloud, payment, GitHub, Slack and private-key shapes, long bearer values) of **all 3,846 lines this branch adds** relative to the base commit, plus a manual review of every quoted literal of 24 or more characters that looks like a secret (14 of them). Result: nothing matched except the clearly fake `TESTONLY` fixtures used by the tests (`key_TESTONLY_not_a_real_secret_...`, `operator-TESTONLY-token-...`, `public_key_TESTONLY_...`). That is a self-check, not a guarantee. **Turn on GitHub secret scanning and push protection where your plan allows it**, and never put a real key in a file, a test or a chat message.

## 8. Residual risks and things to do

| # | Risk | What to do |
|---|---|---|
| R1 | The Retell public key is held by the browser. Its permission for the monitor socket is unverified; the SDK README suggests monitoring may need a wider key than a web call. A wide key in a browser is a risk. | Use a **dedicated Retell workspace** for Mgadi with domain-restricted keys. After the first approved real call, decide: public key (captions), a server relay, or `MGADI_TRANSCRIPTS=off`. |
| R2 | Rate limits are per instance without a shared store. Public voice is refused on Vercel without one (fail closed); the triage limiter is still per instance. | Provision an Upstash or Vercel KV store (user action, may cost money) before public voice. Triage on the hosted path is rules-only, so there is no paid call behind it. |
| R3 | No CAPTCHA or bot protection; origin checks stop websites, not scripts. | Rely on the quotas and Retell's spend limit; consider the platform's bot protection. |
| R4 | The voice assistant can say something wrong or be manipulated by speech. No adversarial speech has been run against a real agent. | Include scripted adversarial lines in the first approved real test; keep the bank button and the "I am an AI" disclosure; keep the public off until it passes. |
| R5 | An account-level Retell webhook or retention setting cannot be seen through the API. | Check the dashboard by hand, as the runbook says. |
| R6 | Integrity is not authenticity (A08). | Accept for now; consider signing releases later. |
| R7 | HSTS and other platform headers are not verified on a real deployment. | Check the headers on the first preview. |
| R8 | COOP is absent (§3). | Revisit with a real phone. |
| R9 | The dev server listens on all interfaces. | `HOST=127.0.0.1` whenever real keys are set. |
| R10 | If this is hosted somewhere other than Vercel, forwarding headers are not trusted and all visitors share one limiter bucket (safe, but crude). | Set the platform up deliberately. |
| R11 | Redaction is pattern based. It will miss a secret written another way, and names are hidden only if listed. If the owner opts in to "my own words", the pack carries them. | The interface says so at each step. Do not describe redaction as anonymisation. |
| R12 | The voice provider processes audio, possibly outside South Africa. | POPIA cross-border and consent wording need legal review before any public launch. |
| R13 | No independent penetration test, no real-device test. | Book them. |

## 9. How to repeat the checks

```
npm ci && npm run build        # engine bundle, icons, offline manifest
npm test                       # unit and security tests (175 at the time of writing)
npm run scoreboard             # fails on unsafe routing or a changed sealed set
npm run test:browser           # every browser suite; a skipped suite counts as a failure
npm audit
```

Browser suites need Playwright and axe-core installed **outside** the lock file (see the CI file for the pinned versions) and `MGADI_PLAYWRIGHT` / `MGADI_AXE` set. Nothing here contacts a paid service.

---

## 10. Addendum: sealed links, supplier check, responder handoff, POPIA draft (branch `feature/popia-supplier-check-handoff`, 28 October 2026)

**Same caveat as above: a developer's self-review, not a penetration test, not an audit.** Nobody outside the build has examined this code. The data statement is `LINKS-DATA.md`; read it first.

### 10.1 What was and was not examined

| Examined | Not examined |
|---|---|
| The link service: create, read, decide, acknowledge, expiry, duplicates, replay, tampering (unit tests, and over real HTTP) | **A real shared store.** The Upstash-style store was exercised only against a fake that speaks the same REST protocol. Real atomicity of `SET ... NX EX` and real expiry are assumed from the provider's documentation, not observed |
| Locking and unlocking in the browser (AES-GCM, key only after `#`, record binding) | Browsers other than the bundled desktop Chromium; any Safari or phone WebCrypto behaviour |
| What a real browser actually sends (every request captured) and what the physical store holds | A hostile hosting operator or store provider; traffic analysis; denial of service at scale |
| What a victim's browser does with text from a link someone else made (attacker-crafted link) | A real second device: the "second person" is a second browser profile on the same machine |
| The wording of every new screen against "Mgadi blocks / holds / protects / verifies" claims | Whether the **content** is right: the red flags, the verification questions and the POPIA text have had no practitioner, lawyer or information-officer review |

### 10.2 Assets and who might attack them

Assets: (1) the owner's decision about money, which must never be pushed by a false "approved" or a false sense of protection; (2) the privacy of the supplier name, amount, names and the helper summary; (3) the truth of each status ("approved", "acknowledged"); (4) the store (disk/quota).

Adversaries: a scammer who persuades the owner to make or use a link; **someone who builds their own link and sends it to a victim** (the attacker controls the key, so controls the text, which can look like a Mgadi screen); someone guessing ids or codes; someone replaying or duplicating requests; someone who forwards or intercepts a link; a flood of creates; a hostile or breached host or store.

### 10.3 Abuse cases and what was shown

| Case | What was done | Result |
|---|---|---|
| **Link tampering:** last character cut, one character of the key changed, one character of the code changed, a link to a record that does not exist | Real browser, four cases; unit tests on the service | Each shows "This link cannot be used" with nothing decided. A wrong key fails AES-GCM; a wrong code or id is the same 404 |
| **Content moved between records** (ciphertext copied to another id, kind or slot) | `test/seal.test.js` | Fails to open: the record id, kind and slot are bound into the encryption (AAD). Removing that binding makes the test fail (mutation N1) |
| **Replay of a decision** | Real browser and HTTP | Same answer again: 200 "duplicate", nothing changes. A different answer: **409**, the first stands. Reloading an answered link shows the final state and no button |
| **Simultaneous conflicting decisions** | 20 parallel approve/reject on one link | Exactly one winner, and every reply agrees with it (one atomic set-if-absent) |
| **Duplicate create** (retry after a lost reply, double click) | Browser: reply cut after the server stored the record, then a double click | One record. The retry reuses the same sealed bytes and gets "duplicate"; the double click sends one request. A different record under the same id is refused (409) |
| **Role abuse:** the owner's code used to approve their own request, or to acknowledge their own summary | Browser and HTTP | 403. Only the second person's / contact's code can decide |
| **Existence oracle:** can a stranger learn whether an id exists? | Unit | Wrong id, wrong code and expired all give the identical 404 body (mutation C: a 403 for "right id, wrong code" fails the test) |
| **Expiry** | Unit with a controlled clock, and with a store that never expires anything | Works at the exact millisecond; the event goes with the record; the **service** refuses an expired record even if the store hands it back |
| **Malformed or hostile create requests** | 30 variants: `kind: "__proto__"`, `"constructor"`, arrays/objects where strings belong, traversal ids, oversized or non-base64 ciphertext, wrong IV length, equal owner/contact hashes, unknown extra fields | All 400; nothing stored; extra fields ignored and never persisted; no prototype pollution |
| **HTTP layer** | Real server | Cross-site origin 403, non-JSON 415, over 8 KB 413, GET 405, 21st create in an hour 429 |
| **Attacker-crafted link shown to a victim** | Real browser: a link made by a separate script with markup (`<img onerror>`, `<script>`), `tel:` and `javascript:` text, a direction-override character, 900-character lines | Shown as plain text only: no script runs, no element is created, no number or link is clickable, lines are cut to 400 characters (browser) and to 40 lines (pinned by a unit test), unknown fields dropped. The victim is told Mgadi has not checked who sent it and not to call any number or open any link inside it. Breaking the cleaning **and** the text-only display together made this check fail, and the CSP independently refused the inline handler (observed) |
| **What the server learns** | Physical store inspected after use; every browser request captured | Making a link sends no text, key or raw code. Across the owner's whole session the typed text, the key and the caller's name are never sent. A raw code is sent only when it is presented to use the link |
| **What the browser keeps** | Real browser after every flow | Nothing in localStorage, sessionStorage, cookies, IndexedDB or the offline cache |
| **Failure modes** | Server answering 503, browser offline, reply lost | The person is told, nothing is sent or changed, and the handoff status stays "draft" |

### 10.4 Findings fixed

Severity is the author's judgement (Low / Info). Found by writing the tests or by breaking the code and watching them.

| # | Finding | Severity | Fix | Pinned by |
|---|---|---|---|---|
| S8 | **Retry created a conflicting record.** After a lost reply, "Try again" locked the content again with a fresh IV, so the server saw a *different* record under the same id and answered 409: the owner was stuck, and a real retry would have looked like an attack. | Low (availability; found by the browser test) | The locked bytes are made once per attempt and reused on every retry | `scripts/tools-smoke.mjs` (re-introducing the bug makes the run fail on a timeout) |
| S9 | **The memory store never removed expired entries.** Ciphertext and fingerprints stayed in memory after expiry until the process ended (they were no longer served). | Low (retention) | Expired entries are removed by the first request at least a minute after the last clean-up | `test/links.test.js`; mutation H |
| S10 | **The handoff payload accepted non-string lines** (an object where a line belongs). | Low | Only strings are kept | `test/popia-responder.test.js`; mutation P5 |
| S11 | **The screen and a code comment overclaimed** "never keeps your address or any log". The rate limiter holds the caller's address in server memory for up to an hour (never stored with the link), and the hosting company may log. | Low (honesty of a privacy statement) | Screen, code comment and `LINKS-DATA.md` now say exactly that | read by hand; `LINKS-DATA.md` §3 |
| S12 | **The wording guard was weak.** It only caught the literal verbs block/stop/hold/release, and any "not" in a string excused the whole string. "Your payment is now on hold", "Mgadi has protected your payment", "The transfer is safe", "Approved by Mgadi. You can pay now." and "Mgadi verified the supplier" all passed it. | Medium for a feature whose promise is never to imply Mgadi controls or vouches for a payment | Broader patterns (hold, protect, safe, approve, verify, "safe to pay"), negation judged one sentence at a time, and a self-test that the guard catches the bad phrasings and lets honest negations through | `test/supplier-check.test.js`; mutations W1–W9. **Still a pattern check, not proof: a human must read new copy** |
| S13 | **Test gaps with no product bug behind them:** the service's own expiry check was untested (the memory store masked it); prototype names such as `constructor` were not tried in every choice field (the code already used `Object.hasOwn`); and my first browser check claimed "the server never received a raw code", which was **false** (the owner's page presents its own code to read the answer), so the claim was narrowed to what is true | Info | Tests added; claim corrected | `test/links.test.js`, `test/supplier-check.test.js`, `scripts/tools-smoke.mjs` |

### 10.5 Mutation checks on the new tests

I broke the code on purpose and checked the tests failed: **67 runs including re-runs**, on the link service (13), sealing and cleaning (13 + 4), supplier-check rules (the same groups), POPIA and handoff (10 + 4), the HTTP route (4), the Vercel adapter (1), the wording guard (9), the browser suite (retry bug; a text-only display and the cleaning broken separately and together).

**Eight mutations survived at first:** the service's own expiry check (1), prototype names accepted as a choice (1), five phrasings of "Mgadi holds/protects/approves/verifies" (5), and one of my own that was vacuous (I mutated a field name that does not exist; redone against the real field, it was caught). The first seven were real test gaps (three areas) and are closed above (S12, S13). One more: breaking only the text-only display in the browser is **not** caught by the browser suite because the cleaning layer still neutralises the payload; it **is** caught by the repository's static test that forbids `innerHTML` and similar in all of `public/`. That is layered defence, not a gap, but it means no single test proves each layer on its own.

### 10.6 Residual risks (new)

| # | Risk | What to do |
|---|---|---|
| R14 | **A link is a bearer credential.** Whoever holds it can read it and (the second person's) answer first, and the first answer is final. The channel that carries it can read it. The address stays in browser history. | Stated on the screens and in `LINKS-DATA.md`. Choose the channel deliberately, tell the second person to expect it. Future: revoke a link, one-time view, a code the second person receives on a different channel |
| R15 | **A compromised Mgadi server could serve changed JavaScript** that sends the key away. Locking in the browser protects against a server that stores, not one that serves. | Same class as A08. Consider subresource integrity or signed releases and keeping static hosting separate from the link store |
| R16 | **The shared store has never been used.** Real behaviour of an Upstash-style store (atomic set-if-absent, expiry, outage behaviour, its own logs) is unverified. | Create a store (account owner; check any cost), run the same flows against it once, and read its retention and logging settings |
| R17 | **Store exhaustion.** Each create keeps up to about 6 KB for 7 days. The rate limit is 20 an hour per address *per instance*; a distributed flood is not capped. | Use the store plan's own limits and alerts; add a global quota before any public use |
| R18 | **No identity for the second person.** A forwarded link lets a stranger approve first. The owner sees "approved by someone with the link, typed name X". | The screens say so. Tell the second person in person or by phone to expect the link; treat an approval you did not expect as a reason **not** to pay |
| R19 | **The audit record is a checksum.** The owner holds it and could edit it and recompute the fingerprint; Mgadi keeps no copy. | Stated on the record. Future: a server-held or externally anchored attestation |
| R20 | **Someone can send a victim a Mgadi-looking link** whose text is theirs ("approve this payment change"). The screen warns that Mgadi has not checked who sent it and nothing in it is clickable, but persuasive text can still deceive. This is inherent to sharing links. | Warning wording is the only control today; it needs a usability test with real people, which has not been done |
| R21 | **The operator can see** that a link exists, when it was made and answered, its status and its size, though not its content. | Stated in `LINKS-DATA.md` §6 |
| R22 | The POPIA draft and the supplier-check wording have not been reviewed by anyone qualified. | See `PLAYBOOK-REVIEW.md` and the checklist; do not describe either as reviewed |

### 10.7 How to repeat

```
npm ci && npm run build
npm test                          # 231 tests at the time of writing (56 new for this branch)
npm run test:browser              # 7 suites; the new one is scripts/tools-smoke.mjs (63 checks)
npm audit
```

The new unit files are `test/seal.test.js`, `links.test.js`, `links-http.test.js`, `supplier-check.test.js` and `popia-responder.test.js`. Nothing here contacts a paid service.
