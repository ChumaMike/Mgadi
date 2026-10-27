// A SIMULATED conversation for demos and automated tests. No audio, no microphone, no network, no AI. It only runs
// when the server reports mode "mock" (MGADI_VOICE_MODE=mock), and the interface labels it as a simulation.
// Optional scenario flags (from ?mockvoice=...): fail-mic, fail-provider, drop, nocaptions, fast.
export function createMockAdapter({ scenario = '', timers = globalThis } = {}) {
  const flags = new Set(String(scenario).split(',').filter(Boolean));
  const scale = flags.has('fast') ? 0.1 : 1;
  let sessionCount = 0;
  return {
    captionsExpected: true,
    async start({ hooks }) {
      sessionCount += 1;
      if (flags.has('fail-mic')) throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
      if (flags.has('fail-provider')) throw new Error('voice_unavailable');
      const jobs = []; let muted = false; let closed = false;
      const later = (ms, fn) => jobs.push(timers.setTimeout(() => { if (!closed) fn(); }, ms * scale));
      const say = (id, role, text, at) => {
        const words = text.split(' ');
        words.forEach((_, i) => later(at + i * 90, () => {
          if (role === 'agent') hooks.onAudioLevel(0.2);
          if (!flags.has('nocaptions') && (role === 'agent' || !muted)) hooks.onTranscript(partial(id, role, words.slice(0, i + 1).join(' ')));
        }));
        return at + words.length * 90;
      };
      const transcript = {};
      const partial = (id, role, content) => { transcript[id] = { id, role, content, time_sec: 0 }; return Object.values(transcript); };
      later(600, () => hooks.onStatus('live'));
      let t = say('agent_0', 'agent', 'Hello. I am the Mgadi assistant, an AI. This is a simulation, so no real AI is listening.', 800);
      t = say('user_0', 'user', 'I paid a supplier into a new account and I am worried.', t + 1200);
      say('agent_1', 'agent', 'I am sorry. The first step is to call your bank fraud line. Use the Bank fraud line button on your screen. Only you can tick the step once you have called.', t + 1200);
      if (flags.has('drop') && sessionCount === 1) later(4000, () => hooks.onEnd({ disconnection_reason: 'error_retell' }));
      return { mute() { muted = true; }, unmute() { muted = false; }, end() { closed = true; jobs.forEach((j) => timers.clearTimeout(j)); }, startAudioPlayback() {} };
    },
  };
}
