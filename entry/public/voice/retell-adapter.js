// Adapter for Retell's current browser SDK (retell-client-js-sdk v3, `RetellClient`). Not the deprecated v2
// `RetellWebClient`/access-token flow.
//
// Authorization:
//  - The call is created through OUR server (/api/voice/session), which holds the private API key. The SDK's `fetch`
//    option is replaced so its request goes there, with none of the SDK's own credentials attached.
//  - Retell's live-transcript WebSocket carries a key in the browser by design, so it gets a Retell PUBLIC key
//    (domain-restricted, meant for browsers). If none is configured the call works without live captions, and the
//    controller says so.
export async function loadRetellClient() {
  const module = await import('/vendor/retell-client.js');
  return module.RetellClient;
}

export function rms(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function createRetellAdapter({ config, importer = loadRetellClient, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  const sessionFetch = (url, init = {}) => {
    // Only call creation may go through the proxy; anything else the SDK asks for is refused.
    if (new URL(String(url), 'https://placeholder.invalid').pathname !== '/v3/create-web-call') {
      return Promise.resolve(new Response(JSON.stringify({ error: 'not_allowed' }), { status: 404, headers: { 'content-type': 'application/json' } }));
    }
    return fetchImpl('/api/voice/session', {
      method: 'POST', credentials: 'omit', body: init.body,
      headers: { 'content-type': 'application/json', 'x-mgadi-voice-consent': config.consentVersion },
    });
  };
  return {
    captionsExpected: Boolean(config.publicKey),
    async start({ context, hooks }) {
      let RetellClient;
      try { RetellClient = await importer(); } catch { throw Object.assign(new Error('engine_missing'), { code: 'engine_missing' }); }
      const client = new RetellClient({ key: config.publicKey || 'transcripts-not-configured', fetch: sessionFetch });
      const session = client.createWebCall({
        agent_id: 'chosen-by-server', // required by the SDK's type, ignored by our server
        metadata: { mgadi: { language: context.language, route: context.route, stepId: context.stepId, confirmed: context.confirmed } },
        transcript: Boolean(config.publicKey),
        audio: { emitRawAudioSamples: true },
        hooks: {
          onStatus: (status) => hooks.onStatus(status),
          onTranscript: (items) => hooks.onTranscript(items),
          onAudio: (samples) => hooks.onAudioLevel(rms(samples)),
          onError: (error) => hooks.onError(error),
          onEnd: (info) => hooks.onEnd(info ?? {}),
        },
      });
      return { mute: () => session.mute(), unmute: () => session.unmute(), end: () => session.end(), startAudioPlayback: () => session.startAudioPlayback() };
    },
  };
}
