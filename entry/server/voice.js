// Voice companion backend. Private Retell credentials exist ONLY here, read from the environment, and are never
// returned to the browser or written to logs. The browser asks us for a web call; we build the Retell request
// ourselves from validated inputs, so a visitor cannot choose the agent, override agent settings, or inject prompt text.
import { buildGuidance, guidanceToText, VOICE_LANGUAGES } from '../public/voice/guidance.js';
import { catalog } from '../public/accessibility/catalog.js';

export const VOICE_CONSENT_VERSION = 'voice-consent-1';
const ROUTES = new Set(['payment_diversion', 'mailbox_compromise', 'suspicious_message', 'not_cyber', 'unsure']);
const MAX_CONFIRMED = 12;

// Retell's `language` enum (OpenAPI revision 2026-10-26, create-web-call) lists af-ZA and several English locales
// but no isiZulu or isiXhosa. Re-check https://docs.retellai.com/build/language-support.md before changing this.
export const PROVIDER_LANGUAGES = Object.freeze({
  en: { label: 'English', retell: ['en-US', 'en-GB', 'en-IN', 'en-AU', 'en-NZ'] },
  af: { label: 'Afrikaans', retell: ['af-ZA'] },
  zu: { label: 'isiZulu', retell: null },
  xh: { label: 'isiXhosa', retell: null },
});
const UNSUPPORTED = 'Retell does not list this language for speech recognition or voice. Text guidance is available; read-aloud works only if your device has a matching voice.';

export function loadVoiceConfig(env = process.env) {
  const requested = String(env.MGADI_VOICE_MODE ?? 'off').toLowerCase();
  const agents = { en: env.RETELL_AGENT_ID_EN || null, af: env.RETELL_AGENT_ID_AF || null };
  const hasKeys = Boolean(env.RETELL_API_KEY && (agents.en || agents.af));
  const mode = requested === 'mock' ? 'mock' : requested === 'retell' && hasKeys ? 'retell' : 'off';
  return {
    mode,
    misconfigured: requested === 'retell' && !hasKeys,
    apiKey: env.RETELL_API_KEY || null,
    publicKey: env.RETELL_PUBLIC_KEY || null,
    apiBase: String(env.RETELL_API_BASE || 'https://api.retellai.com').replace(/\/+$/, ''),
    agents,
    verified: new Set(String(env.MGADI_VOICE_VERIFIED_LANGUAGES ?? '').split(',').map((s) => s.trim()).filter(Boolean)),
    maxCallMs: Math.min(Math.max(Number(env.MGADI_VOICE_MAX_MINUTES) || 10, 1), 30) * 60_000,
    perClientLimit: Number(env.MGADI_VOICE_PER_CLIENT) || 3,
    perClientWindowMs: 10 * 60_000,
    perHourLimit: Number(env.MGADI_VOICE_PER_HOUR) || 20,
  };
}

export function createVoiceService({ env = process.env, fetchImpl = globalThis.fetch, playbook, now = () => Date.now() }) {
  const cfg = loadVoiceConfig(env);
  const perClient = new Map();
  let hour = { startedAt: now(), count: 0 };
  const agentChecks = new Map();

  async function checkAgent(lang) {
    const cached = agentChecks.get(lang);
    if (cached && now() - cached.at < (cached.ok ? 300_000 : 30_000)) return cached;
    let result;
    try {
      const response = await fetchImpl(`${cfg.apiBase}/get-agent/${encodeURIComponent(cfg.agents[lang])}`, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) result = { ok: false, reason: 'The agent could not be checked with Retell.' };
      else {
        const agent = await response.json();
        const language = Array.isArray(agent.language) ? (agent.language.length === 1 ? agent.language[0] : null) : agent.language ?? 'en-US';
        if (!PROVIDER_LANGUAGES[lang].retell.includes(language)) result = { ok: false, reason: `The Retell agent is set to ${String(language)}, not ${PROVIDER_LANGUAGES[lang].label}.` };
        else if (agent.data_storage_setting !== 'basic_attributes_only') result = { ok: false, reason: 'The Retell agent stores transcripts or recordings. Set its data storage to "Basic Attributes Only".' };
        else if (agent.webhook_url) result = { ok: false, reason: 'The Retell agent sends call data to a webhook. Remove it.' };
        else result = { ok: true };
      }
    } catch { result = { ok: false, reason: 'The agent could not be checked with Retell.' }; }
    result.at = now();
    agentChecks.set(lang, result);
    return result;
  }

  async function languageStatus() {
    const out = {};
    for (const [code, info] of Object.entries(PROVIDER_LANGUAGES)) {
      const base = { label: info.label, available: false, reason: '' };
      if (!info.retell) { out[code] = { ...base, reason: UNSUPPORTED }; continue; }
      if (cfg.mode === 'off') out[code] = { ...base, reason: cfg.misconfigured ? 'Voice is switched on but Retell credentials or an agent ID are missing.' : 'Voice is not set up on this server.' };
      else if (cfg.mode === 'mock') out[code] = code === 'en' ? { ...base, available: true, reason: 'Simulated conversation (no real AI).' } : { ...base, reason: 'The simulation covers English only.' };
      else if (!cfg.agents[code]) out[code] = { ...base, reason: `No ${info.label} voice agent is configured.` };
      else if (!cfg.verified.has(code)) out[code] = { ...base, reason: `Configured, but not yet verified with ${info.label} speakers.` };
      else { const check = await checkAgent(code); out[code] = check.ok ? { ...base, available: true } : { ...base, reason: check.reason }; }
    }
    return out;
  }

  async function config() {
    return {
      status: 200,
      body: {
        mode: cfg.mode, simulated: cfg.mode === 'mock', consentVersion: VOICE_CONSENT_VERSION, maxCallMs: cfg.maxCallMs,
        languages: await languageStatus(),
        // A Retell *public* key is designed for browsers and is restricted to allowed domains. It is used only for
        // the live-transcript socket. The private key never leaves this server.
        captions: cfg.mode === 'mock' || Boolean(cfg.publicKey),
        publicKey: cfg.mode === 'retell' ? cfg.publicKey : null,
      },
    };
  }

  function allow(clientId) {
    const t = now();
    if (t - hour.startedAt >= 3_600_000) hour = { startedAt: t, count: 0 };
    if (hour.count >= cfg.perHourLimit) return false;
    const entry = perClient.get(clientId);
    if (!entry || t - entry.startedAt >= cfg.perClientWindowMs) perClient.set(clientId, { startedAt: t, count: 1 });
    else if (entry.count >= cfg.perClientLimit) return false;
    else entry.count += 1;
    hour.count += 1;
    if (perClient.size > 2000) perClient.clear();
    return true;
  }

  // `payload` is what the browser SDK posts. Only payload.metadata.mgadi is read; everything else is ignored.
  async function createSession({ payload, consent, clientId }) {
    if (cfg.mode !== 'retell') return { status: 409, body: { error: 'voice_unavailable' } };
    if (consent !== VOICE_CONSENT_VERSION) return { status: 403, body: { error: 'consent_required' } };
    const ask = payload?.metadata?.mgadi;
    const lang = ask?.language;
    if (!ask || !Object.hasOwn(VOICE_LANGUAGES, lang) || !ROUTES.has(ask.route)) return { status: 400, body: { error: 'bad_request' } };
    const confirmed = Array.isArray(ask.confirmed) ? ask.confirmed.filter((id) => typeof id === 'string' && /^[a-z_]{1,24}$/.test(id)).slice(0, MAX_CONFIRMED) : [];
    const stepId = typeof ask.stepId === 'string' && /^[a-z_]{1,24}$/.test(ask.stepId) ? ask.stepId : null;
    const languages = await languageStatus();
    if (!languages[lang]?.available) return { status: 409, body: { error: 'language_unavailable' } };
    const guidance = buildGuidance({ playbook, route: ask.route, stepId, confirmed, lang, catalog });
    if (!guidance) return { status: 400, body: { error: 'bad_request' } };
    if (!guidance.complete) return { status: 409, body: { error: 'guidance_not_translated' } };
    if (!allow(clientId)) return { status: 429, body: { error: 'rate_limited' } };

    const body = {
      agent_id: cfg.agents[lang],
      metadata: { app: 'mgadi' }, // deliberately no incident, user or transcript data
      retell_llm_dynamic_variables: {
        app_language: VOICE_LANGUAGES[lang],
        incident_title: guidance.title,
        current_step: `${guidance.current.title}. ${guidance.current.why} ${guidance.current.do.join(' ')}`,
        reviewed_guidance: guidanceToText(guidance),
        guidance_status: guidance.reviewed ? 'reviewed' : 'DRAFT: not yet reviewed by a qualified practitioner. Say so if asked.',
      },
      // Enforced on every call, whatever the agent's saved settings are.
      agent_override: { agent: { data_storage_setting: 'basic_attributes_only', max_call_duration_ms: cfg.maxCallMs, end_call_after_silence_ms: 60_000, webhook_url: null } },
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
    // Pass on only the fields the browser needs to join the call.
    return { status: 201, body: { call_id: data.call_id, access_token: data.access_token, transport: data.transport, ice_servers: data.ice_servers, expires_at: data.expires_at } };
  }

  return { config, createSession, cfg: { mode: cfg.mode } };
}
