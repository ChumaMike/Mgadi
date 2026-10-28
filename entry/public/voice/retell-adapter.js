// Adapter for Retell's current browser SDK (retell-client-js-sdk v3, `RetellClient`). Not the deprecated v2
// `RetellWebClient`/access-token flow.
//
// Authorization:
//  - The call is created through OUR server (/api/voice/session), which holds the private API key, checks consent and
//    quotas, and builds the Retell request. The SDK's `fetch` option is replaced so it never contacts Retell for creation
//    and never carries credentials of its own.
//  - Retell's live-transcript WebSocket carries a key in the browser by design, so it gets a Retell PUBLIC key
//    (domain-restricted). That key is not in the page or in /api/voice/config: it arrives only in the gated session
//    response. If none is provided the call works without live captions, and the controller says so.
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

// Ask for the microphone BEFORE our server creates a Retell call. The SDK only asks after the call exists, so a person who taps "Block"
// would otherwise use up a server quota slot and leave a call at the provider that nobody joins. The stream is stopped at once; the
// browser remembers the permission for the page, so the SDK's own request a moment later does not prompt again.
// Errors keep their standard names (NotAllowedError, NotFoundError, NotReadableError) so the controller can word each one plainly.
export async function ensureMicrophone(env = globalThis) {
  const devices = env.navigator?.mediaDevices;
  if (!devices?.getUserMedia || env.isSecureContext === false) throw Object.assign(new Error('insecure_context'), { code: 'insecure_context' });
  const stream = await devices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

export function createRetellAdapter({ config, importer = loadRetellClient, fetchImpl = (...args) => globalThis.fetch(...args), getOperatorToken = () => '', microphone = () => ensureMicrophone() }) {
  return {
    captionsExpected: Boolean(config.captions),
    async start({ context, hooks }) {
      let RetellClient;
      try { RetellClient = await importer(); } catch { throw Object.assign(new Error('engine_missing'), { code: 'engine_missing' }); }
      // 0. The microphone, first. Nothing is created anywhere until the person has allowed it.
      await microphone();
      // 1. Ask OUR server for the call. It holds the private key, checks consent and quotas, and builds the Retell request.
      const headers = { 'content-type': 'application/json', 'x-mgadi-voice-consent': config.consentVersion };
      const token = getOperatorToken();
      if (token) headers['x-mgadi-operator-token'] = token;
      let response;
      try {
        response = await fetchImpl('/api/voice/session', {
          method: 'POST', credentials: 'omit', headers,
          body: JSON.stringify({ metadata: { mgadi: { language: context.language, route: context.route, stepId: context.stepId, confirmed: context.confirmed } } }),
        });
      } catch { throw Object.assign(new Error('voice_unavailable'), { code: 'voice_unavailable' }); }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw Object.assign(new Error(String(data?.error ?? 'voice_unavailable')), { status: response.status });
      // 2. Hand the SDK exactly the fields it needs. The Retell PUBLIC key (domain-restricted) arrives only in this gated
      //    response and is used for the live-transcript socket; everything else about the call is already done.
      const { mgadi = {}, ...sdkFields } = data;
      const publicKey = typeof mgadi.publicKey === 'string' && mgadi.publicKey ? mgadi.publicKey : null;
      const sdkFetch = (url) => {
        if (new URL(String(url), 'https://placeholder.invalid').pathname !== '/v3/create-web-call') {
          return Promise.resolve(new Response(JSON.stringify({ error: 'not_allowed' }), { status: 404, headers: { 'content-type': 'application/json' } }));
        }
        return Promise.resolve(new Response(JSON.stringify(sdkFields), { status: 201, headers: { 'content-type': 'application/json' } }));
      };
      const client = new RetellClient({ key: publicKey || 'transcripts-not-configured', fetch: sdkFetch });
      const session = client.createWebCall({
        agent_id: 'chosen-by-server', // required by the SDK's type, ignored: the call already exists
        transcript: Boolean(publicKey),
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
