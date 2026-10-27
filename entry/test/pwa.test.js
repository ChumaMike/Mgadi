import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { inflateSync } from 'node:zlib';
import { createApp } from '../server/app.js';
import { buildPrecacheManifest, MAX_TOTAL_BYTES } from '../server/precache.js';
import { describe, readSavedCopy, STALE_AFTER_DAYS } from '../public/offline/register.js';
import { drawIcon, encodePng, writeIcons } from '../scripts/make-icons.mjs';

const publicDir = fileURL('../public');
function fileURL(p) { return new URL(p, import.meta.url).pathname; }
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const tmpCopy = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgadi-pwa-')); fs.cpSync(publicDir, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}vendor`) }); return dir; };

test('the offline manifest lists every public file with its real SHA-256, and a version that follows the files only', async () => {
  const manifest = await buildPrecacheManifest(publicDir, { builtAt: 1_700_000_000_000 });
  assert.match(manifest.version, /^[a-f0-9]{12}$/);
  for (const asset of manifest.assets) {
    const file = asset.url === '/' ? '/index.html' : asset.url;
    const bytes = fs.readFileSync(path.join(publicDir, file));
    assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'), asset.url);
    assert.equal(asset.bytes, bytes.length);
  }
  const index = manifest.assets.find((a) => a.url === '/index.html');
  assert.equal(manifest.assets.find((a) => a.url === '/').sha256, index.sha256, '"/" is the same app shell as /index.html');
  const again = await buildPrecacheManifest(publicDir, { builtAt: 1_800_000_000_000 });
  assert.equal(again.version, manifest.version, 'the build time is not part of the version (reproducible)');
  assert.deepEqual(again.assets, manifest.assets);
  assert.ok(manifest.totalBytes < MAX_TOTAL_BYTES);
});

test('the offline manifest contains what the emergency journey needs, and nothing it must not hold', async () => {
  const urls = (await buildPrecacheManifest(publicDir)).assets.map((a) => a.url);
  for (const needed of ['/', '/index.html', '/app.js', '/styles.css', '/data/playbook.json', '/data/fraud-lines.json', '/data/resources.json', '/shared/rules.js', '/shared/pack.js', '/shared/sha256.js', '/shared/redact.js', '/manifest.webmanifest', '/icons/icon.svg', '/voice/panel.js', '/offline/register.js']) assert.ok(urls.includes(needed), needed);
  for (const url of urls) {
    assert.ok(url.startsWith('/') && !url.startsWith('//') && !url.includes('..') && !url.includes('?'), url);
    assert.doesNotMatch(url, /^\/(?:api|vendor)\//, 'the voice engine and API routes are never saved');
    assert.doesNotMatch(url, /sw\.js|precache-manifest/, 'the worker and the manifest are not their own contents');
    assert.doesNotMatch(url, /\.(?:env|pem|key|map|log)$|private|secret|token/i);
  }
  assert.deepEqual([...urls].sort(), urls.filter((u) => u !== '/').sort().concat('/').sort(), 'no duplicates');
});

test('the version changes when any file changes, and a missing or extra file is noticed', async () => {
  const dir = tmpCopy();
  const before = await buildPrecacheManifest(dir);
  fs.appendFileSync(path.join(dir, 'app.js'), '\n// changed');
  const after = await buildPrecacheManifest(dir);
  assert.notEqual(after.version, before.version);
  assert.notEqual(after.assets.find((a) => a.url === '/app.js').sha256, before.assets.find((a) => a.url === '/app.js').sha256);
  fs.writeFileSync(path.join(dir, 'extra.json'), '{}');
  assert.equal((await buildPrecacheManifest(dir)).assets.length, before.assets.length + 1);
  fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true }); fs.writeFileSync(path.join(dir, 'vendor', 'big.js'), 'x'.repeat(10));
  assert.equal((await buildPrecacheManifest(dir)).assets.some((a) => a.url.startsWith('/vendor')), false, 'vendor stays out');
  fs.writeFileSync(path.join(dir, 'huge.json'), 'x'.repeat(MAX_TOTAL_BYTES));
  await assert.rejects(buildPrecacheManifest(dir), /over the .* budget/);
});

test('sw.js source: files are saved only at install, there is no runtime caching, and private routes are never touched', () => {
  const sw = read('../public/sw.js');
  const install = sw.slice(sw.indexOf('async function installAssets'), sw.indexOf("self.addEventListener('install'"));
  const puts = [...sw.matchAll(/\.put\(/g)].length;
  assert.equal(puts, 2, 'only the two puts in installAssets: each asset, and the manifest');
  assert.equal([...install.matchAll(/\.put\(/g)].length, 2, 'both puts are inside installAssets');
  assert.doesNotMatch(sw, /cache\.add\(|addAll\(/);
  const respond = sw.slice(sw.indexOf('async function respond'));
  assert.doesNotMatch(respond, /\.put\(|caches\.open\(/, 'the fetch path never writes to, or creates, a cache');
  assert.match(sw, /request\.method !== 'GET' \|\| request\.headers\.has\('range'\)/);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.match(sw, /BYPASS = \['\/api\/', '\/vendor\/'\]/);
  assert.match(sw, /url\.pathname === MANIFEST_URL \|\| BYPASS\.some/);
  assert.match(sw, /integrity mismatch/); assert.match(sw, /await caches\.delete\(CACHE\); throw error;/, 'a failed install deletes the half-built cache');
  assert.match(sw, /fetched\.type !== 'basic' \|\| fetched\.redirected/, 'no redirects or cross-origin bodies are saved');
  assert.match(sw, /self\.registration\.active \? undefined : self\.skipWaiting\(\)/, 'an update waits; only the first install takes over');
  assert.match(sw, /manifest\.version !== VERSION/);
  assert.doesNotMatch(sw, /innerHTML|eval\(|importScripts|new Function/);
  assert.doesNotMatch(sw, /localStorage|indexedDB|sessionStorage/);
  // Original response headers (the CSP above all) are kept when a file is saved.
  assert.match(sw, /new Headers\(fetched\.headers\)/);
});

test('the status text is honest in every state, and says when a saved copy may be out of date', () => {
  const copy = { builtAt: '2026-10-27T10:00:00.000Z', fraudCheckedOn: '2026-10-26', version: 'a'.repeat(12) };
  const now = Date.parse('2026-10-28T10:00:00Z');
  assert.match(describe({ state: 'ready', copy, online: true, now }), /^Ready offline\. Guide saved on 2026-10-27\. Bank numbers were last checked on 2026-10-26\./);
  const off = describe({ state: 'ready', copy, online: false, now });
  assert.match(off, /You are offline/); assert.match(off, /Live AI voice and outside links need internet/); assert.match(off, /incident pack still work/);
  const old = describe({ state: 'ready', copy, online: true, now: now + STALE_AFTER_DAYS * 86_400_000 });
  assert.match(old, /days old/); assert.match(old, /may be out of date/);
  assert.match(describe({ state: 'ready', copy, online: true, persisted: false, now }), /can still clear this copy/);
  assert.match(describe({ state: 'update', copy, online: true, now }), /newer version is ready and will be used the next time/);
  for (const state of ['saving', 'failed', 'incomplete', 'unsupported', 'insecure', 'none']) {
    const text = describe({ state, copy: null, online: false, now });
    assert.match(text, /^You are offline\./, state); assert.doesNotMatch(text, /Ready offline\.|still work from the saved copy/, `${state} must never claim to be ready`);
  }
  assert.match(describe({ state: 'incomplete', copy: null, online: true }), /being saved again/);
  assert.match(describe({ state: 'insecure', copy: null, online: true }), /HTTPS/);
});

function fakeCaches(files) {
  const store = new Map(Object.entries(files).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  return {
    keys: async () => [...store.keys()],
    open: async (name) => { const entries = store.get(name); return { match: async (url) => (entries.has(url) ? { json: async () => JSON.parse(entries.get(url)) } : undefined), keys: async () => [...entries.keys()].map((u) => ({ url: `http://x${u}` })) }; },
  };
}
test('reading the saved copy: ready, incomplete (some file gone), or none', async () => {
  const manifest = JSON.stringify({ version: 'b'.repeat(12), builtAt: '2026-10-27T10:00:00.000Z', assets: [{ url: '/' }, { url: '/app.js' }, { url: '/data/fraud-lines.json' }] });
  const full = { 'mgadi-shell-bbb': { '/precache-manifest.json': manifest, '/': '1', '/app.js': '2', '/data/fraud-lines.json': JSON.stringify({ checkedOn: '2026-10-26' }) } };
  const ready = await readSavedCopy({ caches: fakeCaches(full) });
  assert.deepEqual([ready.state, ready.fraudCheckedOn, ready.version], ['ready', '2026-10-26', 'b'.repeat(12)]);
  const missing = structuredClone(full); delete missing['mgadi-shell-bbb']['/app.js'];
  const partial = await readSavedCopy({ caches: fakeCaches(missing) });
  assert.deepEqual([partial.state, partial.missing], ['incomplete', 1]);
  assert.equal((await readSavedCopy({ caches: fakeCaches({ 'other-site': {} }) })).state, 'none');
  assert.equal((await readSavedCopy({ caches: fakeCaches({ 'mgadi-shell-x': { '/': '1' } }) })).state, 'incomplete', 'a cache with no manifest is not trusted');
  assert.equal((await readSavedCopy({ caches: undefined })).state, 'none');
});

test('web app manifest: installable, same-origin, matching the page colour, with real icons', () => {
  const manifest = JSON.parse(read('../public/manifest.webmanifest'));
  const html = read('../public/index.html');
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/'); assert.equal(manifest.display, 'standalone');
  assert.match(manifest.name, /Mgadi/); assert.equal(manifest.short_name, 'Mgadi');
  assert.equal(manifest.theme_color, html.match(/name="theme-color" content="(#[0-9a-f]{6})"/i)[1]);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/); assert.match(html, /rel="apple-touch-icon"/);
  const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
  assert.ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'));
  for (const icon of manifest.icons) { assert.ok(icon.src.startsWith('/icons/')); assert.doesNotMatch(icon.src, /^https?:|\/\//); }
  assert.doesNotMatch(JSON.stringify(manifest), /https?:/);
  assert.match(read('../public/icons/icon.svg'), /#123c35/);
});

test('the generated icons are real PNGs of the right size, and drawing them is deterministic', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgadi-icons-'));
  const names = writeIcons(dir);
  assert.deepEqual(names.sort(), ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']);
  const dims = { 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512, 'apple-touch-icon.png': 180 };
  for (const name of names) {
    const png = fs.readFileSync(path.join(dir, name));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), dims[name]); assert.equal(png.readUInt32BE(20), dims[name]);
    assert.equal(png.subarray(png.length - 12, png.length - 8).readUInt32BE(0), 0, 'IEND');
    const raw = inflateSync(Buffer.concat([...(() => { const out = []; let i = 8; while (i < png.length) { const len = png.readUInt32BE(i); if (png.subarray(i + 4, i + 8).toString() === 'IDAT') out.push(png.subarray(i + 8, i + 8 + len)); i += 12 + len; } return out; })()]));
    assert.equal(raw.length, (dims[name] * 3 + 1) * dims[name]);
  }
  assert.ok(drawIcon(64).equals(drawIcon(64)));
  assert.ok(encodePng(8, drawIcon(8)).equals(encodePng(8, drawIcon(8))));
  assert.ok(!drawIcon(64).equals(drawIcon(64, { maskable: true })), 'the maskable icon has a safe-zone layout');
});

test('server: the manifest is computed live, static files revalidate, API replies never cache, and the worker is served as a script', async (t) => {
  const app = createApp({}); app.listen(0, '127.0.0.1'); await once(app, 'listening'); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}`;
  const live = await (await fetch(`${base}/precache-manifest.json`)).json();
  assert.equal(live.version, (await buildPrecacheManifest(publicDir)).version);
  const manifestResponse = await fetch(`${base}/precache-manifest.json`);
  assert.equal(manifestResponse.headers.get('cache-control'), 'no-store');
  const sw = await fetch(`${base}/sw.js`);
  assert.match(sw.headers.get('content-type'), /javascript/); assert.equal(sw.headers.get('cache-control'), 'no-cache');
  assert.match((await fetch(`${base}/manifest.webmanifest`)).headers.get('content-type'), /manifest\+json/);
  assert.match((await fetch(`${base}/icons/icon.svg`)).headers.get('content-type'), /image\/svg\+xml/);
  assert.equal((await fetch(`${base}/api/health`)).headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${base}/api/voice/config`)).headers.get('cache-control'), 'no-store');
  const page = await fetch(`${base}/`);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(page.headers.get('permissions-policy'), /microphone=\(self\)/);
});
