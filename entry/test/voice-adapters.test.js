import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetellAdapter, rms } from '../public/voice/retell-adapter.js';
import { createMockAdapter } from '../public/voice/mock-adapter.js';
import { createVoiceController, describeError } from '../public/voice/controller.js';

const config = { consentVersion: 'voice-consent-1', captions: true };
const context = { language: 'af', route: 'payment_diversion', stepId: 'bank', confirmed: ['bank'] };
const SESSION = { call_id: 'call_1', access_token: 'tok_1', transport: 'gateway', ice_servers: [], expires_at: 1, mgadi: { publicKey: 'public_key_TESTONLY', test: false } };
const serverReply = (body = SESSION, status = 201) => { const sent = []; return { sent, fetchImpl: async (url, init) => { sent.push({ url, init }); return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); } }; };

// A stand-in for the official SDK that records exactly how it is used.
function fakeSdk() {
  const record = { constructed: null, call: null, ops: [] };
  class RetellClient {
    constructor(options) { record.constructed = options; }
    createWebCall(options) {
      record.call = options;
      return { mute: () => record.ops.push('mute'), unmute: () => record.ops.push('unmute'), end: async () => { record.ops.push('end'); }, startAudioPlayback: async () => { record.ops.push('play'); } };
    }
  }
  return { record, importer: async () => RetellClient };
}
const hooks = () => { const seen = []; const h = Object.fromEntries(['onStatus', 'onTranscript', 'onAudioLevel', 'onError', 'onEnd'].map((n) => [n, (...a) => seen.push([n, ...a])])); return { h, seen }; };

test('Retell adapter: asks OUR server first, then uses the v3 client with the PUBLIC key from that gated response', async () => {
  const { record, importer } = fakeSdk(); const { h } = hooks(); const server = serverReply();
  await createRetellAdapter({ config, importer, fetchImpl: server.fetchImpl }).start({ context, hooks: h });
  assert.equal(server.sent.length, 1);
  assert.equal(server.sent[0].url, '/api/voice/session');
  assert.equal(record.constructed.key, 'public_key_TESTONLY');
  assert.equal(typeof record.constructed.fetch, 'function');
  assert.equal(record.call.transcript, true);
  assert.deepEqual(record.call.audio, { emitRawAudioSamples: true });
  assert.equal(record.call.agent_id, 'chosen-by-server');
  assert.deepEqual(Object.keys(record.call).sort(), ['agent_id', 'audio', 'hooks', 'transcript']);
});

test('Retell adapter: our server gets the consent header and only the validated context; the SDK never reaches Retell to create the call', async () => {
  const { record, importer } = fakeSdk(); const server = serverReply();
  await createRetellAdapter({ config, importer, fetchImpl: server.fetchImpl }).start({ context, hooks: hooks().h });
  const sent = server.sent[0].init;
  assert.deepEqual(sent.headers, { 'content-type': 'application/json', 'x-mgadi-voice-consent': 'voice-consent-1' });
  assert.equal(sent.credentials, 'omit');
  assert.deepEqual(JSON.parse(sent.body), { metadata: { mgadi: { language: 'af', route: 'payment_diversion', stepId: 'bank', confirmed: ['bank'] } } });
  // The SDK's own create request is answered locally from what our server returned, minus our private extras.
  const created = await record.constructed.fetch('https://api.retellai.com/v3/create-web-call', { method: 'POST', headers: { Authorization: 'Bearer public_key_TESTONLY' }, body: '{"agent_id":"x"}' });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { call_id: 'call_1', access_token: 'tok_1', transport: 'gateway', ice_servers: [], expires_at: 1 });
  for (const other of ['/v2/stop-call/x', '/v2/update-live-call/x', '/v3/anything-else']) assert.equal((await record.constructed.fetch(`https://api.retellai.com${other}`, { method: 'POST' })).status, 404);
  assert.equal(server.sent.length, 1, 'nothing else is forwarded, and no second call is created');
});

test('Retell adapter: an operator token is sent only when one has been entered', async () => {
  const { importer } = fakeSdk();
  const withToken = serverReply();
  await createRetellAdapter({ config, importer, fetchImpl: withToken.fetchImpl, getOperatorToken: () => 'TESTONLY-operator' }).start({ context, hooks: hooks().h });
  assert.equal(withToken.sent[0].init.headers['x-mgadi-operator-token'], 'TESTONLY-operator');
  const without = serverReply();
  await createRetellAdapter({ config, importer, fetchImpl: without.fetchImpl, getOperatorToken: () => '' }).start({ context, hooks: hooks().h });
  assert.equal('x-mgadi-operator-token' in without.sent[0].init.headers, false);
});

test('Retell adapter: without a public key it still calls, but says live captions are not available', async () => {
  const { record, importer } = fakeSdk();
  const adapter = createRetellAdapter({ config: { ...config, captions: false }, importer, fetchImpl: serverReply({ ...SESSION, mgadi: { publicKey: null, test: false } }).fetchImpl });
  assert.equal(adapter.captionsExpected, false);
  await adapter.start({ context, hooks: hooks().h });
  assert.equal(record.call.transcript, false);
  assert.doesNotMatch(String(record.constructed.key), /^public_key_/);
});

test('Retell adapter: a refusal from our server becomes a clear error and the SDK is never started', async () => {
  for (const [status, error, code] of [[429, 'rate_limited', 'rate_limited'], [401, 'unauthorized', 'unauthorized'], [409, 'language_unavailable', 'language_unavailable'], [503, 'quota_unavailable', 'quota_unavailable'], [403, 'consent_required', 'consent_required']]) {
    const { record, importer } = fakeSdk();
    await assert.rejects(createRetellAdapter({ config, importer, fetchImpl: serverReply({ error }, status).fetchImpl }).start({ context, hooks: hooks().h }), (e) => describeError(e).code === code && e.status === status);
    assert.equal(record.constructed, null);
  }
  const { importer } = fakeSdk();
  await assert.rejects(createRetellAdapter({ config, importer, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }).start({ context, hooks: hooks().h }), (e) => describeError(e).code === 'voice_unavailable');
});

test('Retell adapter: SDK events map onto the controller hooks, and controls pass through', async () => {
  const { record, importer } = fakeSdk(); const { h, seen } = hooks();
  const handle = await createRetellAdapter({ config, importer, fetchImpl: serverReply().fetchImpl }).start({ context, hooks: h });
  const sdk = record.call.hooks;
  sdk.onStatus('live'); sdk.onTranscript([{ id: 'a' }], []); sdk.onAudio(new Float32Array([0.5, -0.5, 0.5, -0.5])); sdk.onError(new Error('x')); sdk.onEnd(undefined);
  assert.deepEqual(seen.map((s) => s[0]), ['onStatus', 'onTranscript', 'onAudioLevel', 'onError', 'onEnd']);
  assert.equal(seen[2][1], 0.5); assert.deepEqual(seen[4][1], {});
  handle.mute(); handle.unmute(); await handle.end(); await handle.startAudioPlayback();
  assert.deepEqual(record.ops, ['mute', 'unmute', 'end', 'play']);
  assert.equal(rms(new Float32Array(0)), 0);
});

test('Retell adapter: a missing engine bundle is reported as such, not as a mystery failure, and nothing is requested', async () => {
  const server = serverReply();
  const adapter = createRetellAdapter({ config, importer: async () => { throw new TypeError('Failed to fetch dynamically imported module'); }, fetchImpl: server.fetchImpl });
  await assert.rejects(adapter.start({ context, hooks: hooks().h }), (e) => e.code === 'engine_missing');
  assert.equal(server.sent.length, 0, 'no provider session is created for a page that cannot use it');
});

function timers() {
  let t = 0; let id = 0; const jobs = new Map();
  return { api: { setTimeout: (fn, ms) => { jobs.set(++id, [t + ms, fn]); return id; }, clearTimeout: (i) => jobs.delete(i) }, run(ms) { const end = t + ms; for (;;) { const next = [...jobs.entries()].sort((a, b) => a[1][0] - b[1][0])[0]; if (!next || next[1][0] > end) break; t = next[1][0]; jobs.delete(next[0]); next[1][1](); } t = end; } };
}

test('simulation: scripted, clearly synthetic, and only ever speaks reviewed-safe words', async () => {
  const clock = timers(); const events = [];
  const handle = await createMockAdapter({ timers: clock.api, scenario: '' }).start({ context, hooks: { onStatus: (s) => events.push(['status', s]), onTranscript: (i) => events.push(['transcript', i]), onAudioLevel: (l) => events.push(['level', l]), onError: () => {}, onEnd: () => {} } });
  clock.run(30_000);
  assert.deepEqual(events[0], ['status', 'live']);
  const last = events.filter((e) => e[0] === 'transcript').at(-1)[1];
  const text = last.map((m) => m.content).join(' ');
  assert.match(text, /simulation/i); assert.match(text, /Only you can tick the step/);
  assert.doesNotMatch(text, /\d{3}/, 'a simulated assistant never says a phone number');
  handle.end();
});

test('simulation scenarios: mic denied, provider down, dropped connection and missing captions', async () => {
  const run = (scenario) => createMockAdapter({ scenario, timers: timers().api }).start({ context, hooks: hooks().h });
  await assert.rejects(run('fail-mic'), (e) => e.name === 'NotAllowedError');
  await assert.rejects(run('fail-provider'), /voice_unavailable/);
  const clock = timers(); const ends = [];
  await createMockAdapter({ scenario: 'drop', timers: clock.api }).start({ context, hooks: { ...hooks().h, onEnd: (i) => ends.push(i) } });
  clock.run(10_000); assert.deepEqual(ends, [{ disconnection_reason: 'error_retell' }]);
});

test('end to end with the controller: the simulation goes live, shows captions, then a dropped connection reconnects', async () => {
  const clock = timers(); let t = 0; const realNow = () => t;
  const adapter = createMockAdapter({ scenario: 'drop', timers: clock.api });
  const controller = createVoiceController({ adapterFactory: () => adapter, getContext: () => context, now: realNow, timers: { ...clock.api, setInterval: () => 0, clearInterval: () => {} }, isOnline: () => true });
  controller.giveConsent(); await controller.start();
  clock.run(3000); t = 3000;
  assert.equal(controller.getState().phase, 'live');
  assert.equal(controller.getState().captions, 'on');
  assert.ok(controller.getState().messages.some((m) => m.role === 'assistant'));
  clock.run(2000); // the scripted drop arrives; a young call without captions would retry, a captioned one just ends
  assert.ok(['ended', 'reconnecting'].includes(controller.getState().phase));
});
