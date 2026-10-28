// A SIMULATED conversation for demos and automated tests. No audio, no microphone, no network, no AI. It only runs
// when the server reports mode "mock" (MGADI_VOICE_MODE=mock), and the interface labels it as a simulation.
// Optional scenario flags (from ?mockvoice=...): fail-mic, fail-provider, drop, nocaptions, fast, slowconnect (stay in "connecting" for 4 s).
export function createMockAdapter({ scenario = '', timers = globalThis } = {}) {
  const flags = new Set(String(scenario).split(',').filter(Boolean));
  const scale = flags.has('fast') ? 0.1 : 1;
  let sessionCount = 0;
  return {
    captionsExpected: true,
    async start({ hooks, context = {} }) {
      sessionCount += 1;
      if (flags.has('fail-mic')) throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
      if (flags.has('fail-provider')) throw new Error('voice_unavailable');
      const jobs = []; let muted = false; let closed = false;
      const later = (ms, fn) => jobs.push(timers.setTimeout(() => { if (!closed) fn(); }, ms * scale));
      const say = (id, role, text, at) => {
        const words = text.split(' ');
        words.forEach((_, i) => later(at + i * 90, () => {
          // Simulated loudness that rises and falls word by word, as real speech does. It is NOT real audio.
          if (role === 'agent') hooks.onAudioLevel(0.04 + 0.15 * Math.abs(Math.sin(i * 1.9 + 0.4)));
          if (!flags.has('nocaptions') && (role === 'agent' || !muted)) hooks.onTranscript(partial(id, role, words.slice(0, i + 1).join(' ')));
        }));
        if (role === 'agent') later(at + words.length * 90, () => hooks.onAudioLevel(0.001));
        return at + words.length * 90;
      };
      const transcript = {};
      const partial = (id, role, content) => { transcript[id] = { id, role, content, time_sec: 0 }; return Object.values(transcript); };
      later(flags.has('slowconnect') ? 4000 : 600, () => hooks.onStatus('live'));
      let t = say('agent_0', 'agent', 'Hello. I am the Mgadi assistant, an AI. This is a simulation, so no real AI is listening.', 800);
      const examples = {
        payment_diversion: ['I paid a supplier, but the supplier says those were not their banking details.', 'The first step is to call your bank fraud line. Use the Bank fraud line button on your screen.'],
        suspicious_message: ['I received a suspicious message. I have not paid.', 'Do not pay, click or reply. Confirm the request on a previously trusted number.'],
        ransomware_suspected: ['My files are locked and there is a demand for money.', 'Follow the current action on screen. Do not click the ransom message. Contact your trusted IT or security team.'],
        mailbox_compromise: ['Someone may have accessed my account.', 'Follow the account security steps on screen from a clean device, or ask your trusted IT team for help.'],
        not_cyber: ['I have an ordinary payment problem.', 'Use a trusted contact to check the payment. If you suspect fraud, the bank fraud directory is available.'],
        unsure: ['I do not know what happened.', 'Use the current safe action on screen. If money may have moved, contact your bank on its official fraud line.'],
      };
      const [example, reply] = examples[context.route] ?? examples.unsure;
      t = say('user_0', 'user', example, t + 1200);
      say('agent_1', 'agent', reply + ' Only you can tick the step once you have done it. This is a scripted demonstration, not a live conversation.', t + 1700);
      if (flags.has('drop') && sessionCount === 1) later(4000, () => hooks.onEnd({ disconnection_reason: 'error_retell' }));
      return { mute() { muted = true; }, unmute() { muted = false; }, end() { closed = true; jobs.forEach((j) => timers.clearTimeout(j)); }, startAudioPlayback() {} };
    },
  };
}
