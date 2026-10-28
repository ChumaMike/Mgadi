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
// "Thinking" is an INFERENCE, not a provider signal (Retell reports none): the person's last turn stopped growing at least
// THINK_AFTER_MS ago, nothing has come back from the assistant since, and it was less than THINK_MAX_MS ago.
const THINK_AFTER_MS = 1000;
const THINK_MAX_MS = 15000;
// If the assistant's audio has not been heard this long after the call went live, offer "No sound? Tap to enable".
const SOUND_HINT_MS = 5000;
const MAX_MESSAGES = 200;
// The transcript is untrusted text: the person's own speech, a scammer's voice on a speaker, and the assistant's reply, all passed through
// a provider. It is only ever shown as text, and nothing in the app acts on what it says. These limits keep a hostile or broken stream from
// flooding the screen or the screen reader.
const MAX_TEXT = 4000;
const MAX_ITEMS_PER_UPDATE = 100;
const MAX_ID = 64;
// Control characters (not tab or newline), and the bidirectional overrides and isolates that can make text DISPLAY as something it is not.
const UNSAFE_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
// Map and Set both iterate oldest first. Once one passes `limit` entries, drop the oldest until `keep` remain.
export function trimOldest(collection, limit, keep) {
  if (collection.size <= limit) return collection;
  let drop = collection.size - keep;
  for (const key of collection.keys()) { if (drop-- <= 0) break; collection.delete(key); }
  return collection;
}
export function safeTranscriptText(value) {
  const text = String(value).replace(UNSAFE_TEXT, '');
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}
// The one state name the interface and the avatar use. Exactly one of nine values, derived from the controller state:
//   idle | connecting | listening | thinking | speaking | muted | reconnecting | failed | ended
// While live: the assistant speaking wins (the person may be muted and still hear it), then muted, then thinking, then listening.
export const VOICE_STATES = Object.freeze(['idle', 'connecting', 'listening', 'thinking', 'speaking', 'muted', 'reconnecting', 'failed', 'ended']);
export function deriveVoiceState(s) {
  if (s.phase !== 'live') return VOICE_STATES.includes(s.phase) ? s.phase : 'idle';
  if (s.activity === 'speaking') return 'speaking';
  if (s.muted) return 'muted';
  if (s.activity === 'thinking') return 'thinking';
  return 'listening';
}
const RECONNECT_DELAYS = [1500, 4000];
const QUICK_FAILURE_MS = 8000;

export const FAILURE_COPY = {
  mic_denied: 'Microphone permission was blocked. Allow the microphone for this site in your browser settings, or use the text guidance.',
  no_mic: 'No microphone was found. Connect one, or use the text guidance.',
  mic_busy: 'The microphone is being used by another app or tab. Close it and try again, or use the text guidance.',
  insecure_context: 'Voice needs a secure (https) connection to use the microphone. Open Mgadi through its https address, or use the text guidance.',
  rate_limited: 'Too many voice conversations have been started recently. Please try again in a few minutes.',
  consent_required: 'Voice needs your agreement first.',
  language_unavailable: 'Voice is not available in this language. Text guidance is available.',
  guidance_not_translated: 'The guidance for this situation is not yet available in this language, so voice is switched off for it. Text guidance is available.',
  voice_unavailable: 'The voice assistant is not available right now.',
  engine_missing: 'The voice engine is not installed on this server.',
  connection_lost: 'The connection was lost and could not be restored.',
  offline: 'Live AI voice needs an internet connection and this device is offline. Your steps and the conversation so far are kept. Use the guide on this phone, which works without a connection once it has been saved.',
  unauthorized: 'The operator test token was not accepted.',
  quota_unavailable: 'Voice is paused for now to keep usage within its limits. Text guidance is available.',
  unknown: 'The voice conversation could not start.',
};

export function describeError(error) {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  let code = 'unknown';
  if (/notallowed|permission|denied/.test(text)) code = 'mic_denied';
  else if (/notreadable|trackstart|in use|could not start audio/.test(text)) code = 'mic_busy';
  else if (/insecure_context/.test(text)) code = 'insecure_context';
  else if (/notfound|devicesnotfound|no microphone/.test(text)) code = 'no_mic';
  else if (/rate_limited|provider_busy|429/.test(text)) code = 'rate_limited';
  else if (/consent_required/.test(text)) code = 'consent_required';
  else if (/unauthorized|401/.test(text)) code = 'unauthorized';
  else if (/quota_unavailable|503/.test(text)) code = 'quota_unavailable';
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
    uiState: 'idle', needsSoundTap: false, levelsSeen: false,
  };
  const listeners = new Set();
  let handle = null; let adapter = null; let userEnded = false; let ticker = null; let limiter = null; let retryTimer = null;
  let liveAt = 0; let lastAssistantAudioAt = 0; let lastAgentTextAt = 0; let lastUserTextAt = 0; let assistantAudioMs = 0; let lastTickAt = 0;
  let gotRealTranscript = false; let finalAnnounced = new Set();
  const seenText = new Map();
  // Display order: by call, then by the provider's time_sec, then by arrival. System notes sit at the latest time known when they were made.
  let seq = 0; let callMaxTime = 0;
  const byOrder = (a, b) => a.callIndex - b.callIndex || a.sortTime - b.sortTime || a.seq - b.seq;

  const emit = () => listeners.forEach((fn) => fn(state));
  const set = (patch) => { const next = { ...state, ...patch }; next.uiState = deriveVoiceState(next); state = next; emit(); };
  // Loudness of the ASSISTANT's audio, about once per animation frame. Kept off `state` on purpose: it changes far too often to re-render the panel.
  const levelListeners = new Set(); let lastLevel = 0;
  const note = (text) => set({ messages: [...state.messages, { key: `sys:${now()}:${seq}`, role: 'system', text, at: now(), final: true, callIndex: state.callIndex, seq: seq++, sortTime: callMaxTime }].slice(-MAX_MESSAGES) });
  const stopTimers = () => { timers.clearInterval(ticker); timers.clearTimeout(limiter); ticker = limiter = null; };

  function announceFinals(lastIsFinal = false) {
    const mine = state.messages.filter((m) => m.role !== 'system' && m.callIndex === state.callIndex);
    mine.forEach((m, i) => { if ((i < mine.length - 1 || lastIsFinal) && !finalAnnounced.has(m.key)) { finalAnnounced.add(m.key); onEvent({ type: 'message-final', message: m }); } });
  }

  function upsert(items) {
    if (!Array.isArray(items)) return;
    const messages = [...state.messages]; let accepted = 0;
    for (const item of items.slice(0, MAX_ITEMS_PER_UPDATE)) {
      if (!item || typeof item !== 'object') continue;
      if (item.role !== 'user' && item.role !== 'agent') continue;
      if (typeof item.content !== 'string') continue;
      const id = String(item.id ?? '').slice(0, MAX_ID);
      if (!id) continue;
      const key = `${state.callIndex}:${id}`;
      const text = item.content === '(unintelligible audio)' ? '(could not understand the audio)' : safeTranscriptText(item.content);
      const role = item.role === 'agent' ? 'assistant' : 'user';
      const index = messages.findIndex((m) => m.key === key);
      const prev = index >= 0 ? messages[index] : null;
      // Retell can deliver its snapshot after newer updates, so an old, shorter copy of a message we already hold may arrive late.
      // A message never shrinks back to its own beginning. (A real correction is not a prefix, so it still replaces the text.)
      const nextText = prev && prev.text.length > text.length && prev.text.startsWith(text) ? prev.text : text;
      if (seenText.get(key) !== nextText) { seenText.set(key, nextText); if (role === 'assistant') lastAgentTextAt = now(); else lastUserTextAt = now(); }
      // time_sec is 0 until word timing exists, so 0 means "not known yet": keep the old position, or go last.
      const timeSec = Number.isFinite(item.time_sec) && item.time_sec > 0 ? item.time_sec : null;
      const sortTime = timeSec ?? prev?.sortTime ?? callMaxTime;
      callMaxTime = Math.max(callMaxTime, sortTime);
      if (prev) messages[index] = { ...prev, text: nextText, sortTime }; else messages.push({ key, role, text: nextText, at: now(), final: false, callIndex: state.callIndex, seq: seq++, sortTime });
      accepted += 1;
    }
    messages.sort(byOrder);
    if (!accepted) return; // nothing usable arrived: do not claim captions are working
    // These two only help detect changes and avoid repeats, so the oldest entries can go. They must not grow with the stream.
    trimOldest(seenText, MAX_MESSAGES * 4, MAX_MESSAGES * 2); trimOldest(finalAnnounced, MAX_MESSAGES * 4, MAX_MESSAGES * 2);
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
    // Thinking: only with real captions (otherwise we cannot know the person finished a turn), never while muted, and it times out.
    const since = t - lastUserTextAt;
    const thinking = gotRealTranscript && !state.muted && lastUserTextAt > 0 && lastUserTextAt > lastAgentTextAt && since >= THINK_AFTER_MS && since < THINK_MAX_MS;
    const activity = assistant ? 'speaking' : user ? 'you-speaking' : thinking ? 'thinking' : 'listening';
    const patch = {};
    if (activity !== state.activity) patch.activity = activity;
    const needsSoundTap = !state.audioHeard && t - liveAt > SOUND_HINT_MS;
    if (needsSoundTap !== state.needsSoundTap) patch.needsSoundTap = needsSoundTap;
    // The SDK does not report a failed transcript stream. If the assistant has clearly been speaking and no caption
    // has ever arrived, say so honestly instead of showing an empty chat.
    if (state.captions === 'unknown' && !gotRealTranscript && t - liveAt > CAPTION_GRACE_MS && assistantAudioMs > 1500) patch.captions = 'unavailable';
    if (Object.keys(patch).length) set(patch);
  }

  function fail(error) {
    stopTimers(); handle = null;
    const described = error?.code && FAILURE_COPY[error.code] ? { code: error.code, message: `${FAILURE_COPY[error.code]} Your bank fraud line is still at the top of the screen.` } : describeError(error);
    set({ phase: 'failed', activity: null, error: described });
    note(described.code === 'offline' ? 'Live AI voice needs the internet and the connection is gone. Your steps and this conversation are kept. Use the guide on this phone.' : 'The voice conversation could not continue. Text guidance is available.');
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
    // Offline: retrying cannot work and would only keep a dead session open. End cleanly and say so.
    if (droppedNetwork && !normal) { try { handle?.end(); } catch { /* already gone */ } return fail({ code: 'offline' }); }
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
    if (!isOnline()) { set({ callIndex: state.callIndex + 1 }); return fail({ code: 'offline' }); }
    adapter = adapterFactory();
    const callIndex = state.callIndex + 1;
    userEnded = false; gotRealTranscript = false; assistantAudioMs = 0; lastTickAt = 0; lastAssistantAudioAt = lastAgentTextAt = lastUserTextAt = 0; callMaxTime = 0; lastLevel = 0;
    set({ phase: isRetry ? 'reconnecting' : 'connecting', callIndex, activity: null, error: null, muted: false, audioHeard: false, needsSoundTap: false, levelsSeen: false, captions: adapter.captionsExpected ? 'unknown' : 'unavailable', ...(isRetry ? {} : { reconnects: 0 }) });
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
          // `level` is the loudness of the audio coming FROM the assistant (the SDK analyser listens to the remote track only; the person's
          // own microphone is never measured). It drives the avatar's mouth and the "speaking" state.
          onAudioLevel: (level) => {
            if (userEnded || state.phase !== 'live' || !Number.isFinite(level)) return;
            lastLevel = level; levelListeners.forEach((fn) => fn(level));
            if (!state.levelsSeen) set({ levelsSeen: true });
            if (level > SPEAKING_LEVEL) { lastAssistantAudioAt = now(); if (!state.audioHeard) set({ audioHeard: true, needsSoundTap: false }); }
          },
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
    // The browser reports the network going away. A live AI call cannot survive that, so end it cleanly, keep everything
    // already shown, and point to the offline guide. Never pretend the cloud assistant keeps running offline.
    networkChanged(online) {
      if (online || !['connecting', 'live', 'reconnecting'].includes(state.phase)) return;
      userEnded = true; timers.clearTimeout(retryTimer);
      try { handle?.end(); } catch { /* the session may already be gone */ }
      announceFinals(true);
      fail({ code: 'offline' });
    },
    onLevel(fn) { levelListeners.add(fn); return () => levelListeners.delete(fn); },
    getLevel: () => lastLevel,
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
