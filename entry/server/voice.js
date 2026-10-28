// Voice companion backend. Private Retell credentials exist ONLY here, read from the environment, and are never
// returned to the browser or written to logs. The browser asks us for a web call; we build the Retell request
// ourselves from validated inputs, so a visitor cannot choose the agent, override agent settings, or inject prompt text.
//
// Two separate states for a language (they must not be confused):
//   operator test eligible  A person holding the server-side operator token may start a short, capped call in a language
//                           that has an agent which passes the privacy check. This is how real verification is done.
//   publicly verified       Anyone may use it, but only after the operator lists it in MGADI_VOICE_VERIFIED_LANGUAGES
//                           following real provider, audio, language, privacy and cost checks.
// The operator state never makes a language public, and it is refused on production deployments unless explicitly allowed.
import { buildGuidance, guidanceToText, VOICE_LANGUAGES } from '../public/voice/guidance.js';
import { catalog } from '../public/accessibility/catalog.js';
import { LABELS } from '../public/shared/labels.js';
import { consumeAll, createStoreFromEnv, hashId, safeEqual } from './quota.js';

export const VOICE_CONSENT_VERSION = 'voice-consent-1';
const MAX_CONFIRMED = 12;
const DAY_MS = 86_400_000;

// Retell's `language` enum (OpenAPI revision 2026-10-26, create-web-call) lists af-ZA and several English locales
// but no isiZulu or isiXhosa. Re-check https://docs.retellai.com/build/language-support.md before changing this.
export const PROVIDER_LANGUAGES = Object.freeze({
  en: { label: 'English', retell: ['en-US', 'en-GB', 'en-IN', 'en-AU', 'en-NZ'] },
  af: { label: 'Afrikaans', retell: ['af-ZA'] },
  zu: { label: 'isiZulu', retell: null },
  xh: { label: 'isiXhosa', retell: null },
  // The other official languages. Retell's language list has no entry for any of them, so none can have a real voice. They keep the
  // text guidance (English until a reviewed translation exists) and the same plain reason as isiZulu and isiXhosa.
  st: { label: 'Sesotho', retell: null },
  tn: { label: 'Setswana', retell: null },
  nso: { label: 'Sepedi (Sesotho sa Leboa)', retell: null },
  ss: { label: 'siSwati', retell: null },
  nr: { label: 'isiNdebele', retell: null },
  ts: { label: 'Xitsonga', retell: null },
  ve: { label: 'Tshivenda', retell: null },
});
const UNSUPPORTED = 'Retell does not list this language for speech recognition or voice. Text guidance is available; read-aloud works only if your device has a matching voice.';
const intIn = (value, fallback, min, max) => Math.min(Math.max(Math.trunc(Number(value)) || fallback, min), max);

export function loadVoiceConfig(env = process.env) {
  const requested = String(env.MGADI_VOICE_MODE ?? 'off').toLowerCase();
  const agents = { en: env.RETELL_AGENT_ID_EN || null, af: env.RETELL_AGENT_ID_AF || null };
  const hasKeys = Boolean(env.RETELL_API_KEY && (agents.en || agents.af));
  const mode = requested === 'mock' ? 'mock' : requested === 'retell' && hasKeys ? 'retell' : 'off';
  const token = String(env.MGADI_OPERATOR_TOKEN ?? '');
  const productionBlocked = env.VERCEL_ENV === 'production' && env.MGADI_OPERATOR_ALLOW_PRODUCTION !== 'yes';
  const maxMinutes = intIn(env.MGADI_VOICE_MAX_MINUTES, 10, 1, 30);
  const dailySessions = intIn(env.MGADI_VOICE_DAILY_SESSIONS, 100, 1, 100_000);
  const version = Number(env.RETELL_AGENT_VERSION);
  return {
    mode,
    misconfigured: requested === 'retell' && !hasKeys,
    apiKey: env.RETELL_API_KEY || null,
    publicKey: env.RETELL_PUBLIC_KEY || null,
    // 'public-key': the browser gets the Retell public key in the session response and opens the live-transcript socket.
    // 'off': no key reaches the browser and there are no live captions.
    transcripts: String(env.MGADI_TRANSCRIPTS ?? '').toLowerCase() === 'off' ? 'off' : 'public-key',
    apiBase: String(env.RETELL_API_BASE || 'https://api.retellai.com').replace(/\/+$/, ''),
    agents,
    agentVersion: Number.isInteger(version) && version >= 0 && env.RETELL_AGENT_VERSION !== undefined && env.RETELL_AGENT_VERSION !== '' ? version : null,
    verified: new Set(String(env.MGADI_VOICE_VERIFIED_LANGUAGES ?? '').split(',').map((s) => s.trim()).filter(Boolean)),
    maxCallMs: maxMinutes * 60_000,
    perClientLimit: intIn(env.MGADI_VOICE_PER_CLIENT, 3, 1, 100),
    perClientWindowMs: 10 * 60_000,
    perHourLimit: intIn(env.MGADI_VOICE_PER_HOUR, 20, 1, 10_000),
    dailySessions,
    // Worst-case audio minutes per rolling day: every session is assumed to run to its time limit.
    dailyMinutes: intIn(env.MGADI_VOICE_DAILY_MINUTES, Math.min(dailySessions * maxMinutes, 600), 1, 1_000_000),
    // Operator testing: needs a long random token set on the server; capped hard; never on production by default.
    operatorEnabled: token.length >= 24 && !productionBlocked,
    operatorTokenTooShort: token.length > 0 && token.length < 24,
    operatorToken: token,
    operatorMaxMs: intIn(env.MGADI_OPERATOR_MAX_MINUTES, 3, 1, 10) * 60_000,
    operatorPerDay: intIn(env.MGADI_OPERATOR_MAX_SESSIONS_PER_DAY, 5, 1, 20),
    // Without a shared store the public limits only apply per serverless instance, so public calls are refused on Vercel.
    sharedStoreRequired: Boolean(env.VERCEL),
  };
}

export function createVoiceService({ env = process.env, fetchImpl = globalThis.fetch, playbook, now = () => Date.now(), store } = {}) {
  const cfg = loadVoiceConfig(env);
  const quota = store ?? createStoreFromEnv(env, { fetchImpl, now });
  const agentChecks = new Map();

  const agentUrl = (lang) => `${cfg.apiBase}/get-agent/${encodeURIComponent(cfg.agents[lang])}${cfg.agentVersion === null ? '' : `?version=${cfg.agentVersion}`}`;

  // Reads the agent from Retell and checks everything we depend on. Used for access decisions and by the preflight script.
  async function inspectAgent(lang) {
    const checks = [];
    // status: 'pass' | 'warn' (advisory, does not block) | 'fail' (blocks access)
    const add = (name, status, detail) => checks.push({ name, status, ok: status !== 'fail', warn: status === 'warn', detail });
    const unreachable = 'The agent could not be checked with Retell.';
    let agent;
    try {
      const response = await fetchImpl(agentUrl(lang), { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) { add('agent reachable', 'fail', unreachable); return { ok: false, reason: unreachable, checks }; }
      agent = await response.json();
    } catch { add('agent reachable', 'fail', unreachable); return { ok: false, reason: unreachable, checks }; }
    add('agent reachable', cfg.agentVersion === null ? 'warn' : 'pass', cfg.agentVersion === null ? 'Version not pinned (Retell picks the default). Set RETELL_AGENT_VERSION to pin it.' : `Pinned to version ${cfg.agentVersion}.`);
    const language = Array.isArray(agent.language) ? (agent.language.length === 1 ? agent.language[0] : null) : agent.language ?? 'en-US';
    add('language', PROVIDER_LANGUAGES[lang].retell.includes(language) ? 'pass' : 'fail', `Agent language is ${String(language)}; expected ${PROVIDER_LANGUAGES[lang].retell.join(' or ')}.`);
    add('data storage', agent.data_storage_setting === 'basic_attributes_only' ? 'pass' : 'fail', `data_storage_setting is ${String(agent.data_storage_setting)}; it must be basic_attributes_only.`);
    add('agent webhook', agent.webhook_url ? 'fail' : 'pass', agent.webhook_url ? 'The agent sends call data to a webhook. Remove it.' : 'No agent-level webhook. An ACCOUNT-level webhook cannot be checked through the API: confirm in the dashboard that none exists.');
    add('retention period', Number.isInteger(agent.data_storage_retention_days) ? 'pass' : 'warn', Number.isInteger(agent.data_storage_retention_days) ? `Call attributes are deleted after ${agent.data_storage_retention_days} days.` : 'No automatic deletion period is set. Consider data_storage_retention_days.');
    const failed = checks.find((c) => c.status === 'fail');
    const reason = !failed ? '' : failed.name === 'language' ? `The Retell agent is set to ${String(language)}, not ${PROVIDER_LANGUAGES[lang].label}.`
      : failed.name === 'data storage' ? 'The Retell agent stores transcripts or recordings. Set its data storage to "Basic Attributes Only".'
        : failed.name === 'agent webhook' ? 'The Retell agent sends call data to a webhook. Remove it.' : failed.detail;
    return { ok: !failed, reason, checks };
  }

  async function checkAgent(lang) {
    const cached = agentChecks.get(lang);
    if (cached && now() - cached.at < (cached.ok ? 300_000 : 30_000)) return cached;
    const result = { ...(await inspectAgent(lang)), at: now() };
    agentChecks.set(lang, result);
    return result;
  }

  // access: 'public' | 'operator'. An operator sees what they may TEST; the public sees only what is verified.
  async function languageStatus(access = 'public') {
    const out = {};
    for (const [code, info] of Object.entries(PROVIDER_LANGUAGES)) {
      const base = { label: info.label, available: false, reason: '' };
      if (!info.retell) { out[code] = { ...base, reason: UNSUPPORTED }; continue; }
      if (cfg.mode === 'off') out[code] = { ...base, reason: cfg.misconfigured ? 'Voice is switched on but Retell credentials or an agent ID are missing.' : 'Voice is not set up on this server.' };
      else if (cfg.mode === 'mock') out[code] = code === 'en' ? { ...base, available: true, reason: 'Simulated conversation (no real AI).' } : { ...base, reason: 'The simulation covers English only.' };
      else if (!cfg.agents[code]) out[code] = { ...base, reason: `No ${info.label} voice agent is configured.` };
      else if (!cfg.verified.has(code) && access !== 'operator') out[code] = { ...base, reason: `Configured, but not yet verified with ${info.label} speakers.` };
      else {
        const check = await checkAgent(code);
        out[code] = check.ok ? { ...base, available: true, testOnly: !cfg.verified.has(code) } : { ...base, reason: check.reason };
      }
    }
    return out;
  }

  // Decides who is asking. A wrong token never reveals why, and token guesses are rate limited per visitor.
  async function authenticate(token, clientId) {
    if (token === undefined || token === null || token === '') return { access: 'public' };
    if (!cfg.operatorEnabled || cfg.mode !== 'retell') return { access: 'public', rejected: true };
    const attempts = await consumeAll(quota, [{ key: `mgadi:opattempt:${hashId(clientId)}`, amount: 1, limit: 10, ttlMs: 600_000 }]);
    if (!attempts.ok) return { access: 'public', rejected: true, limited: true };
    return safeEqual(String(token).slice(0, 200), cfg.operatorToken) ? { access: 'operator' } : { access: 'public', rejected: true };
  }

  async function config(auth = { access: 'public' }) {
    const operator = auth.access === 'operator';
    return {
      status: 200,
      body: {
        mode: cfg.mode, simulated: cfg.mode === 'mock', consentVersion: VOICE_CONSENT_VERSION,
        maxCallMs: operator ? cfg.operatorMaxMs : cfg.maxCallMs,
        access: operator ? 'operator' : 'public',
        operatorAvailable: cfg.mode === 'retell' && cfg.operatorEnabled,
        languages: await languageStatus(operator ? 'operator' : 'public'),
        // Whether live captions will be attempted. The Retell public key itself is NOT in this response: it is handed
        // only to a caller that has passed consent and the quota checks, inside the session response.
        captions: cfg.mode === 'mock' || (cfg.transcripts === 'public-key' && Boolean(cfg.publicKey)),
      },
    };
  }

  function claimsFor(access, clientId) {
    const id = hashId(clientId);
    if (access === 'operator') {
      return [{ key: 'mgadi:operator:day', amount: 1, limit: cfg.operatorPerDay, ttlMs: DAY_MS }];
    }
    const minutes = Math.ceil(cfg.maxCallMs / 60_000);
    return [
      { key: 'mgadi:day:minutes', amount: minutes, limit: cfg.dailyMinutes, ttlMs: DAY_MS },
      { key: 'mgadi:day:sessions', amount: 1, limit: cfg.dailySessions, ttlMs: DAY_MS },
      { key: 'mgadi:hour:sessions', amount: 1, limit: cfg.perHourLimit, ttlMs: 3_600_000 },
      { key: `mgadi:client:${id}`, amount: 1, limit: cfg.perClientLimit, ttlMs: cfg.perClientWindowMs },
    ];
  }

  // `payload` is what the browser posts. Only payload.metadata.mgadi is read; everything else is ignored.
  async function createSession({ payload, consent, clientId, auth = { access: 'public' } }) {
    if (cfg.mode !== 'retell') return { status: 409, body: { error: 'voice_unavailable' } };
    if (auth.rejected) return { status: auth.limited ? 429 : 401, body: { error: auth.limited ? 'rate_limited' : 'unauthorized' } };
    if (consent !== VOICE_CONSENT_VERSION) return { status: 403, body: { error: 'consent_required' } };
    const ask = payload?.metadata?.mgadi;
    const lang = ask?.language;
    // The route must be one of the fixed labels AND exist in the reviewed playbook. The visitor cannot name anything else.
    if (!ask || !Object.hasOwn(VOICE_LANGUAGES, lang) || !LABELS.includes(ask.route) || !playbook?.incidents?.[ask.route]) return { status: 400, body: { error: 'bad_request' } };
    const confirmed = Array.isArray(ask.confirmed) ? ask.confirmed.filter((id) => typeof id === 'string' && /^[a-z_]{1,24}$/.test(id)).slice(0, MAX_CONFIRMED) : [];
    const stepId = typeof ask.stepId === 'string' && /^[a-z_]{1,24}$/.test(ask.stepId) ? ask.stepId : null;
    const operator = auth.access === 'operator';
    const languages = await languageStatus(operator ? 'operator' : 'public');
    if (!languages[lang]?.available) return { status: 409, body: { error: 'language_unavailable' } };
    const guidance = buildGuidance({ playbook, route: ask.route, stepId, confirmed, lang, catalog });
    if (!guidance) return { status: 400, body: { error: 'bad_request' } };
    if (!guidance.complete) return { status: 409, body: { error: 'guidance_not_translated' } };
    if (!operator && cfg.sharedStoreRequired && quota.kind !== 'rest') return { status: 503, body: { error: 'quota_unavailable' } };
    const taken = await consumeAll(quota, claimsFor(operator ? 'operator' : 'public', clientId));
    if (!taken.ok) return taken.reason === 'store' ? { status: 503, body: { error: 'quota_unavailable' } } : { status: 429, body: { error: 'rate_limited' } };

    const body = {
      agent_id: cfg.agents[lang],
      ...(cfg.agentVersion === null ? {} : { agent_version: cfg.agentVersion }),
      metadata: { app: 'mgadi', ...(operator ? { test: 'operator' } : {}) }, // deliberately no incident, user or transcript data
      retell_llm_dynamic_variables: {
        app_language: VOICE_LANGUAGES[lang],
        incident_title: guidance.title,
        current_step: `${guidance.current.title}. ${guidance.current.why} ${guidance.current.do.join(' ')}`,
        reviewed_guidance: guidanceToText(guidance),
        guidance_status: guidance.reviewed ? 'reviewed' : 'DRAFT: not yet reviewed by a qualified practitioner. Say so if asked.',
      },
      // Enforced on every call, whatever the agent's saved settings are.
      agent_override: { agent: { data_storage_setting: 'basic_attributes_only', max_call_duration_ms: operator ? cfg.operatorMaxMs : cfg.maxCallMs, end_call_after_silence_ms: operator ? 30_000 : 60_000, webhook_url: null } },
    };
    let upstream;
    try {
      upstream = await fetchImpl(`${cfg.apiBase}/v3/create-web-call`, {
        method: 'POST', headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
    } catch { return { status: 502, body: { error: 'voice_unavailable' } }; }
    if (!upstream.ok) return { status: upstream.status === 429 ? 429 : 502, body: { error: upstream.status === 429 ? 'provider_busy' : 'voice_unavailable' } };
    let data;
    try { data = await upstream.json(); } catch { return { status: 502, body: { error: 'voice_unavailable' } }; }
    if (typeof data?.call_id !== 'string' || typeof data?.access_token !== 'string') return { status: 502, body: { error: 'voice_unavailable' } };
    // Pass on only what the browser needs to join the call. The Retell PUBLIC key (domain-restricted, built for browsers)
    // goes out here, after the gates above, only if live captions are enabled. The private key never leaves this server.
    const publicKey = cfg.transcripts === 'public-key' && cfg.publicKey ? cfg.publicKey : null;
    return { status: 201, body: { call_id: data.call_id, access_token: data.access_token, transport: data.transport, ice_servers: data.ice_servers, expires_at: data.expires_at, mgadi: { publicKey, test: operator } } };
  }

  // Read-only report for the operator preflight script.
  async function diagnose() {
    const report = [];
    for (const [code, info] of Object.entries(PROVIDER_LANGUAGES)) {
      if (!info.retell) { report.push({ code, label: info.label, configured: false, note: UNSUPPORTED, checks: [] }); continue; }
      if (!cfg.agents[code]) { report.push({ code, label: info.label, configured: false, note: 'No agent configured.', checks: [] }); continue; }
      const result = await inspectAgent(code);
      report.push({ code, label: info.label, configured: true, ok: result.ok, verifiedPublic: cfg.verified.has(code), checks: result.checks });
    }
    return report;
  }

  return { config, createSession, authenticate, diagnose, cfg: { mode: cfg.mode, operatorEnabled: cfg.operatorEnabled, storeKind: quota.kind, operatorTokenTooShort: cfg.operatorTokenTooShort, sharedStoreRequired: cfg.sharedStoreRequired, transcripts: cfg.transcripts, hasPublicKey: Boolean(cfg.publicKey), maxCallMs: cfg.maxCallMs, operatorMaxMs: cfg.operatorMaxMs, agentVersion: cfg.agentVersion } };
}
