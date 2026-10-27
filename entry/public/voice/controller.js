// Voice conversation controller. No DOM and no provider code: a provider adapter is injected, so the same logic runs
// against Retell, the labelled simulation, and the mocks used in tests.
//
// Safety rules enforced here:
//  - The assistant never completes real-world actions. This controller has no concept of "task done": only the
//    person's own taps do that, elsewhere in the app.
//  - Only event TYPES are reported to the app timeline (started, ended, muted ...). Transcript text stays in memory
//    for the open page and is never written to storage or sent anywhere by Mgadi.
const SPEAKING_LEVEL = 0.012;
const AUDIO_HOLD_MS = 450;
const TEXT_ACTIVE_MS = 1300;
const CAPTION_GRACE_MS = 7000;
const MAX_MESSAGES = 200;
const RECONNECT_DELAYS = [1500, 4000];
const QUICK_FAILURE_MS = 8000;

export const FAILURE_COPY = {
  mic_denied: 'Microphone permission was blocked. Allow the microphone for this site in your browser settings, or use the text guidance.',
  no_mic: 'No microphone was found. Connect one, or use the text guidance.',
  rate_limited: 'Too many voice conversations have been started recently. Please try again in a few minutes.',
  consent_required: 'Voice needs your agreement first.',
  language_unavailable: 'Voice is not available in this language. Text guidance is available.',
  guidance_not_translated: 'The guidance for this situation is not yet available in this language, so voice is switched off for it. Text guidance is available.',
  voice_unavailable: 'The voice assistant is not available right now.',
  engine_missing: 'The voice engine is not installed on this server.',
  connection_lost: 'The connection was lost and could not be restored.',
  unknown: 'The voice conversation could not start.',
};

export function describeError(error) {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  let code = 'unknown';
  if (/notallowed|permission|denied/.test(text)) code = 'mic_denied';
  else if (/notfound|devicesnotfound|no microphone/.test(text)) code = 'no_mic';
  else if (/rate_limited|provider_busy|429/.test(text)) code = 'rate_limited';
  else if (/consent_required/.test(text)) code = 'consent_required';
  else if (/guidance_not_translated/.test(text)) code = 'guidance_not_translated';
  else if (/language_unavailable/.test(text)) code = 'language_unavailable';
  else if (/engine_missing/.test(text)) code = 'engine_missing';
  else if (/voice_unavailable|failed to fetch|networkerror|502|409/.test(text)) code = 'voice_unavailable';
  return { code, message: `${FAILURE_COPY[code]} Your bank fraud line is still at the top of the screen.` };
}

export function createVoiceController({
  adapterFactory, getContext, config = {}, now = () => Date.now(), timers = globalThis, isOnline = () => true, onEvent = () => {},
}) {
  let state = {
    phase: 'idle', activity: null, muted: false, captions: 'unknown', messages: [], error: null,
    consented: false, language: 'en', callIndex: 0, startedAt: null, reconnects: 0, audioHeard: false,
  };
  const listeners = new Set();
  let handle = null; let adapter = null; let userEnded = false; let ticker = null; let limiter = null; let retryTimer = null;
  let liveAt = 0; let lastAssistantAudioAt = 0; let lastAgentTextAt = 0; let lastUserTextAt = 0; let assistantAudioMs = 0; let lastTickAt = 0;
  let gotRealTranscript = false; let finalAnnounced = new Set();
  const seenText = new Map();

  const emit = () => listeners.forEach((fn) => fn(state));
  const set = (patch) => { state = { ...state, ...patch }; emit(); };
  const note = (text) => set({ messages: [...state.messages, { key: `sys:${now()}:${state.messages.length}`, role: 'system', text, at: now(), final: true, callIndex: state.callIndex }].slice(-MAX_MESSAGES) });
  const stopTimers = () => { timers.clearInterval(ticker); timers.clearTimeout(limiter); ticker = limiter = null; };

  function announceFinals(lastIsFinal = false) {
    const mine = state.messages.filter((m) => m.role !== 'system' && m.callIndex === state.callIndex);
    mine.forEach((m, i) => { if ((i < mine.length - 1 || lastIsFinal) && !finalAnnounced.has(m.key)) { finalAnnounced.add(m.key); onEvent({ type: 'message-final', message: m }); } });
  }

  function upsert(items) {
    const messages = [...state.messages];
    for (const item of items) {
      if (item.role !== 'user' && item.role !== 'agent') continue;
      const key = `${state.callIndex}:${item.id}`;
      const text = item.content === '(unintelligible audio)' ? '(could not understand the audio)' : String(item.content ?? '');
      const role = item.role === 'agent' ? 'assistant' : 'user';
      const index = messages.findIndex((m) => m.key === key);
      if (seenText.get(key) !== text) { seenText.set(key, text); if (role === 'assistant') lastAgentTextAt = now(); else lastUserTextAt = now(); }
      if (index >= 0) messages[index] = { ...messages[index], text }; else messages.push({ key, role, text, at: now(), final: false, callIndex: state.callIndex });
    }
    set({ messages: messages.slice(-MAX_MESSAGES), captions: 'on' });
    gotRealTranscript = true;
    announceFinals();
  }

  function tick() {
    if (state.phase !== 'live') return;
    const t = now();
    const dt = lastTickAt ? t - lastTickAt : 0; lastTickAt = t;
    const audioActive = t - lastAssistantAudioAt < AUDIO_HOLD_MS;
    if (audioActive) assistantAudioMs += dt;
    const assistant = audioActive || t - lastAgentTextAt < TEXT_ACTIVE_MS;
    const user = !state.muted && t - lastUserTextAt < 1000;
    const activity = assistant ? 'speaking' : user ? 'you-speaking' : 'listening';
    const patch = {};
    if (activity !== state.activity) patch.activity = activity;
    // The SDK does not report a failed transcript stream. If the assistant has clearly been speaking and no caption
    // has ever arrived, say so honestly instead of showing an empty chat.
    if (state.captions === 'unknown' && !gotRealTranscript && t - liveAt > CAPTION_GRACE_MS && assistantAudioMs > 1500) patch.captions = 'unavailable';
    if (Object.keys(patch).length) set(patch);
  }

  function fail(error) {
    stopTimers(); handle = null;
    const described = error?.code && FAILURE_COPY[error.code] ? { code: error.code, message: `${FAILURE_COPY[error.code]} Your bank fraud line is still at the top of the screen.` } : describeError(error);
    set({ phase: 'failed', activity: null, error: described });
    note('The voice conversation could not continue. Text guidance is available.');
    onEvent({ type: 'voice-failed', code: described.code });
  }

  function finish(reason) {
    stopTimers(); handle = null;
    announceFinals(true);
    set({ phase: 'ended', activity: null, muted: false, error: null });
    note(reason);
    onEvent({ type: 'voice-ended' });
  }

  function reconnectOrEnd(info) {
    const quick = now() - liveAt < QUICK_FAILURE_MS && !gotRealTranscript;
    const providerError = /^error_|registered_call_timeout/.test(info?.disconnection_reason ?? '');
    const normal = ['user_hangup', 'agent_hangup', 'inactivity', 'max_duration_reached'].includes(info?.disconnection_reason);
    const droppedNetwork = !isOnline();
    if (normal || !(providerError || droppedNetwork || quick)) return finish(info?.disconnection_reason === 'max_duration_reached' ? 'The conversation reached its time limit.' : 'The voice conversation ended.');
    if (state.reconnects >= RECONNECT_DELAYS.length) { stopTimers(); handle = null; return fail({ code: 'connection_lost' }); }
    stopTimers(); handle = null; announceFinals(true);
    const delay = RECONNECT_DELAYS[state.reconnects];
    set({ phase: 'reconnecting', activity: null, reconnects: state.reconnects + 1 });
    note('Connection lost. Reconnecting…');
    onEvent({ type: 'voice-reconnecting' });
    retryTimer = timers.setTimeout(() => { if (state.phase === 'reconnecting') begin(true); }, delay);
  }

  async function begin(isRetry = false) {
    adapter = adapterFactory();
    const callIndex = state.callIndex + 1;
    userEnded = false; gotRealTranscript = false; assistantAudioMs = 0; lastTickAt = 0; lastAssistantAudioAt = lastAgentTextAt = lastUserTextAt = 0;
    set({ phase: isRetry ? 'reconnecting' : 'connecting', callIndex, activity: null, error: null, muted: false, audioHeard: false, captions: adapter.captionsExpected ? 'unknown' : 'unavailable', ...(isRetry ? {} : { reconnects: 0 }) });
    const context = getContext();
    set({ language: context.language });
    try {
      handle = await adapter.start({
        context,
        hooks: {
          onStatus: (status) => {
            if (userEnded || status !== 'live' || (state.phase !== 'connecting' && state.phase !== 'reconnecting')) return;
            liveAt = now(); lastTickAt = 0;
            set({ phase: 'live', activity: 'listening', startedAt: liveAt });
            note(isRetry ? 'Reconnected.' : 'Voice conversation started.');
            onEvent({ type: 'voice-started', language: context.language });
            ticker = timers.setInterval(tick, 200);
            if (config.maxCallMs) limiter = timers.setTimeout(() => { if (state.phase === 'live') { userEnded = true; try { handle?.end(); } catch { /* ignore */ } finish('The conversation reached its time limit.'); } }, config.maxCallMs);
          },
          onTranscript: (items) => { if (!userEnded) upsert(items); },
          onAudioLevel: (level) => { if (!userEnded && level > SPEAKING_LEVEL) { lastAssistantAudioAt = now(); if (!state.audioHeard) set({ audioHeard: true }); } },
          onError: (error) => { if (userEnded) return; if (state.phase === 'connecting') fail(error); else if (state.phase === 'live') note('Connection problem. Trying to continue…'); },
          onEnd: (info) => { if (userEnded || state.phase === 'ended' || state.phase === 'failed') return; if (state.phase === 'connecting') { fail(info?.error ?? { code: 'voice_unavailable' }); return; } reconnectOrEnd(info); },
        },
      });
    } catch (error) { if (!userEnded) fail(error); }
  }

  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    giveConsent() { set({ consented: true }); },
    async start() {
      if (['connecting', 'live', 'reconnecting'].includes(state.phase)) return;
      if (!state.consented) { set({ phase: 'idle' }); return; }
      timers.clearTimeout(retryTimer);
      await begin(false);
    },
    end(reason = 'You ended the voice conversation.') {
      if (!['connecting', 'live', 'reconnecting'].includes(state.phase)) return;
      userEnded = true; timers.clearTimeout(retryTimer);
      try { handle?.end(); } catch { /* the session may already be gone */ }
      finish(reason);
    },
    mute() { if (state.phase !== 'live' || state.muted) return; try { handle?.mute(); } catch { /* ignore */ } set({ muted: true }); onEvent({ type: 'voice-muted' }); },
    unmute() { if (state.phase !== 'live' || !state.muted) return; try { handle?.unmute(); } catch { /* ignore */ } set({ muted: false }); onEvent({ type: 'voice-unmuted' }); },
    // Language or assistance mode changed: keep every message, end only a call that can no longer continue.
    languageChanged(language, availability) {
      const live = ['connecting', 'live', 'reconnecting'].includes(state.phase);
      if (live && language !== state.language) {
        this.end(availability?.available ? 'Voice ended because the language changed. Tap "Talk to Mgadi" to continue in the new language.' : 'Voice ended because the language changed. Voice is not available in this language, so use the text guidance. Your conversation so far is kept.');
      } else if (!live && !availability?.available) {
        set({ language });
      }
      set({ language });
    },
    clearMessages() { finalAnnounced = new Set(); seenText.clear(); set({ messages: [] }); },
    systemNote: note,
    tick,
    startAudioPlayback: () => handle?.startAudioPlayback?.(),
  };
}

// Fixed, content-free wording for the incident timeline. Transcript text is never part of it.
const TIMELINE_TEXT = {
  'voice-started': 'Voice conversation started (audio processed by Retell AI)',
  'voice-ended': 'Voice conversation ended',
  'voice-failed': 'Voice conversation could not continue',
  'voice-reconnecting': 'Voice connection lost, reconnecting',
  'voice-muted': 'Microphone muted',
  'voice-unmuted': 'Microphone unmuted',
};
export const timelineTextFor = (event) => TIMELINE_TEXT[event?.type] ?? null;
