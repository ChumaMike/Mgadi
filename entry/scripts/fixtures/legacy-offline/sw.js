// Mgadi service worker: an offline copy of PUBLIC, static, reviewed files only. It is registered as /sw.js?v=<version> so a new
// version is a new script URL and the browser installs it. Rules, each enforced by test/pwa.test.js and scripts/pwa-smoke.mjs:
//  - Files are saved ONLY at install, all-or-nothing, each checked against the SHA-256 in /precache-manifest.json. A failure
//    deletes the half-built cache and fails the install, so the previous working version keeps running (rollback).
//  - There is NO runtime caching. Nothing the person types, no API reply, no voice session, no evidence and no pack is ever stored.
//  - /api/, /vendor/, non-GET, ranged and cross-origin requests are never touched.
//  - Each cached response keeps the server's security headers, so the offline page still runs under the same CSP.
//  - A waiting update never takes over a screen that is open; it is used the next time Mgadi is opened.
const PREFIX = 'mgadi-shell-';
const VERSION = new URL(self.location.href).searchParams.get('v') || '';
const CACHE = `${PREFIX}${VERSION}`;
const MANIFEST_URL = '/precache-manifest.json';
const BYPASS = ['/api/', '/vendor/'];
const DROP_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie', 'set-cookie2'];

const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (buffer) => toHex(await crypto.subtle.digest('SHA-256', buffer));

function validManifest(manifest) {
  return Boolean(manifest) && /^[a-f0-9]{12}$/.test(manifest.version) && Array.isArray(manifest.assets) && manifest.assets.length > 0 && manifest.assets.length < 300
    && manifest.assets.every((a) => typeof a.url === 'string' && a.url.startsWith('/') && !a.url.startsWith('//') && !a.url.includes('..') && !a.url.includes('?') && !BYPASS.some((p) => a.url.startsWith(p)) && /^[a-f0-9]{64}$/.test(a.sha256));
}

async function installAssets() {
  if (!/^[a-f0-9]{12}$/.test(VERSION)) throw new Error('no version in the script URL');
  const response = await fetch(MANIFEST_URL, { cache: 'reload' });
  if (!response.ok) throw new Error('manifest unavailable');
  const text = await response.text();
  const manifest = JSON.parse(text);
  if (!validManifest(manifest) || manifest.version !== VERSION) throw new Error('manifest does not match this version');
  await caches.delete(CACHE);
  const cache = await caches.open(CACHE);
  try {
    for (let i = 0; i < manifest.assets.length; i += 6) {
      await Promise.all(manifest.assets.slice(i, i + 6).map(async (asset) => {
        const fetched = await fetch(asset.url, { cache: 'reload' });
        if (!fetched.ok || fetched.type !== 'basic' || fetched.redirected) throw new Error(`bad response for ${asset.url}`);
        const body = await fetched.arrayBuffer();
        if (await sha256(body) !== asset.sha256) throw new Error(`integrity mismatch for ${asset.url}`);
        const headers = new Headers(fetched.headers);
        for (const name of DROP_HEADERS) headers.delete(name);
        await cache.put(asset.url, new Response(body, { status: 200, headers }));
      }));
    }
    await cache.put(MANIFEST_URL, new Response(text, { headers: { 'content-type': 'application/json' } }));
  } catch (error) { await caches.delete(CACHE); throw error; }
}

self.addEventListener('install', (event) => {
  // First ever install: take over at once so the very first visit becomes offline-ready. An UPDATE waits instead.
  event.waitUntil(installAssets().then(() => (self.registration.active ? undefined : self.skipWaiting())));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'STATUS') event.source?.postMessage({ type: 'STATUS', version: VERSION, cache: CACHE });
  // The browser may clear the saved files while this worker stays registered. The page can then ask it to save them again.
  // This runs the same all-or-nothing, hash-checked install; it is not runtime caching of anything the person did.
  if (event.data?.type === 'REPAIR') {
    const reply = (type) => (event.source ?? self.clients).postMessage?.({ type });
    event.waitUntil(installAssets().then(() => reply('REPAIRED'), () => reply('REPAIR_FAILED')));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === MANIFEST_URL || BYPASS.some((prefix) => url.pathname.startsWith(prefix))) return;
  event.respondWith(respond(request, url));
});

async function respond(request, url) {
  // caches.match with cacheName never creates an empty cache, so an evicted cache is reported as missing, not "ready".
  const saved = await caches.match(url.pathname, { cacheName: CACHE });
  if (saved) return saved;
  try { return await fetch(request); } catch {
    if (request.mode === 'navigate') { const shell = await caches.match('/', { cacheName: CACHE }); if (shell) return shell; }
    return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
