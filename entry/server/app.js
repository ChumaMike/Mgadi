import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactIncident } from '../public/shared/redact.js';
import { classifyRules } from '../public/shared/rules.js';
import { validateTriage } from '../public/shared/labels.js';
import { createVoiceService } from './voice.js';
import { chatWithAnthropic, chatConfig } from './ai-chat.js';
import { buildPrecacheManifest } from './precache.js';
import { createLinkService, createLinkStoreFromEnv } from './links.js';

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY_BYTES = 8 * 1024;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://api.retellai.com wss://api.retellai.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=()',
  // Nothing on this origin is meant to be embedded in or read by another site.
  // Cross-Origin-Opener-Policy was tried and left out ON PURPOSE: with it, Chromium under Playwright's offline emulation kept reporting
  // navigator.onLine = true on the offline reopen, so the offline indicator could not be verified. Revisit it only with a real phone.
  // Framing is already blocked (frame-ancestors, X-Frame-Options), external links use noopener, and nothing opens popups.
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function reply(response, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  response.writeHead(status, { ...securityHeaders, 'Cache-Control': 'no-store', ...extra, 'Content-Type': type });
  response.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Behind Vercel the socket address is the platform proxy, so every visitor would share one bucket.
// Only trust forwarding headers when running on Vercel, where the platform sets them; locally they are ignorable.
export function clientKey(request, env = process.env) {
  if (env.VERCEL) {
    const forwarded = request.headers?.['x-vercel-forwarded-for'] ?? request.headers?.['x-forwarded-for'];
    const first = String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim();
    if (first) return first;
  }
  return request.socket?.remoteAddress ?? 'unknown';
}

// In-memory and per instance: on a serverless platform each instance has its own counters, so this slows a casual flood and no more.
// The map is bounded so a stream of unique addresses cannot grow it without limit: expired entries go first, then the oldest.
export function createRateLimiter(limit = 20, windowMs = 60_000, maxKeys = 10_000) {
  const requests = new Map();
  const allow = (key, now = Date.now()) => {
    if (requests.size >= maxKeys && !requests.has(key)) {
      for (const [k, v] of requests) if (now - v.startedAt >= windowMs) requests.delete(k);
      for (const k of requests.keys()) { if (requests.size < maxKeys) break; requests.delete(k); } // Map order is oldest first
    }
    const current = requests.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      requests.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
  allow.size = () => requests.size;
  return allow;
}

// The operator token is a credential that unlocks paid calls and travels in a header, so it is only honoured when the connection cannot
// be read on the way: HTTPS, or the same machine. Behind a proxy the proxy says which it was; with no proxy the socket tells us.
export function secureTransport(request) {
  const forwarded = String(request.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  if (forwarded) return forwarded === 'https';
  if (request.socket?.encrypted) return true;
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress ?? '');
}

function readJson(request) {
  // Vercel may provide an already-parsed body instead of an unread stream.
  if (request.body !== undefined) {
    try {
      const raw = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return Promise.reject(Object.assign(new Error('too large'), { status: 413 }));
      return Promise.resolve(JSON.parse(raw));
    } catch { return Promise.reject(new Error('bad JSON')); }
  }
  return new Promise((resolve, reject) => {
    if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
      request.resume();
      reject(Object.assign(new Error('too large'), { status: 413 }));
      return;
    }
    let received = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      received += chunk.length;
      if (received <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on('end', () => {
      if (received > MAX_BODY_BYTES) return reject(Object.assign(new Error('too large'), { status: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad json')); }
    });
    request.on('error', reject);
  });
}

function loadPlaybook(root = publicRoot) {
  try { return JSON.parse(readFileSync(path.join(root, 'data', 'playbook.json'), 'utf8')); } catch { return { incidents: {} }; }
}

export function createHandler({ classifyWithAI = null, voice, links, env = process.env, fetchImpl = globalThis.fetch, publicDir } = {}) {
  const root = publicDir ? path.resolve(publicDir) : publicRoot; // tests may serve a different copy of the app
  const voiceService = voice ?? createVoiceService({ env, fetchImpl, playbook: loadPlaybook(root) });
  let manifestMemo = { at: 0, value: null };
  // Always computed from the files being served, so the list the service worker verifies can never drift from them.
  async function precacheManifest() {
    if (manifestMemo.value && Date.now() - manifestMemo.at < 3000) return manifestMemo.value;
    manifestMemo = { at: Date.now(), value: await buildPrecacheManifest(root) };
    return manifestMemo.value;
  }
  const allow = createRateLimiter();
  // Per-instance protection is defense-in-depth; the API additionally requires a private operator credential.
  const allowPaidChat = createRateLimiter(6, 60_000);
  const cache = new Map();
  // Sealed links (supplier check, responder handoff). See server/links.js for exactly what is stored. The limits are per instance.
  const linkService = links ?? (() => { const { store, sharedRequired } = createLinkStoreFromEnv(env, { fetchImpl }); return createLinkService({ store, sharedRequired, ttlHours: Number(env.MGADI_LINK_TTL_HOURS) || undefined }); })();
  const allowLinkCreate = createRateLimiter(20, 3_600_000);
  const allowLinkUse = createRateLimiter(300, 600_000);

  async function linksRoute(request, response) {
    if (request.method !== 'POST') return reply(response, 405, { error: 'POST only' }, undefined, { Allow: 'POST' });
    if (foreignOrigin(request)) return reply(response, 403, { error: 'forbidden' });
    if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) return reply(response, 415, { error: 'JSON only' });
    let payload;
    try { payload = await readJson(request); } catch (error) { return reply(response, error.status ?? 400, { error: error.status ? 'too large' : 'bad JSON' }); }
    const client = clientKey(request);
    const creating = payload?.op === 'create';
    if (!(creating ? allowLinkCreate : allowLinkUse)(`${creating ? 'c' : 'u'}:${client}`)) return reply(response, 429, { error: 'rate_limited' });
    const result = await linkService.handle(payload);
    return reply(response, result.status, result.body);
  }

  async function triage(request, response) {
    if (request.headers['sec-fetch-site'] === 'cross-site') return reply(response, 403, { error: 'forbidden' });
    if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) return reply(response, 415, { error: 'JSON only' });
    if (!allow(clientKey(request))) return reply(response, 429, { error: 'Too many requests. Call your bank fraud line now and try again shortly.' });

    let payload;
    try { payload = await readJson(request); } catch (error) {
      return reply(response, error.status ?? 400, { error: error.status ? 'too large' : 'bad JSON' });
    }
    if (!payload || typeof payload.text !== 'string') return reply(response, 400, { error: 'text is required' });

    // Repeat browser redaction: no client can bypass this boundary.
    const redacted = redactIncident(payload.text).text;
    const cacheKey = createHash('sha256').update(redacted).digest('hex');
    if (cache.has(cacheKey)) return reply(response, 200, cache.get(cacheKey));

    let triageResult = null;
    let source = 'rules';
    if (classifyWithAI) {
      try {
        triageResult = validateTriage(await classifyWithAI(redacted));
        if (triageResult) source = 'ai';
      } catch {
        triageResult = null;
      }
    }
    triageResult ??= classifyRules(redacted);
    const result = { ...triageResult, source };
    if (cache.size >= 500) cache.clear();
    cache.set(cacheKey, result);
    return reply(response, 200, result);
  }

  async function aiChatRoute(request,response) {
    if(request.method !== 'POST') return reply(response,405,{error:'POST only'},undefined,{Allow:'POST'});
    if(foreignOrigin(request)) return reply(response,403,{error:'forbidden'});
    if(!String(request.headers['content-type']||'').startsWith('application/json')) return reply(response,415,{error:'JSON only'});
    if(!chatConfig(env).available) return reply(response,503,{error:'ai_not_configured'});
    const configuredToken=String(env.MGADI_AI_TEST_TOKEN||'');
    // Paid calls require a separate long, server-side token; never put it into HTML or query strings.
    if(configuredToken.length<24 || !secureTransport(request)) return reply(response,403,{error:'operator_required'});
    const sent=String(request.headers['x-mgadi-ai-test-token']||'');
    const h=(v)=>createHash('sha256').update(v).digest('hex');
    if(sent.length!==configuredToken.length || h(sent)!==h(configuredToken)) return reply(response,403,{error:'operator_required'});
    if(!allowPaidChat(clientKey(request,env))) return reply(response,429,{error:'rate_limited'});
    let payload;
    try{payload=await readJson(request);}catch(e){return reply(response,e.status||400,{error:'invalid_message'});}
    const out=await chatWithAnthropic(payload,{env,fetchImpl});
    return reply(response,out.status,out.body);
  }

  // Browsers attach Sec-Fetch-Site and Origin to cross-site requests; scripts can leave them out, so these checks stop
  // other WEBSITES from spending our credits through a visitor's browser. Stopping scripts is the job of the quota layer.
  function foreignOrigin(request) {
    const site = request.headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') return true;
    const origin = request.headers.origin;
    if (!origin) return false;
    try { return new URL(origin).host !== String(request.headers.host ?? ''); } catch { return true; }
  }

  async function voiceRoute(request, response, pathname) {
    const clientId = clientKey(request);
    // Over a connection that could be read, a token is ignored (answered as the public view) and is never compared or counted.
    const token = secureTransport(request) ? request.headers['x-mgadi-operator-token'] : undefined;
    if (pathname === '/api/voice/config') {
      if (request.method !== 'GET') return reply(response, 405, { error: 'GET only' }, undefined, { Allow: 'GET' });
      const auth = await voiceService.authenticate(token, clientId);
      // A wrong token is answered exactly like no token (public view), so it reveals nothing; only a lockout is visible.
      if (auth.limited) return reply(response, 429, { error: 'rate_limited' });
      // Operator-only, read-only provider check. Never returns keys or call credentials.
      const diagnosticsRequested = new URL(request.url, 'http://mgadi.local').searchParams.get('diagnose') === '1';
      if (diagnosticsRequested) {
        if (auth.access !== 'operator' || auth.rejected) return reply(response, 403, { error: 'operator_required' });
        const report = await voiceService.diagnose();
        return reply(response, 200, {
          ok: report.some((language) => language.code === 'en' && language.ok),
          captionsConfigured: voiceService.cfg.hasPublicKey && voiceService.cfg.transcripts !== 'off',
          agentVersionPinned: voiceService.cfg.agentVersion !== null,
          operatorCallMinutes: voiceService.cfg.operatorMaxMs / 60_000,
          languages: report,
          note: 'Read-only checks only. This cannot test the Retell public key domain allowlist, microphone, live audio or captions.',
        });
      }
      const result = await voiceService.config(auth.rejected ? { access: 'public' } : auth);
      return reply(response, result.status, result.body);
    }
    if (request.method !== 'POST') return reply(response, 405, { error: 'POST only' }, undefined, { Allow: 'POST' });
    if (foreignOrigin(request)) return reply(response, 403, { error: 'forbidden' });
    if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) return reply(response, 415, { error: 'JSON only' });
    let payload;
    try { payload = await readJson(request); } catch (error) { return reply(response, error.status ?? 400, { error: error.status ? 'too large' : 'bad JSON' }); }
    const auth = await voiceService.authenticate(token, clientId);
    const result = await voiceService.createSession({ payload, consent: request.headers['x-mgadi-voice-consent'], clientId, auth });
    return reply(response, result.status, result.body);
  }

  async function staticFile(request, response) {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://mgadi.local').pathname); } catch { return reply(response, 400, 'Bad request', 'text/plain; charset=utf-8'); }
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/precache-manifest.json') { try { return reply(response, 200, await precacheManifest(), undefined, { 'Cache-Control': 'no-store' }); } catch { return reply(response, 500, { error: 'manifest unavailable' }); } }
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(`${root}${path.sep}`)) return reply(response, 404, 'Not found', 'text/plain; charset=utf-8');
    const type = contentTypes[path.extname(filename)];
    if (!type) return reply(response, 404, 'Not found', 'text/plain; charset=utf-8');
    try { return reply(response, 200, await readFile(filename), type, { 'Cache-Control': 'no-cache' }); }
    catch { return reply(response, 404, 'Not found', 'text/plain; charset=utf-8'); }
  }

  return async (request, response) => {
    try {
      // Match on the path only, so a query string (cache-busting, tracking) never turns an API route into a static lookup.
      let pathname = '';
      try { pathname = new URL(request.url, 'http://mgadi.local').pathname; } catch { /* handled by the static route */ }
      if (pathname === '/api/ai-chat') return await aiChatRoute(request,response);
      if (pathname === '/api/health') return reply(response, 200, { ok: true, ai: Boolean(classifyWithAI) });
      if (pathname === '/api/voice/config' || pathname === '/api/voice/session') return await voiceRoute(request, response, pathname);
      if (pathname === '/api/links') return await linksRoute(request, response);
      if (pathname === '/api/triage') {
        if (request.method !== 'POST') return reply(response, 405, { error: 'POST only' }, undefined, { Allow: 'POST' });
        return await triage(request, response);
      }
      if (!['GET', 'HEAD'].includes(request.method)) return reply(response, 405, { error: 'Method not allowed' });
      return await staticFile(request, response);
    } catch {
      if (!response.headersSent) reply(response, 500, { error: 'Unexpected server error' });
    }
  };
}

export function createApp(options = {}) {
  return http.createServer(createHandler(options));
}
