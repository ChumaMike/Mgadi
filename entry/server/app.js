import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactIncident } from '../public/shared/redact.js';
import { classifyRules } from '../public/shared/rules.js';
import { validateTriage } from '../public/shared/labels.js';

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY_BYTES = 8 * 1024;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

function reply(response, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  response.writeHead(status, { ...securityHeaders, ...extra, 'Content-Type': type, 'Cache-Control': 'no-store' });
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

function createRateLimiter(limit = 20, windowMs = 60_000) {
  const requests = new Map();
  return (key, now = Date.now()) => {
    const current = requests.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      requests.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
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

export function createHandler({ classifyWithAI = null } = {}) {
  const allow = createRateLimiter();
  const cache = new Map();

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

  async function staticFile(request, response) {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://mgadi.local').pathname); } catch { return reply(response, 400, 'Bad request', 'text/plain; charset=utf-8'); }
    if (pathname === '/') pathname = '/index.html';
    const filename = path.resolve(publicRoot, `.${pathname}`);
    if (!filename.startsWith(`${publicRoot}${path.sep}`)) return reply(response, 404, 'Not found', 'text/plain; charset=utf-8');
    const type = contentTypes[path.extname(filename)];
    if (!type) return reply(response, 404, 'Not found', 'text/plain; charset=utf-8');
    try { return reply(response, 200, await readFile(filename), type, { 'Cache-Control': 'no-cache' }); }
    catch { return reply(response, 404, 'Not found', 'text/plain; charset=utf-8'); }
  }

  return async (request, response) => {
    try {
      if (request.url === '/api/health') return reply(response, 200, { ok: true, ai: Boolean(classifyWithAI) });
      if (request.url === '/api/triage') {
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
