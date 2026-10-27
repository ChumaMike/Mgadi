// Shared counters for abuse and cost control. Serverless instances do not share memory, so a limit kept in a Map is only
// a per-instance speed bump. This module gives the voice service one interface with two implementations:
//   - memory: fine for a single local process and for tests; NOT a global limit on Vercel.
//   - REST:   any Redis-compatible HTTP store that speaks the Upstash REST protocol (Upstash, Vercel KV). It is used only
//             when its URL and token exist in the server environment. Nothing here provisions or pays for anything.
// Keys never contain raw visitor addresses: they are hashed first. A store failure DENIES the request (fail closed).
import { createHash, timingSafeEqual } from 'node:crypto';

export const hashId = (value, salt = '') => createHash('sha256').update(`${salt}|${String(value)}`).digest('hex').slice(0, 24);

export function safeEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

export function createMemoryStore({ now = () => Date.now() } = {}) {
  const map = new Map();
  return {
    kind: 'memory',
    async incrBy(key, amount, ttlMs) {
      const t = now();
      const current = map.get(key);
      if (!current || current.expiresAt <= t) { map.set(key, { value: amount, expiresAt: t + ttlMs }); }
      else current.value += amount;
      if (map.size > 5000) for (const [k, v] of map) if (v.expiresAt <= t) map.delete(k);
      return map.get(key).value;
    },
  };
}

export function createRestStore({ url, token, fetchImpl = globalThis.fetch }) {
  const base = String(url).replace(/\/+$/, '');
  return {
    kind: 'rest',
    async incrBy(key, amount, ttlMs) {
      const seconds = Math.max(1, Math.ceil(ttlMs / 1000));
      // SET ... NX creates the window once; INCRBY then counts inside it.
      const response = await fetchImpl(`${base}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([['SET', key, '0', 'EX', String(seconds), 'NX'], ['INCRBY', key, String(amount)]]),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error('quota store error');
      const out = await response.json();
      const value = out?.[1]?.result;
      if (!Number.isFinite(Number(value)) || out?.[1]?.error) throw new Error('quota store error');
      return Number(value);
    },
  };
}

export function createStoreFromEnv(env = process.env, { fetchImpl = globalThis.fetch, now } = {}) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token && /^https:\/\//.test(url)) return createRestStore({ url, token, fetchImpl });
  return createMemoryStore({ now });
}

// Take every claim or none. Each claim is { key, amount, limit, ttlMs }. A claim over its limit is rolled back, and so
// are the earlier claims in the same call, so a refused request never uses up anyone's allowance.
export async function consumeAll(store, claims) {
  const taken = [];
  try {
    for (const claim of claims) {
      const used = await store.incrBy(claim.key, claim.amount, claim.ttlMs);
      taken.push(claim);
      if (used > claim.limit) { await rollback(store, taken); return { ok: false, reason: 'limit', key: claim.key }; }
    }
    return { ok: true };
  } catch {
    await rollback(store, taken);
    return { ok: false, reason: 'store' };
  }
}
async function rollback(store, claims) {
  for (const claim of claims) { try { await store.incrBy(claim.key, -claim.amount, claim.ttlMs); } catch { /* the window expires on its own */ } }
}
