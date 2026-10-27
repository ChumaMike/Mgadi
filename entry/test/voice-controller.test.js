import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceController, describeError, timelineTextFor, FAILURE_COPY } from '../public/voice/controller.js';

function clock() {
  let t = 1_000_000; let id = 0; const jobs = new Map();
  const timers = {
    setTimeout: (fn, ms) => { jobs.set(++id, { fn, at: t + ms, every: null }); return id; },
    setInterval: (fn, ms) => { jobs.set(++id, { fn, at: t + ms, every: ms }); return id; },
    clearTimeout: (i) => jobs.delete(i), clearInterval: (i) => jobs.delete(i),
  };
  const advance = (ms) => { const end = t + ms; for (;;) { const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; const [i, j] = due; t = j.at; if (j.every) j.at += j.every; else jobs.delete(i); j.fn(); } t = end; };
  return { now: () => t, timers, advance };
}

// A provider stand-in: tests push events through the same hooks the real adapter uses.
function fakeProvider({ captionsExpected = true, startError = null } = {}) {
  const sessions = [];
  const factory = () => ({
    captionsExpected,
    start: async (request) => {
      if (startError) throw startError;
      const session = { request, ended: 0, muted: 0, unmuted: 0 };
      session.handle = { end: () => { session.ended += 1; }, mute: () => { session.muted += 1; }, unmute: () => { session.unmuted += 1; } };
      sessions.push(session);
      return session.handle;
    },
  });
  return { factory, sessions, last: () => sessions[sessions.length - 1] };
}
const ctx = (language = 'en') => ({ language, route: 'payment_diversion', stepId: 'bank', confirmed: [] });
function setup(options = {}) {
  const c = clock(); const provider = fakeProvider(options.provider); const events = [];
  const controller = createVoiceController({ adapterFactory: provider.factory, getContext: () => ctx(options.language), config: { maxCallMs: options.maxCallMs }, now: c.now, timers: c.timers, isOnline: () => options.online ?? true, onEvent: (e) => events.push(e) });
  return { c, provider, events, controller };
}
const goLive = async (s) => { s.controller.giveConsent(); await s.controller.start(); s.provider.last().request.hooks.onStatus('live'); return s.provider.last().request.hooks; };
const types = (s) => s.events.map((e) => e.type);

test('without consent nothing starts and no provider is contacted', async () => {
  const s = setup(); await s.controller.start();
  assert.equal(s.controller.getState().phase, 'idle'); assert.equal(s.provider.sessions.length, 0);
});

test('phases: connecting -> live (listening) -> ended by the user, with the right provider calls', async () => {
  const s = setup(); s.controller.giveConsent();
  const phases = []; s.controller.subscribe((st) => phases.push(st.phase));
  await s.controller.start();
  assert.equal(s.controller.getState().phase, 'connecting');
  assert.deepEqual(s.provider.last().request.context, ctx());
  s.provider.last().request.hooks.onStatus('live');
  assert.deepEqual([s.controller.getState().phase, s.controller.getState().activity], ['live', 'listening']);
  s.controller.end();
  assert.equal(s.controller.getState().phase, 'ended'); assert.equal(s.provider.last().ended, 1);
  assert.ok(phases.includes('connecting') && phases.includes('live') && phases.includes('ended'));
  assert.deepEqual(types(s), ['voice-started', 'voice-ended']);
  s.controller.end(); assert.equal(s.provider.last().ended, 1, 'ending twice is harmless');
});

test('transcript: partial turns are replaced by id, roles are mapped, other item kinds are ignored', async () => {
  const s = setup(); const hooks = await goLive(s);
  hooks.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Hello, I am', time_sec: 0.5 }]);
  hooks.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Hello, I am the Mgadi assistant.', time_sec: 0.5 }, { id: 'user_0', role: 'user', content: '(unintelligible audio)', time_sec: 4 }, { id: 'tool_call_invocation_0', role: 'tool_call_invocation', name: 'x' }]);
  const chat = s.controller.getState().messages.filter((m) => m.role !== 'system');
  assert.deepEqual(chat.map((m) => [m.role, m.text]), [['assistant', 'Hello, I am the Mgadi assistant.'], ['user', '(could not understand the audio)']]);
  assert.equal(s.controller.getState().captions, 'on');
});

test('a message is announced to screen readers only once it is finished (superseded or the call ended)', async () => {
  const s = setup(); const hooks = await goLive(s);
  hooks.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Hel' }]);
  hooks.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Hello there' }]);
  assert.equal(s.events.filter((e) => e.type === 'message-final').length, 0);
  hooks.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Hello there' }, { id: 'user_0', role: 'user', content: 'Hi' }]);
  assert.deepEqual(s.events.filter((e) => e.type === 'message-final').map((e) => e.message.text), ['Hello there']);
  s.controller.end();
  assert.deepEqual(s.events.filter((e) => e.type === 'message-final').map((e) => e.message.text), ['Hello there', 'Hi']);
});

test('who is speaking: assistant audio, assistant text, then you, otherwise listening; muted means you are never "speaking"', async () => {
  const s = setup(); const hooks = await goLive(s);
  const activity = () => s.controller.getState().activity;
  s.c.advance(250); assert.equal(activity(), 'listening');
  hooks.onAudioLevel(0.2); s.c.advance(200); assert.equal(activity(), 'speaking');
  s.c.advance(800); assert.equal(activity(), 'listening', 'audio hold expires');
  hooks.onAudioLevel(0.001); s.c.advance(200); assert.equal(activity(), 'listening', 'background hiss is not speech');
  hooks.onTranscript([{ id: 'user_0', role: 'user', content: 'I paid the wrong account' }]); s.c.advance(200);
  assert.equal(activity(), 'you-speaking');
  s.c.advance(1500);
  hooks.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Please call your bank' }]); s.c.advance(200);
  assert.equal(activity(), 'speaking');
  s.c.advance(2000); s.controller.mute();
  hooks.onTranscript([{ id: 'user_0', role: 'user', content: 'I paid the wrong account now' }]); s.c.advance(200);
  assert.equal(activity(), 'listening');
});

test('mute and unmute reach the provider only while live, and are reported without any content', async () => {
  const s = setup(); s.controller.mute(); assert.equal(s.controller.getState().muted, false);
  await goLive(s);
  s.controller.mute(); s.controller.mute(); s.controller.unmute();
  assert.deepEqual([s.provider.last().muted, s.provider.last().unmuted, s.controller.getState().muted], [1, 1, false]);
  assert.deepEqual(types(s), ['voice-started', 'voice-muted', 'voice-unmuted']);
});

test('captions: honest when the transcript stream silently fails, and when the adapter never offers one', async () => {
  const s = setup(); const hooks = await goLive(s);
  s.c.advance(1000); assert.equal(s.controller.getState().captions, 'unknown');
  for (let i = 0; i < 40; i += 1) { hooks.onAudioLevel(0.3); s.c.advance(250); }
  assert.equal(s.controller.getState().captions, 'unavailable');
  const withCaptions = setup(); const h2 = await goLive(withCaptions);
  h2.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Hi' }]);
  for (let i = 0; i < 40; i += 1) { h2.onAudioLevel(0.3); withCaptions.c.advance(250); }
  assert.equal(withCaptions.controller.getState().captions, 'on');
  const none = setup({ provider: { captionsExpected: false } }); none.controller.giveConsent(); await none.controller.start();
  assert.equal(none.controller.getState().captions, 'unavailable');
});

test('failures: each reason has plain wording and always points back to the bank fraud line', async () => {
  const cases = [[Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }), 'mic_denied'], [Object.assign(new Error('x'), { name: 'NotFoundError' }), 'no_mic'], [new Error('rate_limited'), 'rate_limited'], [new Error('guidance_not_translated'), 'guidance_not_translated'], [new Error('voice_unavailable'), 'voice_unavailable'], [new Error('???'), 'unknown']];
  for (const [error, code] of cases) {
    const s = setup({ provider: { startError: error } }); s.controller.giveConsent(); await s.controller.start();
    const st = s.controller.getState();
    assert.equal(st.phase, 'failed'); assert.equal(st.error.code, code);
    assert.match(st.error.message, /bank fraud line/i); assert.ok(FAILURE_COPY[code]);
    assert.deepEqual(types(s), ['voice-failed']);
  }
  assert.equal(describeError({ message: 'Failed to fetch' }).code, 'voice_unavailable');
});

test('an error before the call is live fails it; an error during a live call only adds a note', async () => {
  const s = setup(); s.controller.giveConsent(); await s.controller.start();
  s.provider.last().request.hooks.onError(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  assert.equal(s.controller.getState().phase, 'failed');
  const live = setup(); const hooks = await goLive(live);
  hooks.onError(new Error('transient')); assert.equal(live.controller.getState().phase, 'live');
  assert.match(live.controller.getState().messages.at(-1).text, /Connection problem/);
});

test('a provider error while ONLINE reconnects with the history kept; two failed retries end in a clear failure', async () => {
  const s = setup({ online: true }); const hooks = await goLive(s);
  hooks.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Call your bank first.' }]);
  s.c.advance(10_000);
  hooks.onEnd({ disconnection_reason: 'error_retell' });
  assert.equal(s.controller.getState().phase, 'reconnecting');
  s.c.advance(1500); assert.equal(s.provider.sessions.length, 2);
  s.provider.last().request.hooks.onStatus('live');
  const st = s.controller.getState();
  assert.deepEqual([st.phase, st.callIndex], ['live', 2]);
  assert.ok(st.messages.some((m) => m.text === 'Call your bank first.'), 'history survives the reconnect');
  assert.ok(types(s).includes('voice-reconnecting'));
  s.provider.last().request.hooks.onEnd({ disconnection_reason: 'error_retell' });
  s.c.advance(4000); s.provider.last().request.hooks.onStatus('live');
  s.provider.last().request.hooks.onEnd({ disconnection_reason: 'error_retell' });
  assert.equal(s.controller.getState().phase, 'failed'); assert.equal(s.controller.getState().error.code, 'connection_lost');
  assert.ok(s.controller.getState().messages.some((m) => m.text === 'Call your bank first.'));
});

test('losing the connection mid-call: the session is ended cleanly, nothing retries, history and the bank pointer are kept', async () => {
  const opts = { online: true }; const s = setup(opts); const hooks = await goLive(s);
  hooks.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Call your bank first.' }, { id: 'user_0', role: 'user', content: 'I paid the wrong account' }]);
  s.c.advance(10_000);
  opts.online = false; s.controller.networkChanged(false);
  const st = s.controller.getState();
  assert.equal(st.phase, 'failed'); assert.equal(st.error.code, 'offline');
  assert.equal(s.provider.last().ended, 1, 'the provider session was closed, not left dangling');
  assert.match(st.error.message, /needs an internet connection/i); assert.match(st.error.message, /guide on this phone/i);
  assert.match(st.error.message, /bank fraud line is still at the top/i);
  assert.deepEqual(st.messages.filter((m) => m.role !== 'system').map((m) => m.text), ['Call your bank first.', 'I paid the wrong account'], 'already displayed transcript is preserved');
  assert.ok(st.messages.some((m) => m.role === 'system' && /needs the internet/.test(m.text)));
  s.c.advance(60_000);
  assert.equal(s.provider.sessions.length, 1, 'no reconnect attempts while offline');
  assert.ok(types(s).includes('voice-failed'));
  s.controller.networkChanged(true);
  assert.equal(s.controller.getState().phase, 'failed', 'coming back online does not silently restart a paid call');
});

test('a drop that arrives while the device is offline fails at once instead of retrying', async () => {
  const opts = { online: true }; const s = setup(opts); const hooks = await goLive(s);
  s.c.advance(10_000); opts.online = false;
  hooks.onEnd({});
  assert.equal(s.controller.getState().phase, 'failed'); assert.equal(s.controller.getState().error.code, 'offline');
  s.c.advance(10_000); assert.equal(s.provider.sessions.length, 1);
});

test('starting voice while offline never contacts the provider and explains why', async () => {
  const s = setup({ online: false }); s.controller.giveConsent(); await s.controller.start();
  assert.equal(s.provider.sessions.length, 0);
  assert.equal(s.controller.getState().phase, 'failed'); assert.equal(s.controller.getState().error.code, 'offline');
});

test('going offline while the call is still connecting also ends it, and an idle controller ignores network changes', async () => {
  const idle = setup(); idle.controller.networkChanged(false);
  assert.equal(idle.controller.getState().phase, 'idle');
  const s = setup(); s.controller.giveConsent(); await s.controller.start();
  assert.equal(s.controller.getState().phase, 'connecting');
  s.controller.networkChanged(false);
  assert.equal(s.controller.getState().error.code, 'offline');
});

test('a normal ending never reconnects: agent hang-up, inactivity, or a long call with an unknown reason', async () => {
  for (const info of [{ disconnection_reason: 'agent_hangup' }, { disconnection_reason: 'inactivity' }, { disconnection_reason: 'max_duration_reached' }]) {
    const s = setup(); const hooks = await goLive(s); s.c.advance(30_000); hooks.onEnd(info);
    assert.equal(s.controller.getState().phase, 'ended'); assert.equal(s.provider.sessions.length, 1);
  }
  const s = setup(); const hooks = await goLive(s); hooks.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Bye' }]); s.c.advance(60_000); hooks.onEnd({});
  assert.equal(s.controller.getState().phase, 'ended');
  const quick = setup(); const qh = await goLive(quick); quick.c.advance(2000); qh.onEnd({});
  assert.equal(quick.controller.getState().phase, 'reconnecting', 'a call that dies within seconds, before any caption, is retried');
});

test('the conversation stops itself at the time limit', async () => {
  const s = setup({ maxCallMs: 60_000 }); await goLive(s);
  s.c.advance(59_000); assert.equal(s.controller.getState().phase, 'live');
  s.c.advance(2000);
  assert.equal(s.controller.getState().phase, 'ended'); assert.equal(s.provider.last().ended, 1);
  assert.match(s.controller.getState().messages.at(-1).text, /time limit/);
});

test('changing language ends a live call, keeps the whole history, and says what happens next', async () => {
  const s = setup(); const hooks = await goLive(s);
  hooks.onTranscript([{ id: 'agent_0', role: 'agent', content: 'Hello' }]);
  s.controller.languageChanged('zu', { available: false, reason: 'x' });
  const st = s.controller.getState();
  assert.equal(st.phase, 'ended'); assert.equal(s.provider.last().ended, 1);
  assert.ok(st.messages.some((m) => m.text === 'Hello'));
  assert.match(st.messages.at(-1).text, /not available in this language/);
  const idle = setup(); idle.controller.languageChanged('af', { available: true });
  assert.equal(idle.controller.getState().phase, 'idle'); assert.equal(idle.provider.sessions.length, 0, 'a language change never starts a call');
});

test('history can be cleared on request, and nothing is written to browser storage', async () => {
  const stored = []; globalThis.localStorage = { setItem: (...a) => stored.push(a) }; globalThis.sessionStorage = { setItem: (...a) => stored.push(a) };
  try {
    const s = setup(); const hooks = await goLive(s);
    hooks.onTranscript([{ id: 'user_0', role: 'user', content: 'My account number is private' }]);
    s.controller.clearMessages(); assert.equal(s.controller.getState().messages.length, 0);
    assert.deepEqual(stored, []);
  } finally { delete globalThis.localStorage; delete globalThis.sessionStorage; }
});

test('timeline events carry fixed wording and never transcript text', async () => {
  const s = setup(); const hooks = await goLive(s);
  hooks.onTranscript([{ id: 'user_0', role: 'user', content: 'secret words' }, { id: 'agent_0', role: 'agent', content: 'more secret words' }]);
  s.controller.mute(); s.controller.end();
  for (const event of s.events) { const text = timelineTextFor(event); if (event.type === 'message-final') assert.equal(text, null); else { assert.ok(text); assert.doesNotMatch(text, /secret/); } }
});
