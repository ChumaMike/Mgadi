// Link service: the ONLY server-side state for the supplier payment-change check and the responder handoff.
//
// WHAT THE SERVER KEEPS, per link, and nothing else:
//   l:<id>   kind ('check' | 'handoff'), the CIPHERTEXT and its IV, SHA-256 hashes of two random tokens, createdAt, expiresAt
//   e:<id>   at most ONE event: { status, at, note? } where status is 'approved' | 'rejected' | 'acknowledged'. 'at' is this
//            server's clock. 'note' is ciphertext too.
// It never keeps: the plaintext (supplier, amount, names, summary text), the encryption key (it lives only in the link's
// #fragment, which browsers do not send), a raw token, an IP address or user agent with the link, or any log. Both keys
// expire together after LINK_TTL_HOURS (default 168 = 7 days) by the store's own expiry; the event never outlives its link.
// A raw token IS sent to the server each time the link is used (that is how a bearer code works); the server compares its
// SHA-256 to the stored hash and discards it. Separately, the per-instance rate limiter in app.js holds the caller's address
// in process memory only (up to 1 h for creating, 10 min for using); it is never written to the store or to a log.
//
// Anyone holding a link can use it: there are no accounts, so this cannot prove WHO pressed a button.
import { createHash, timingSafeEqual } from 'node:crypto';
import { requiresSharedStore } from './deployment-env.js';

export const DEFAULT_TTL_HOURS = 168;
export const LIMITS = Object.freeze({ maxCiphertext: 6000, maxNoteCiphertext: 1200, ivChars: 16 });
const ID = /^[A-Za-z0-9_-]{16}$/;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const HEX = /^[0-9a-f]{64}$/;
const B64U = /^[A-Za-z0-9_-]+$/;
const KINDS = Object.freeze({ check: { decisions: ['approved', 'rejected'] }, handoff: { decisions: ['acknowledged'] } });

const sha = (text) => createHash('sha256').update(String(text)).digest();
const same = (a, b) => timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

export function createLinkMemoryStore({ now = () => Date.now() } = {}) {
  const map = new Map(); let lastSweep = now();
  // Expired entries are removed when touched and, at the latest, one minute after they expire (a sweep on every call after that).
  const sweep = () => { if (now() - lastSweep < 60_000) return; lastSweep = now(); for (const [key, item] of map) if (item.expiresAt <= now()) map.delete(key); };
  const live = (key) => { sweep(); const item = map.get(key); if (!item) return null; if (item.expiresAt <= now()) { map.delete(key); return null; } return item; };
  return {
    kind: 'memory',
    async get(key) { return live(key)?.value ?? null; },
    async setIfAbsent(key, value, ttlSeconds) {
      if (live(key)) return false;
      map.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      return true;
    },
    // test aid only: what is physically held
    dump() { return [...map.entries()].map(([key, item]) => ({ key, value: item.value })); },
  };
}

// Any Redis-compatible HTTP store speaking the Upstash REST pipeline protocol. Created only when its URL and token are in the
// server environment. Any failure THROWS, which the service turns into a refusal (fail closed).
export function createLinkRestStore({ url, token, fetchImpl = globalThis.fetch }) {
  const base = String(url).replace(/\/+$/, '');
  const run = async (commands) => {
    const response = await fetchImpl(`${base}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('link store error');
    const out = await response.json();
    if (!Array.isArray(out) || out.some((item) => item?.error)) throw new Error('link store error');
    return out;
  };
  return {
    kind: 'rest',
    async get(key) { return (await run([['GET', key]]))[0]?.result ?? null; },
    async setIfAbsent(key, value, ttlSeconds) { return (await run([['SET', key, value, 'EX', String(Math.max(1, ttlSeconds)), 'NX']]))[0]?.result === 'OK'; },
  };
}

export function createLinkStoreFromEnv(env = process.env, { fetchImpl, now } = {}) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token && /^https:\/\//.test(url)) return { store: createLinkRestStore({ url, token, fetchImpl }), sharedRequired: false };
  // On a serverless host a memory store is per instance, so links would vanish at random: refuse instead of pretending.
  return { store: createLinkMemoryStore({ now }), sharedRequired: requiresSharedStore(env) };
}

const reply = (status, body) => ({ status, body });
const notFound = () => reply(404, { error: 'not_found' }); // the same answer for a wrong id, a wrong token and an expired link

export function createLinkService({ store, sharedRequired = false, now = () => Date.now(), ttlHours = DEFAULT_TTL_HOURS } = {}) {
  const ttlMs = Math.min(Math.max(Number(ttlHours) || DEFAULT_TTL_HOURS, 1), 168) * 3_600_000;
  const remainingSeconds = (rec) => Math.max(1, Math.ceil((rec.expiresAt - now()) / 1000));

  async function load(id, token) {
    if (!ID.test(id ?? '') || !TOKEN.test(token ?? '')) return null;
    const raw = await store.get(`l:${id}`); if (!raw) return null;
    let rec; try { rec = JSON.parse(raw); } catch { return null; }
    if (!rec || rec.expiresAt <= now()) return null;
    const hash = sha(token).toString('hex');
    const role = same(hash, rec.oh) ? 'o' : same(hash, rec.ch) ? 'c' : null;
    return role ? { rec, role } : null;
  }
  const eventOf = async (id) => { const raw = await store.get(`e:${id}`); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };
  const statusOf = (rec, event) => (rec.kind === 'check' ? (event ? event.status : 'pending') : (event ? 'acknowledged' : 'sent'));

  async function create(body) {
    const { kind, id, oh, ch, ct, iv } = body;
    if (typeof kind !== 'string' || !Object.hasOwn(KINDS, kind)) return reply(400, { error: 'bad_request' });
    if (typeof id !== 'string' || !ID.test(id) || typeof oh !== 'string' || !HEX.test(oh) || typeof ch !== 'string' || !HEX.test(ch) || oh === ch) return reply(400, { error: 'bad_request' });
    if (typeof ct !== 'string' || !B64U.test(ct) || ct.length > LIMITS.maxCiphertext || ct.length < 24) return reply(400, { error: 'bad_request' });
    if (typeof iv !== 'string' || !B64U.test(iv) || iv.length !== LIMITS.ivChars) return reply(400, { error: 'bad_request' });
    const createdAt = now(); const expiresAt = createdAt + ttlMs;
    const record = { v: 1, kind, ct, iv, oh, ch, createdAt, expiresAt };
    const first = await store.setIfAbsent(`l:${id}`, JSON.stringify(record), Math.ceil(ttlMs / 1000));
    if (first) return reply(201, { ok: true, id, createdAt, expiresAt });
    // The same id again: a retry or a double click is fine; a different record under the same id is refused.
    const existing = JSON.parse((await store.get(`l:${id}`)) ?? 'null');
    if (existing && existing.kind === kind && existing.ct === ct && existing.iv === iv && existing.oh === oh && existing.ch === ch) return reply(200, { ok: true, duplicate: true, id, createdAt: existing.createdAt, expiresAt: existing.expiresAt });
    return reply(409, { error: 'conflict' });
  }

  async function read(body) {
    const found = await load(body.id, body.token); if (!found) return notFound();
    const event = await eventOf(body.id);
    return reply(200, { ok: true, id: body.id, kind: found.rec.kind, role: found.role, ct: found.rec.ct, iv: found.rec.iv, createdAt: found.rec.createdAt, expiresAt: found.rec.expiresAt, status: statusOf(found.rec, event), event: event ?? null });
  }

  async function act(body, op) {
    const found = await load(body.id, body.token); if (!found) return notFound();
    if (found.role !== 'c') return reply(403, { error: 'not_allowed' }); // only the person the link was made for can act
    const allowed = KINDS[found.rec.kind].decisions;
    const status = op === 'ack' ? 'acknowledged' : body.decision;
    if (typeof status !== 'string' || !allowed.includes(status) || (op === 'ack') !== (found.rec.kind === 'handoff')) return reply(400, { error: 'bad_request' });
    let note;
    if (body.note !== undefined && body.note !== null) {
      const n = body.note;
      if (!n || typeof n !== 'object' || typeof n.ct !== 'string' || typeof n.iv !== 'string' || !B64U.test(n.ct) || n.ct.length > LIMITS.maxNoteCiphertext || n.ct.length < 24 || !B64U.test(n.iv) || n.iv.length !== LIMITS.ivChars) return reply(400, { error: 'bad_request' });
      note = { ct: n.ct, iv: n.iv };
    }
    const event = { v: 1, status, at: now(), ...(note ? { note } : {}) };
    // One atomic claim: the FIRST valid action wins and nothing can change it afterwards.
    if (await store.setIfAbsent(`e:${body.id}`, JSON.stringify(event), remainingSeconds(found.rec))) return reply(200, { ok: true, status, at: event.at });
    const existing = await eventOf(body.id);
    if (existing && existing.status === status) return reply(200, { ok: true, duplicate: true, status: existing.status, at: existing.at });
    return reply(409, { error: 'already_decided', status: existing?.status ?? null, at: existing?.at ?? null });
  }

  return {
    store: store.kind, ttlHours: ttlMs / 3_600_000,
    async handle(body) {
      if (sharedRequired && store.kind === 'memory') return reply(503, { error: 'links_unavailable' });
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'bad_request' });
      try {
        if (body.op === 'create') return await create(body);
        if (body.op === 'read') return await read(body);
        if (body.op === 'decide') return await act(body, 'decide');
        if (body.op === 'ack') return await act(body, 'ack');
        return reply(400, { error: 'bad_request' });
      } catch { return reply(503, { error: 'links_unavailable' }); }
    },
  };
}
