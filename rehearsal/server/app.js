// PRACTICE BUILD, NOT THE ENTRY.
// A tiny HTTP server: static files from public/ and one API route, /api/triage.
// No framework on purpose: fewer dependencies means less to attack and less to install.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from '../public/shared/redact.js';
import { classifyRules } from '../public/shared/rules.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY_BYTES = 8 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Fixed-window rate limit per client IP. In memory: fine for one small server.
function makeRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 10_000) hits.clear();
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error('too large'), { status: 413 });
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
      req.resume(); // drain and discard, so the 413 reply can still be sent
      reject(tooLarge());
      return;
    }
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) over = true;
      if (!over) chunks.push(chunk);
    });
    req.on('end', () => (over ? reject(tooLarge()) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

export function createApp({ ai = null, rateLimit = { limit: 20, windowMs: 60_000 } } = {}) {
  const allow = makeRateLimiter(rateLimit);
  const cache = new Map(); // hash of redacted text -> result, so repeat demos cost nothing

  async function triage(req, res) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'forbidden' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      return send(res, 415, { error: 'json only' });
    }
    if (!allow(req.socket.remoteAddress || 'unknown')) {
      return send(res, 429, { error: 'Too many requests. Call your bank fraud line now; Mgadi will work again in a minute.' });
    }

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      if (err.status === 413) return send(res, 413, { error: 'too large' }, undefined, { Connection: 'close' });
      return send(res, 400, { error: 'bad json' });
    }
    if (!payload || typeof payload.text !== 'string') return send(res, 400, { error: 'text required' });

    // The phone already redacted; we redact again in case a client skipped it.
    const { text } = redact(payload.text);
    const key = createHash('sha256').update(text).digest('hex');
    if (cache.has(key)) return send(res, 200, cache.get(key));

    let result = null;
    let source = 'rules';
    if (ai) {
      try {
        result = await ai(text);
        if (result) source = 'ai';
      } catch {
        result = null; // outage, timeout, quota: fall through to the rules
      }
    }
    if (!result) result = classifyRules(text);

    const body = { label: result.label, confidence: result.confidence, source };
    if (cache.size > 500) cache.clear();
    cache.set(key, body);
    // Deliberately no logging of the text, redacted or not.
    return send(res, 200, body);
  }

  async function serveStatic(req, res) {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return send(res, 400, 'bad path', 'text/plain; charset=utf-8');
    }
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.resolve(PUBLIC_DIR, '.' + urlPath);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    const type = TYPES[path.extname(filePath).toLowerCase()];
    if (!type) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    try {
      const data = await readFile(filePath);
      return send(res, 200, data, type, { 'Cache-Control': 'no-cache' });
    } catch {
      return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    }
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.url === '/api/triage') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, undefined, { Allow: 'POST' });
        return await triage(req, res);
      }
      if (req.url === '/api/health') return send(res, 200, { ok: true, ai: Boolean(ai) });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method' });
      return await serveStatic(req, res);
    } catch {
      if (!res.headersSent) send(res, 500, { error: 'server error' });
    }
  });
}
