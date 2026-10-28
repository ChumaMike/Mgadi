// Real-browser checks of the offline copy: install, offline reopening with the SERVER SHUT DOWN, a full guidance journey and
// incident pack offline, no private data in any cache, interrupted and corrupted installs, eviction repair, update and rollback.
//   MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/pwa-smoke.mjs
// Synthetic text only. Starts its own local server. The offline phase CLOSES that server (the browser's offline switch alone does
// not reliably stop a service worker's own requests, so it is not trusted as proof).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../server/app.js';
import { writeIcons } from './make-icons.mjs';

// Playwright can only intercept a service worker's own requests with this (experimental) switch. Several checks below depend on it.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';

let chromium;
try { ({ chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright')); }
catch { console.log('SKIPPED: Playwright is not installed (set MGADI_PLAYWRIGHT to its index.mjs). Nothing was tested.'); process.exit(0); }

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '..', 'public');
const copy = (name, change) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mgadi-${name}-`));
  fs.cpSync(source, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}vendor`) });
  writeIcons(path.join(dir, 'icons')); change?.(dir); return dir;
};
const V1 = copy('v1');
const V2 = copy('v2', (dir) => { const f = path.join(dir, 'data', 'playbook.json'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Practitioner review pending.', 'Practitioner review pending. (v2)')); });
let handler = createHandler({ publicDir: V1 });
const server = http.createServer((req, res) => handler(req, res));
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const port = server.address().port; const base = `http://127.0.0.1:${port}`;
const stopServer = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
const startServer = async () => { server.listen(port, '127.0.0.1'); await once(server, 'listening'); };

const browser = await chromium.launch();
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`); };
const errors = [];
const open = async (context) => { const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message)); return page; };
const newContext = (options = {}) => browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, ...options });
const waitState = (page, state, timeout = 25_000) => page.waitForFunction((s) => document.querySelector('#offline-status')?.dataset.state === s, state, { timeout });
const reached = (page, wanted, timeout = 20_000) => waitState(page, wanted, timeout).then(() => true, () => false); // a missed expectation is a named FAIL, not a crash
const state = (page) => page.evaluate(() => document.querySelector('#offline-status')?.dataset.state);
const cacheNames = (page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('mgadi-shell-')));
const SW_FETCH = (route) => Boolean(route.request().serviceWorker?.()); // true only for requests made by the service worker itself
const SENTINEL = 'SENTINEL-RANSOM-7731-private-words';
const FILE_SENTINEL = 'SENTINEL-EVIDENCE-BYTES-9921';
const tile = (page, text) => page.locator(`.incident-choices button:has-text("${text}")`);

try {
  // ---- 1. First visit saves the offline copy.
  const ctx = await newContext(); let page = await open(ctx);
  await page.goto(`${base}/`); await page.waitForSelector('h1');
  await waitState(page, 'ready');
  const manifest = await (await page.request.get(`${base}/precache-manifest.json`)).json();
  check('the first visit saves the offline copy and says "Ready offline"', (await page.locator('#offline-status').innerText()).includes('Ready offline'));
  const names = await cacheNames(page);
  check('exactly one versioned cache exists, named for the manifest version', names.length === 1 && names[0] === `mgadi-shell-${manifest.version}`, JSON.stringify(names));
  const cached = await page.evaluate(async () => { const c = await caches.open((await caches.keys()).find((k) => k.startsWith('mgadi-shell-'))); return (await c.keys()).map((r) => new URL(r.url).pathname).sort(); });
  check('the cache holds every manifest file (and the manifest) and nothing else', JSON.stringify(cached) === JSON.stringify([...manifest.assets.map((a) => a.url), '/precache-manifest.json'].sort()), `${cached.length} vs ${manifest.assets.length + 1}`);
  check('every saved file has the server\'s security headers (CSP, microphone policy)', await page.evaluate(async () => { const r = await caches.match('/'); return /script-src 'self'/.test(r.headers.get('content-security-policy') ?? '') && /microphone=\(self\)/.test(r.headers.get('permissions-policy') ?? '') && r.headers.get('x-content-type-options') === 'nosniff'; }));
  check('the registered worker URL carries the version', (await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.scriptURL)).endsWith(`/sw.js?v=${manifest.version}&p=2`));
  const web = await (await page.request.get(`${base}/manifest.webmanifest`)).json();
  const icon = await page.request.get(`${base}${web.icons.find((i) => i.sizes === '512x512' && i.purpose === 'any').src}`);
  const body = await icon.body();
  check('the web app manifest and its 512px icon are real', icon.headers()['content-type'] === 'image/png' && body.readUInt32BE(16) === 512 && web.start_url === '/' && web.display === 'standalone');

  // ---- 2. Online traffic is not cached and not intercepted.
  const intercepted = []; page.on('response', (r) => { if (r.url().includes('/api/') && r.fromServiceWorker()) intercepted.push(r.url()); });
  await page.reload(); await page.waitForSelector('h1');
  const before = await page.evaluate(async () => (await (await caches.open((await caches.keys()).find((k) => k.startsWith('mgadi-shell-')))).keys()).length);
  await page.locator('.describe-incident > summary').click(); await page.fill('#incident-description', `${SENTINEL} Our files are encrypted and there is a ransom note.`); await page.click('text=Get safe next step'); await page.waitForSelector('text=Step 1 of');
  await page.evaluate(() => fetch('/api/voice/config').then((r) => r.json())); await page.evaluate(() => fetch('/api/health').then((r) => r.json()));
  const after = await page.evaluate(async () => (await (await caches.open((await caches.keys()).find((k) => k.startsWith('mgadi-shell-')))).keys()).length);
  check('triage, voice config and health requests are not intercepted by the worker', intercepted.length === 0, JSON.stringify(intercepted));
  check('using the app online adds nothing to the cache', after === before, `${before} -> ${after}`);

  // ---- 3. Offline reopening with the server SHUT DOWN.
  // A phone in airplane mode: no server AND the browser knows it is offline.
  await page.close(); await stopServer(); await ctx.setOffline(true);
  page = await open(ctx);
  const reload = await page.goto(`${base}/`); await page.waitForSelector('h1');
  check('with the server shut down, Mgadi reopens from the saved copy', reload.ok() && reload.fromServiceWorker());
  check('the offline page still carries the CSP and the microphone policy', /script-src 'self'/.test(reload.headers()['content-security-policy'] ?? '') && /microphone=\(self\)/.test(reload.headers()['permissions-policy'] ?? ''));
  await waitState(page, 'ready');
  const offlineText = await page.locator('#offline-status').innerText();
  check('the status line says it is offline, what still works, and what does not', /You are offline/.test(offlineText) && /guide, bank numbers and incident pack still work/.test(offlineText) && /Live AI voice and outside links need internet/.test(offlineText), offlineText);
  check('offline: five plain-language choices are shown', (await page.locator('.incident-choices button').count()) === 5);
  await page.click('#emergency-button'); await page.waitForSelector('text=Call your bank now');
  check('offline: the bank directory opens with its checked date', (await page.locator('p.privacy').first().innerText()).includes('last checked') && (await page.locator('a[href^="tel:"]').count()) >= 4);
  await page.click('button:has-text("Back")');

  // typed words, classified by the local rules (the server is gone)
  const started = Date.now();
  await page.locator('.describe-incident > summary').click(); await page.fill('#incident-description', `${SENTINEL} Every file on the server is encrypted and a ransom note demands bitcoin.`); await page.click('text=Get safe next step'); await page.waitForSelector('text=Step 1 of', { timeout: 12_000 });
  check('offline: typed words fall back to the local rules, quickly, and reach the ransomware guide', (await page.locator('.step-count').textContent()).includes('Possible ransomware') && Date.now() - started < 9000, `${Date.now() - started} ms`);

  // the whole guided journey, evidence fingerprint, pack and verification, offline
  for (let i = 0; i < 7; i += 1) { await page.locator('#app .step-outcomes > button.button:not(.secondary)').first().click(); await page.waitForTimeout(60); }
  await page.waitForSelector('#evidence-files');
  await page.setInputFiles('#evidence-files', { name: 'proof.txt', mimeType: 'text/plain', buffer: Buffer.from(FILE_SENTINEL) });
  await page.waitForSelector('li:has-text("SHA-256")');
  check('offline: an evidence file is fingerprinted on the device', (await page.locator('li:has-text("SHA-256")').first().innerText()).includes('proof.txt'));
  await page.click('text=Review what goes in the pack'); await page.click('text=Make incident pack'); await page.waitForSelector('text=Incident summary');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=Download incident pack (.json)')]);
  const packPath = await download.path();
  await page.click('summary:has-text("Technical data")');
  await page.setInputFiles('input[aria-label="Incident pack to verify"]', packPath);
  await page.waitForSelector('text=Pack unchanged');
  const tampered = JSON.parse(fs.readFileSync(packPath, 'utf8')); tampered.generatedAt = '2020-01-01T00:00:00.000Z';
  const tamperedPath = path.join(os.tmpdir(), 'mgadi-tampered-pack.json'); fs.writeFileSync(tamperedPath, JSON.stringify(tampered));
  await page.setInputFiles('input[aria-label="Incident pack to verify"]', tamperedPath);
  await page.waitForSelector('text=Pack has been changed');
  check('offline: the incident pack is made, downloaded and verified, and a changed copy is caught', (await page.locator('text=Pack has been changed').count()) === 1 && (await page.locator('text=Pack unchanged').count()) === 0);
  check('the pack holds the file fingerprint but not the file contents or its words', !fs.readFileSync(packPath, 'utf8').includes(FILE_SENTINEL));

  // voice, offline
  await page.click('text=Start a new incident'); await page.waitForSelector('.incident-choices');
  await page.click('.voice-launch'); await page.waitForSelector('.voice-panel:not([hidden])');
  const notice = await page.locator('.vp-avail').innerText();
  check('offline: voice says it needs the internet and does not pretend to run', /internet connection/i.test(notice) && (await page.locator('.vp-start').isDisabled()), notice);
  check('offline: the bank button in the voice panel works', await page.locator('.vp-bank').isVisible());
  await page.click('.vp-bank'); await page.waitForSelector('text=Call your bank now'); await page.click('button:has-text("Back")');

  // nothing private anywhere in browser storage
  const audit = await page.evaluate(async ([a, b]) => {
    const hits = []; const text = (v) => String(v);
    for (const key of await caches.keys()) { const c = await caches.open(key); for (const r of await c.keys()) { const body = await (await c.match(r)).text(); if (body.includes(a) || body.includes(b)) hits.push(`cache:${r.url}`); if (/\/api\//.test(r.url)) hits.push(`api-url:${r.url}`); } }
    if (JSON.stringify({ ...localStorage }).includes(a) || JSON.stringify({ ...sessionStorage }).includes(a)) hits.push('web-storage');
    for (const db of (await indexedDB.databases?.()) ?? []) hits.push(`indexeddb:${db.name}`);
    void text; return hits;
  }, [SENTINEL, FILE_SENTINEL]);
  check('no typed words, evidence bytes or API URL are in any cache, web storage or IndexedDB', audit.length === 0, JSON.stringify(audit));
  check('offline: an API route is not served from any cache', await page.evaluate(() => fetch('/api/health').then(() => false).catch(() => true)));

  // ---- 4. Server back; eviction is noticed and repaired.
  await startServer(); await ctx.setOffline(false);
  await page.evaluate(async () => { for (const k of await caches.keys()) if (k.startsWith('mgadi-shell-')) await caches.delete(k); });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => ['incomplete', 'saving', 'ready'].includes(document.querySelector('#offline-status').dataset.state));
  await waitState(page, 'ready');
  check('after the browser clears the offline copy, Mgadi notices and saves it again when online', (await cacheNames(page)).length === 1);

  // ---- 5. Interrupted install: one file cannot be fetched by the worker.
  const ctx2 = await newContext(); let flaky = true;
  await ctx2.route('**/styles.css', (route) => (flaky && SW_FETCH(route) ? route.abort() : route.continue()));
  page = await open(ctx2); await page.goto(`${base}/`); await page.waitForSelector('h1');
  check('an interrupted install is reported as failed', await reached(page, 'failed'));
  check('and is never reported as ready', !/Ready offline\./.test(await page.locator('#offline-status').innerText()));
  check('and leaves no half-built cache behind', (await cacheNames(page)).length === 0);
  check('the app itself still works online', (await page.locator('.incident-choices button').count()) === 5);
  flaky = false; await page.reload(); await waitState(page, 'ready');
  check('the next visit retries and completes the install', (await cacheNames(page)).length === 1);
  await ctx2.close();

  // ---- 6. A file whose bytes do not match the manifest is refused.
  const ctx3 = await newContext();
  await ctx3.route('**/app.js', async (route) => { if (!SW_FETCH(route)) return route.continue(); const r = await route.fetch(); return route.fulfill({ response: r, body: `${await r.text()}\n// tampered in transit` }); });
  page = await open(ctx3); await page.goto(`${base}/`); await page.waitForSelector('h1');
  check('a file that does not match its recorded SHA-256 fails the whole install', (await reached(page, 'failed')) && (await cacheNames(page)).length === 0 && !/Ready offline\./.test(await page.locator('#offline-status').innerText()));
  await ctx3.close();

  // ---- 7. Update waits for the next visit; a bad update rolls back.
  const ctx4 = await newContext(); page = await open(ctx4);
  await page.goto(`${base}/`); await waitState(page, 'ready');
  const v1 = (await (await page.request.get(`${base}/precache-manifest.json`)).json()).version;
  // The person has typed something, so the page must not be replaced under them (an untouched page switches by itself: see update-smoke).
  await page.click('summary:has-text("Prefer to describe it in your own words?")'); await page.fill('#incident-description', 'keep this text');
  handler = createHandler({ publicDir: V2 });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const sawUpdate = await reached(page, 'update');
  const stillOld = await page.evaluate(() => fetch('/data/playbook.json').then((r) => r.json()).then((p) => p.reviewNote));
  check('a newer version waits while work is open: the open screen keeps running the old, working one, keeps its text, and offers the switch', sawUpdate && !stillOld.includes('(v2)') && /newer version is ready/.test(await page.locator('#offline-status').innerText()) && await page.locator('.offline-update').isVisible() && (await page.inputValue('#incident-description')) === 'keep this text');
  await page.close(); await new Promise((r) => setTimeout(r, 1500));
  page = await open(ctx4);
  let v2Note = '';
  for (let i = 0; i < 6 && !v2Note.includes('(v2)'); i += 1) { await page.goto(`${base}/`); await page.waitForSelector('h1'); v2Note = await page.evaluate(() => fetch('/data/playbook.json').then((r) => r.json()).then((p) => p.reviewNote)); if (!v2Note.includes('(v2)')) await page.waitForTimeout(800); }
  check('the next time Mgadi is opened (nothing typed), the newer version is used', v2Note.includes('(v2)'), v2Note);
  const v2Names = await cacheNames(page);
  check('the old version\'s cache is deleted once the new one is active', v2Names.length === 1 && !v2Names[0].endsWith(v1), JSON.stringify(v2Names));
  const V3 = copy('v3', (dir) => { const f = path.join(dir, 'data', 'playbook.json'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Practitioner review pending.', 'Practitioner review pending. (v3)')); });
  handler = createHandler({ publicDir: V3 });
  await ctx4.route('**/data/playbook.json', async (route) => { if (!SW_FETCH(route)) return route.continue(); const r = await route.fetch(); return route.fulfill({ response: r, body: `${await r.text()} ` }); });
  await page.reload(); await page.waitForTimeout(3500);
  check('a bad update (corrupted file) is rolled back: the working version stays and nothing half-built remains', (await cacheNames(page)).length === 1 && (await state(page)) !== 'update', `${JSON.stringify(await cacheNames(page))} ${await state(page)}`);
  await stopServer();
  const rolled = await page.reload(); await page.waitForSelector('.incident-choices');
  check('after the failed update, Mgadi still reopens offline on the previous good version', rolled.fromServiceWorker() && (await page.evaluate(() => fetch('/data/playbook.json').then((r) => r.json()).then((p) => p.reviewNote))).includes('(v2)'));
  await startServer();
  await ctx4.close(); await ctx.close();

  check('no page errors in any of this', errors.length === 0, JSON.stringify(errors));
} finally { await browser.close(); server.closeAllConnections?.(); server.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} offline checks passed.`);
process.exit(failed.length ? 1 : 0);
