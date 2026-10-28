# Mgadi → Railway deployment (GitHub source)

This deployment branch starts with `feature/mobile-first-navy-teal` (the mobile demo in PR #29).
**Do not merge, delete Vercel, or flip public-paid-provider flags until the Railway release is checked.**
The Dockerfile lives in `entry/` and preserves the same web app, server, voice SDK bundle, icons and offline manifest.
It serves the existing Node HTTP server; there is no extra standalone frontend service.

## 1. Set up the Railway service

- Railway → New Project → Deploy from GitHub Repo → `ChumaMike/Mgadi`.
- Select branch **`feature/railway-hosting-mobile-20261028`** for the demo; change to `main` only after the PR is approved/merged. Do **not** deploy the default `main` branch expecting the unmerged redesign.
- Service → Settings → **Root Directory: `/entry`**. Railway detects `entry/Dockerfile` automatically.
- Keep the Dockerfile's start command (`node server.js`); the server binds to `0.0.0.0` and Railway injects `PORT`.
- Set **Healthcheck Path: `/api/health`**, enable the public Railway domain under Networking, and make sure HTTPS works.
- Do not use the deprecated `railway.json` config-as-code format for a new service. Node 22 is pinned in the image.

## 2. Migrate the **right** variables from Vercel to Railway

This is the inventory of keys visible on the Mgadi Vercel project as of 28 Oct 2026.
**No secret values are stored in this document or in GitHub.**
Vercel's Production and Preview variables are separately scoped and must not be blindly combined.

| Key | Found on Vercel | Railway action |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Production, secret | Set securely in Railway. Enables server-side AI triage when `MGADI_AI` isn't `off`. |
| `MGADI_AI_TEST_TOKEN` | Production, secret | Set only for restricted/operator Claude chat demo; 24+ characters. Never use a browser/public variable. |
| `MGADI_AI_PUBLIC_READY` | Production, config | Preserve only if paid public AI readiness really passed; otherwise unset (or `no`). |
| `MGADI_VOICE_MODE` | Production and old Preview branch | Set `off` until the intended Retell agent and cost/privacy validation are complete. Then `retell`. |
| `RETELL_API_KEY` | Old Preview branch `feature/final-voice-avatar`, secret | Recreate securely for Railway; do not mistake it for a current-production variable. |
| `RETELL_PUBLIC_KEY` | Old Preview branch, secret | Restore the provider's domain-restricted **browser public** key; allowlist the new Railway domain in Retell. |
| `RETELL_AGENT_ID_EN` | Preview, not branch-scoped | Set the correct current English Retell agent ID and confirm its voice/language configuration. |
| `MGADI_OPERATOR_TOKEN` | Old Preview branch, config | Use a **new** random 24+-character secret for staging; do not reuse the previously exposed plain token. |
| `MGADI_OPERATOR_MAX_MINUTES` | Old Preview branch | Optional; keep a short cap (default 3). |
| `MGADI_OPERATOR_MAX_SESSIONS_PER_DAY` | Old Preview branch | Optional; keep a small cap (default 5). |

These **additional** variables are needed for a reliably functioning Railway deployment; they were NOT in that Vercel list:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: Upstash REST-compatible service. Required for durable supplier/responder links and **required for public live voice** on Railway. Railway native Redis URLs are **not** interchangeable with Upstash REST URLs.
- `MGADI_VOICE_VERIFIED_LANGUAGES=en` only **after** a real provider/agent, English guidance, privacy, audio and captions check succeeds. Do not falsely unlock unreviewed languages.
- `RETELL_AGENT_VERSION` to pin a verified Retell agent version, if established.
- `MGADI_VOICE_PER_HOUR`, `MGADI_VOICE_DAILY_SESSIONS`, `MGADI_VOICE_MAX_MINUTES`, `MGADI_VOICE_DAILY_MINUTES`, and `MGADI_VOICE_PER_CLIENT`: optional explicit cost/abuse limits; safe defaults exist.
- `MGADI_MODEL`, `MGADI_CHAT_MODEL`, `MGADI_AI=off` (to disable paid AI) are optional.
- `MGADI_OPERATOR_ALLOW_PRODUCTION=yes`: **do not set** on public production. Operator testing is allowed in Railway `staging` only with an operator token; the default production check blocks it.

Railway injects `PORT`, `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_NAME`, etc. Do **not** copy Vercel system variables (`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_OIDC_TOKEN`) into Railway. In particular, setting `VERCEL=1` on Railway will alter rate/production logic and should be avoided.

**Secure workflow:** In Vercel open Project → Settings → Environment Variables to review each value's proper environment. Move values to Railway → Service → Variables (Raw Editor supports multi-value import) through your authenticated dashboards. Rotate/reissue existing non-exportable secrets at their original providers rather than putting them in chat, source, CLI process arguments, PRs or build logs. Remember to Deploy staged variable changes.

## 3. Validate the real deployment

Do not assume that moving variables alone activates all features.
Test these from the **actual HTTPS Railway domain**:

1. `GET /api/health` → HTTP 200 `{"ok":true,"ai":...}` (the AI flag indicates server-side triage availability, **not** that a paid request succeeded).
2. `GET /` → official Mgadi logo, phone-first screens and banking shortcut.
3. `POST /api/triage` (safe synthetic incident) → valid first-hour guidance and browser steps.
4. Text and call branches → correct incident steps; mark Done/Need help/Not applicable.
5. Evidence permission → Deny or Accept; only the files selected in the system picker are fingerprinted locally; pack review, download and SHA-256 verify.
6. `GET /api/voice/config` → mode and language availability; no private API keys in the response.
7. After real consent, do a controlled short English Retell call in staging. Confirm TWO-WAY audio, captions, provider costs, authenticated quota checks, 3D state motion, and permissions; never label illustrative gestures verified SASL.
8. With Redis REST variables configured, test a synthetic supplier-check and responder-link round trip across a restart.
9. Test offline revisit after initial load; test mobile widths 320, 390, 430px; test TalkBack/VoiceOver, zoom and keyboard focus.
10. Check runtime logs for health and errors **without printing credentials or personally identifiable incident data**.

`GET /api/health` and `GET /api/voice/config` do not prove Retell is reachable, voice audio works, or the Retell public-key domain allowlist is correct.

## 4. Important differences from Vercel

- Railway runs one persistent Node process (or more if you scale). Server-side link data cannot safely survive restarts or multiple instances without shared Upstash REST. Do **not** assume memory-only links are persistent.
- Railway's public HTTPS edge supplies `X-Real-IP` and `X-Railway-Edge`; Mgadi uses the former for its per-client advisory limit only on HTTPS-edge requests. Private network requests are untrusted. Paid calls retain shared quotas.
- The in-browser Retell session and live captions still talk to Retell from the phone, so configure Retell's domain allowlist for the actual Railway hostname.
- AI chat requires the long `MGADI_AI_TEST_TOKEN` per request. A matching `ANTHROPIC_API_KEY` alone does not make this API open to anonymous users.
- If the provider account has insufficient credit or the key/agent is invalid, server-side variables cannot fix it; verify provider-side settings before calling the feature working.

## Deployment status

This file documents repository preparation only. An actual Railway deployment needs an authenticated Railway project/service and verified live deployment URL. **No Railway URL is asserted here.**
