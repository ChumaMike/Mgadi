import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { createVoiceService, loadVoiceConfig, VOICE_CONSENT_VERSION } from '../server/voice.js';
import { createMemoryStore, createRestStore, consumeAll, hashId } from '../server/quota.js';

const playbook = JSON.parse(fs.readFileSync(new URL('../public/data/playbook.json', import.meta.url), 'utf8'));
const SECRET = 'key_TESTONLY_not_a_real_secret_1234567890';
const PUBLIC = 'public_key_TESTONLY_abcdef';
const TOKEN = 'operator-TESTONLY-token-0123456789abcdef';
// NOTE: the languages are configured but NOT verified. That is exactly the state in which a real test is needed.
const baseEnv = { MGADI_VOICE_MODE: 'retell', RETELL_API_KEY: SECRET, RETELL_PUBLIC_KEY: PUBLIC, RETELL_AGENT_ID_EN: 'agent_en', RETELL_AGENT_ID_AF: 'agent_af', MGADI_OPERATOR_TOKEN: TOKEN };
const goodAgent = { language: 'en-US', data_storage_setting: 'basic_attributes_only', webhook_url: null };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function fakeRetell(agents) {
  const calls = [];
  return { calls, fetchImpl: async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    const m = String(url).match(/\/get-agent\/([^?]+)/);
    if (m) { const a = agents[decodeURIComponent(m[1])]; return a ? json(a) : json({}, 404); }
    if (String(url).endsWith('/v3/create-web-call')) return json({ call_id: 'call_1', access_token: 'tok', transport: 'gateway', ice_servers: [], expires_at: 1 }, 201);
    return json({}, 404);
  } };
}
const ask = (extra = {}) => ({ metadata: { mgadi: { language: 'en', route: 'payment_diversion', stepId: 'bank', confirmed: [], ...extra } } });
const OP = { access: 'operator' };
const make = (env = {}, retell = fakeRetell({ agent_en: goodAgent, agent_af: { ...goodAgent, language: 'af-ZA' } }), extra = {}) =>
  ({ retell, voice: createVoiceService({ env: { ...baseEnv, ...env }, fetchImpl: retell.fetchImpl, playbook, ...extra }) });
const go = (voice, auth, id = 'c1', body = ask()) => voice.createSession({ payload: body, consent: VOICE_CONSENT_VERSION, clientId: id, auth });

test('operator testing is off unless a long random token is set, and is refused on production by default', () => {
  assert.equal(loadVoiceConfig({ ...baseEnv, MGADI_OPERATOR_TOKEN: '' }).operatorEnabled, false);
  assert.equal(loadVoiceConfig({ ...baseEnv, MGADI_OPERATOR_TOKEN: 'short' }).operatorEnabled, false);
  assert.equal(loadVoiceConfig({ ...baseEnv, MGADI_OPERATOR_TOKEN: 'short' }).operatorTokenTooShort, true);
  assert.equal(loadVoiceConfig(baseEnv).operatorEnabled, true);
  assert.equal(loadVoiceConfig({ ...baseEnv, VERCEL_ENV: 'production' }).operatorEnabled, false, 'a production deployment never accepts operator tests by default');
  assert.equal(loadVoiceConfig({ ...baseEnv, VERCEL_ENV: 'production', MGADI_OPERATOR_ALLOW_PRODUCTION: 'yes' }).operatorEnabled, true);
  assert.equal(loadVoiceConfig({ ...baseEnv, VERCEL_ENV: 'preview' }).operatorEnabled, true);
});

test('the circular dependency is broken: an operator can test a configured, unverified language; the public cannot', async () => {
  const { voice, retell } = make();
  const publicView = await voice.config({ access: 'public' });
  assert.equal(publicView.body.languages.en.available, false);
  assert.match(publicView.body.languages.en.reason, /not yet verified/);
  assert.equal((await go(voice, { access: 'public' })).status, 409, 'public cannot start an unverified language');
  assert.equal(retell.calls.filter((c) => c.url.endsWith('create-web-call')).length, 0);
  const opView = await voice.config(OP);
  assert.equal(opView.body.access, 'operator');
  assert.equal(opView.body.languages.en.available, true);
  assert.equal(opView.body.languages.en.testOnly, true, 'flagged as a test, not as verified');
  assert.equal((await go(voice, OP)).status, 201);
});

test('operator testing never makes a language publicly verified', async () => {
  const { voice } = make();
  await go(voice, OP); await go(voice, OP, 'c2');
  assert.equal((await voice.config({ access: 'public' })).body.languages.en.available, false);
  assert.equal((await go(voice, { access: 'public' }, 'someone')).status, 409);
});

test('operator access does not bypass the privacy check, the provider language list, or the translation check', async () => {
  const storing = make({}, fakeRetell({ agent_en: { ...goodAgent, data_storage_setting: 'everything' } }));
  assert.equal((await storing.voice.config(OP)).body.languages.en.available, false);
  assert.equal((await go(storing.voice, OP)).status, 409);
  const hooked = make({}, fakeRetell({ agent_en: { ...goodAgent, webhook_url: 'https://example.test/h' } }));
  assert.equal((await go(hooked.voice, OP)).status, 409);
  const zu = make({ RETELL_AGENT_ID_ZU: 'agent_zu' });
  assert.equal((await zu.voice.config(OP)).body.languages.zu.available, false);
  assert.equal((await go(zu.voice, OP, 'c', ask({ language: 'zu' }))).status, 400);
  const af = make();
  assert.deepEqual((await go(af.voice, OP, 'c', ask({ language: 'af' }))).body, { error: 'guidance_not_translated' }, 'Afrikaans stays blocked while the guide is not fully translated');
});

test('a wrong or guessed token gets nothing and reveals nothing; guessing is rate limited', async () => {
  const { voice } = make();
  const none = await voice.authenticate(undefined, 'x');
  assert.deepEqual(none, { access: 'public' });
  const wrong = await voice.authenticate('x'.repeat(40), 'x');
  assert.equal(wrong.access, 'public'); assert.equal(wrong.rejected, true);
  assert.equal((await go(voice, wrong)).status, 401);
  assert.deepEqual((await voice.config(wrong.rejected ? { access: 'public' } : wrong)).body, (await voice.config({ access: 'public' })).body, 'a wrong token looks exactly like no token');
  assert.equal((await voice.authenticate(TOKEN, 'x')).access, 'operator');
  for (let i = 0; i < 10; i += 1) await voice.authenticate('guess', 'y');
  const locked = await voice.authenticate(TOKEN, 'y');
  assert.equal(locked.access, 'public'); assert.equal(locked.limited, true, 'after 10 attempts even the right token is refused for a while');
  assert.equal((await go(voice, locked)).status, 429);
  assert.equal((await voice.authenticate(TOKEN, 'someone-else')).access, 'operator', 'the lockout is per visitor');
});

test('a server without operator testing ignores any token, even a correct-looking one', async () => {
  const { voice } = make({ MGADI_OPERATOR_TOKEN: '' });
  const auth = await voice.authenticate('anything', 'z');
  assert.equal(auth.access, 'public');
  assert.equal((await go(voice, auth)).status, 401);
  assert.equal((await voice.config({ access: 'public' })).body.operatorAvailable, false);
});

test('operator calls are short, capped per day, labelled, and do not use the public allowance', async () => {
  const { voice, retell } = make({ MGADI_OPERATOR_MAX_SESSIONS_PER_DAY: '2', MGADI_VOICE_PER_CLIENT: '1' });
  assert.equal((await go(voice, OP)).status, 201);
  const upstream = retell.calls.find((c) => c.url.endsWith('create-web-call')).body;
  assert.equal(upstream.agent_override.agent.max_call_duration_ms, 180_000, 'default 3 minute cap');
  assert.equal(upstream.agent_override.agent.end_call_after_silence_ms, 30_000);
  assert.equal(upstream.agent_override.agent.data_storage_setting, 'basic_attributes_only');
  assert.equal(upstream.agent_override.agent.webhook_url, null);
  assert.deepEqual(upstream.metadata, { app: 'mgadi', test: 'operator' });
  assert.equal((await go(voice, OP, 'c2')).status, 201);
  assert.equal((await go(voice, OP, 'c3')).status, 429, 'daily operator cap, whoever asks');
  assert.equal((await voice.config(OP)).body.maxCallMs, 180_000);
});

test('the operator token and a browser-style flag are not the same thing: query strings and body fields do nothing', async (t) => {
  const retell = fakeRetell({ agent_en: goodAgent });
  const app = createApp({ env: { ...baseEnv }, fetchImpl: retell.fetchImpl }); app.listen(0, '127.0.0.1'); await once(app, 'listening'); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = (url, headers = {}, body = ask()) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mgadi-voice-consent': VOICE_CONSENT_VERSION, ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/api/voice/session?operator=1&test=true')).status, 409);
  assert.equal((await post('/api/voice/session', {}, { ...ask(), operator: true, access: 'operator', token: TOKEN })).status, 409);
  const cfg = await (await fetch(`${base}/api/voice/config?operator=1&access=operator`)).json();
  assert.equal(cfg.access, 'public'); assert.equal(cfg.languages.en.available, false);
  assert.equal((await post('/api/voice/session', { 'x-mgadi-operator-token': 'wrong' })).status, 401);
  const ok = await post('/api/voice/session', { 'x-mgadi-operator-token': TOKEN });
  assert.equal(ok.status, 201);
  assert.equal((await post('/api/voice/session', { 'x-mgadi-operator-token': TOKEN, 'x-mgadi-voice-consent': 'no' })).status, 403, 'consent is still required for operators');
  const cfgOp = await (await fetch(`${base}/api/voice/config`, { headers: { 'x-mgadi-operator-token': TOKEN } })).json();
  assert.equal(cfgOp.access, 'operator'); assert.equal(cfgOp.languages.en.available, true);
  assert.doesNotMatch(JSON.stringify(cfgOp), new RegExp(`${TOKEN}|${SECRET}|${PUBLIC}`));
});

test('HTTP: other websites, other sites on the same domain, and preflight requests are refused', async (t) => {
  const app = createApp({ env: { ...baseEnv, MGADI_VOICE_VERIFIED_LANGUAGES: 'en' }, fetchImpl: fakeRetell({ agent_en: goodAgent }).fetchImpl }); app.listen(0, '127.0.0.1'); await once(app, 'listening'); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = (headers) => fetch(`${base}/api/voice/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mgadi-voice-consent': VOICE_CONSENT_VERSION, ...headers }, body: JSON.stringify(ask()) });
  assert.equal((await post({ origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ 'sec-fetch-site': 'same-site' })).status, 403);
  assert.equal((await post({ 'sec-fetch-site': 'cross-site', 'x-mgadi-operator-token': TOKEN })).status, 403, 'a stolen token still cannot be used from another website');
  assert.equal((await post({ origin: base, 'sec-fetch-site': 'same-origin' })).status, 201);
  const preflight = await fetch(`${base}/api/voice/session`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-mgadi-voice-consent' } });
  assert.equal(preflight.status, 405);
  assert.equal(preflight.headers.get('access-control-allow-origin'), null, 'no CORS grant is ever made');
});

test('public sessions are refused on Vercel without a shared quota store, and fail closed if the store breaks', async () => {
  const verified = { MGADI_VOICE_VERIFIED_LANGUAGES: 'en', VERCEL: '1' };
  const mem = make(verified);
  assert.deepEqual((await go(mem.voice, { access: 'public' })).body, { error: 'quota_unavailable' });
  assert.equal(mem.retell.calls.filter((c) => c.url.endsWith('create-web-call')).length, 0, 'no provider call, so no spend');
  const sent = [];
  const rest = createRestStore({ url: 'https://quota.example.test', token: 'TESTONLY', fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => [{ result: 'OK' }, { result: 1 }] }; } });
  const { voice, retell } = make(verified, undefined, { store: rest });
  assert.equal((await go(voice, { access: 'public' }, '203.0.113.9')).status, 201);
  assert.equal(retell.calls.filter((c) => c.url.endsWith('create-web-call')).length, 1);
  assert.ok(sent.length >= 4, 'daily minutes, daily sessions, hourly and per-visitor counters');
  assert.doesNotMatch(JSON.stringify(sent), /203\.0\.113\.9/, 'no raw visitor address is stored in the shared store');
  const broken = createRestStore({ url: 'https://quota.example.test', token: 'TESTONLY', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  const failing = make(verified, undefined, { store: broken });
  assert.equal((await go(failing.voice, { access: 'public' })).status, 503);
  assert.equal(failing.retell.calls.filter((c) => c.url.endsWith('create-web-call')).length, 0, 'a broken quota store means no chargeable call');
});

test('daily session and spend (minutes) budgets stop public calls', async () => {
  const minutes = make({ MGADI_VOICE_VERIFIED_LANGUAGES: 'en', MGADI_VOICE_DAILY_MINUTES: '15', MGADI_VOICE_PER_CLIENT: '10', MGADI_VOICE_PER_HOUR: '50' });
  assert.equal((await go(minutes.voice, { access: 'public' }, 'a')).status, 201, 'first 10-minute call fits in a 15-minute day');
  assert.equal((await go(minutes.voice, { access: 'public' }, 'b')).status, 429, 'a second 10-minute call would exceed the daily minutes');
  const sessions = make({ MGADI_VOICE_VERIFIED_LANGUAGES: 'en', MGADI_VOICE_DAILY_SESSIONS: '2', MGADI_VOICE_PER_CLIENT: '10', MGADI_VOICE_PER_HOUR: '50', MGADI_VOICE_DAILY_MINUTES: '1000' });
  assert.equal((await go(sessions.voice, { access: 'public' }, 'a')).status, 201);
  assert.equal((await go(sessions.voice, { access: 'public' }, 'b')).status, 201);
  assert.equal((await go(sessions.voice, { access: 'public' }, 'c')).status, 429);
});

test('the agent version is pinned for both the privacy check and the call', async () => {
  const { voice, retell } = make({ RETELL_AGENT_VERSION: '3' });
  assert.equal((await go(voice, OP)).status, 201);
  assert.match(retell.calls.find((c) => c.url.includes('/get-agent/')).url, /\/get-agent\/agent_en\?version=3$/);
  assert.equal(retell.calls.find((c) => c.url.endsWith('create-web-call')).body.agent_version, 3);
  const unpinned = make();
  await go(unpinned.voice, OP);
  assert.equal('agent_version' in unpinned.retell.calls.find((c) => c.url.endsWith('create-web-call')).body, false);
});

test('the preflight report lists each check, warns about what only the dashboard can confirm, and holds no keys', async () => {
  const { voice } = make();
  const report = await voice.diagnose();
  const en = report.find((r) => r.code === 'en');
  assert.equal(en.ok, true); assert.equal(en.verifiedPublic, false);
  assert.deepEqual(en.checks.map((c) => c.name), ['agent reachable', 'language', 'data storage', 'agent webhook', 'retention period']);
  assert.match(en.checks.find((c) => c.name === 'agent webhook').detail, /ACCOUNT-level webhook/);
  assert.equal(en.checks.find((c) => c.name === 'retention period').warn, true);
  assert.match(report.find((r) => r.code === 'zu').note, /does not list/);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(`${SECRET}|${PUBLIC}|${TOKEN}`));
});

test('quota store: claims are all-or-nothing and keys never contain a raw address', async () => {
  const store = createMemoryStore();
  const claims = [{ key: 'a', amount: 1, limit: 2, ttlMs: 1000 }, { key: 'b', amount: 1, limit: 1, ttlMs: 1000 }];
  assert.equal((await consumeAll(store, claims)).ok, true);
  assert.equal((await consumeAll(store, claims)).ok, false, 'b is full');
  assert.equal(await store.incrBy('a', 0, 1000), 1, 'a was rolled back after the refused attempt');
  assert.notEqual(hashId('203.0.113.9'), '203.0.113.9');
  assert.equal(hashId('203.0.113.9'), hashId('203.0.113.9'));
  const rest = createRestStore({ url: 'https://q.test', token: 'T', fetchImpl: async (url, init) => { assert.equal(url, 'https://q.test/pipeline'); assert.equal(init.headers.Authorization, 'Bearer T'); assert.deepEqual(JSON.parse(init.body), [['SET', 'k', '0', 'EX', '60', 'NX'], ['INCRBY', 'k', '3']]); return { ok: true, json: async () => [{ result: 'OK' }, { result: 3 }] }; } });
  assert.equal(await rest.incrBy('k', 3, 60_000), 3);
  const bad = createRestStore({ url: 'https://q.test', token: 'T', fetchImpl: async () => ({ ok: true, json: async () => [{ result: 'OK' }, { error: 'WRONGTYPE' }] }) });
  await assert.rejects(bad.incrBy('k', 1, 1000));
});
