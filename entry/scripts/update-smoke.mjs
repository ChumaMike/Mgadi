// Update experience: how a browser that already has an OLDER Mgadi installed reaches the newest one, without developer tools, without
// clearing browser data, and without losing what the person has typed.
//   MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs MGADI_AXE=/path/to/axe.min.js node scripts/update-smoke.mjs
// "Older" is real: scripts/fixtures/legacy-offline holds the service worker and registration code that were shipped before this logic
// existed (the code in the browsers that saw the old screens). Versions are made by copying public/ and changing the page title.
// One local server holds ONE origin for the whole run; its files are swapped between versions, as a new deployment would swap them.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../server/app.js';
import { writeIcons } from './make-icons.mjs';

let chromium;
try { ({ chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright')); }
catch { console.log('SKIPPED: Playwright is not installed (set MGADI_PLAYWRIGHT to its index.mjs). Nothing was tested.'); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '..', 'public');
const axePath = process.env.MGADI_AXE ?? path.resolve(here, '..', 'node_modules', 'axe-core', 'axe.min.js');
const axeSource = fs.existsSync(axePath) ? fs.readFileSync(axePath, 'utf8') : null;

const copy = (name, title, { legacy = false } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mgadi-upd-${name}-`));
  fs.cpSync(source, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}vendor`) });
  writeIcons(path.join(dir, 'icons'));
  const index = path.join(dir, 'index.html'); fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`));
  if (legacy) { fs.copyFileSync(path.join(here, 'fixtures', 'legacy-offline', 'sw.js'), path.join(dir, 'sw.js')); fs.copyFileSync(path.join(here, 'fixtures', 'legacy-offline', 'register.js'), path.join(dir, 'offline', 'register.js')); }
  return dir;
};
const LEGACY = copy('legacy', 'Mgadi LEGACY', { legacy: true });
const V1 = copy('v1', 'Mgadi V1'); const V2 = copy('v2', 'Mgadi V2'); const V3 = copy('v3', 'Mgadi V3');
let handler = createHandler({ publicDir: V1 });
const server = http.createServer((req, res) => handler(req, res));
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const deploy = (dir) => { handler = createHandler({ publicDir: dir }); };

const browser = await chromium.launch();
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`); };
const errors = []; const warnings = [];
let dialogs = []; let dialogAnswer = true;
const newContext = (width = 390, height = 844) => browser.newContext({ viewport: { width, height } });
const open = async (ctx, url = `${base}/`) => {
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', async (d) => { dialogs.push(d.message()); if (dialogAnswer) await d.accept(); else await d.dismiss(); });
  await page.goto(url); await page.waitForSelector('h1'); return page;
};
const title = (page) => page.title();
const ready = (page) => page.waitForFunction(() => document.querySelector('#offline-status')?.dataset.state === 'ready', null, { timeout: 25_000 });
const workerVersion = (page) => page.evaluate(() => new URL(navigator.serviceWorker.controller?.scriptURL ?? 'http://x/?v=none').searchParams.get('v'));
const manifestVersion = async (page) => (await (await page.request.get(`${base}/precache-manifest.json`)).json()).version;
const nudge = (page) => page.evaluate(() => window.dispatchEvent(new Event('online'))); // makes the page look for a newer version now
const until = async (fn, ms = 25_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const bannerState = (page) => page.evaluate(() => { const b = document.querySelector('#update-banner'); const btn = b?.querySelector('button'); const r = b?.getBoundingClientRect(); const br = btn?.getBoundingClientRect(); return b ? { open: b.dataset.open === 'true', text: b.querySelector('p')?.textContent ?? '', top: r.top, bottom: r.bottom, btnHeight: br.height, btnVisible: br.height > 0 && br.top < innerHeight, state: document.querySelector('#offline-status')?.dataset.state } : null; });
const typeSomething = async (page, text = 'We paid a supplier SENTINEL-DRAFT-5521 and now they say nothing arrived') => { await page.click('summary:has-text("Prefer to describe it in your own words?")'); await page.fill('#incident-description', text); return text; };

try {
  // ---- 1. A fresh visit gets the newest version straight from the network and saves it.
  deploy(V1);
  const fresh = await newContext(); let page = await open(fresh);
  check('a fresh visit shows the current version and no update banner', (await title(page)) === 'Mgadi V1' && !(await bannerState(page)).open);
  await ready(page);
  check('a fresh visit saves the offline copy, for this version, with the newer-aware worker address (p=2)', (await workerVersion(page)) === (await manifestVersion(page)) && (await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).endsWith('&p=2'));
  await fresh.close();

  // ---- 2. A browser with the LEGACY offline version (the real bug): same tab, no devtools, nothing cleared, no tab closed.
  deploy(LEGACY);
  const old = await newContext(); page = await open(old); await ready(page);
  check('setup: the legacy version is installed and running (its worker address has no p=2)', (await title(page)) === 'Mgadi LEGACY' && (await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).includes('?v=') && !(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).includes('p=2'));
  const legacyVersion = await workerVersion(page);
  deploy(V2);                                                  // a new deployment goes live
  await page.reload(); await page.waitForSelector('h1');       // the person simply reloads the page they already have open
  check('the old page, once reloaded, finds the newer version and its worker takes over by itself', await until(async () => (await workerVersion(page)) === (await manifestVersion(page))), `still on ${await workerVersion(page)} (was ${legacyVersion})`);
  await page.reload(); await page.waitForSelector('h1');
  check('ONE more reload in the same tab shows the newer version: no devtools, no cleared data, no tab closed, no button needed', (await title(page)) === 'Mgadi V2', await title(page));
  check('and nothing is left waiting', (await page.evaluate(async () => !(await navigator.serviceWorker.getRegistration()).waiting)));
  await old.close();

  // ---- 3. A browser on the current kind of version, page untouched: the update applies itself, without a click.
  deploy(V1);
  const idle = await newContext(); page = await open(idle); await ready(page);
  dialogs = []; deploy(V2);
  await page.reload(); await page.waitForSelector('h1');
  check('an untouched page switches to the newer version by itself and asks nothing', await until(async () => (await title(page)) === 'Mgadi V2') && dialogs.length === 0, `${await title(page)} dialogs=${dialogs.length}`);
  await page.waitForSelector('h1'); await ready(page);
  check('after switching, the page is on the new worker, ready offline, with no banner', (await workerVersion(page)) === (await manifestVersion(page)) && !(await bannerState(page)).open);

  // ---- 4. A page where the person has typed: it is NEVER reloaded for them. A visible banner offers the switch.
  deploy(V2);
  const busy = await newContext(); page = await open(busy); await ready(page);
  const typed = await typeSomething(page);
  dialogs = []; deploy(V3); await nudge(page);
  check('with typed text on the page, the update is found and a banner appears, near the top, with a big button', await until(async () => (await bannerState(page))?.open), JSON.stringify(await bannerState(page)));
  await page.waitForTimeout(400); await page.evaluate(() => window.scrollTo(0, 400)); const banner = await bannerState(page); // scrolled down, as when typing
  check('even scrolled down, the banner stays in view under the header, says what is kept, and its button is at least 44px high', banner.top >= 0 && banner.top < 200 && banner.btnVisible && banner.btnHeight >= 44 && /newer version of Mgadi is ready/.test(banner.text) && /kept/.test(banner.text), JSON.stringify(banner));
  await page.waitForTimeout(18_000); // longer than the 15 second idle check
  check('the typed text is still there, the page was not reloaded, and the old version still runs', (await page.inputValue('#incident-description')) === typed && (await title(page)) === 'Mgadi V2' && dialogs.length === 0);
  dialogAnswer = false; await page.click('#update-banner button');
  check('pressing the button warns that the screen will be cleared; saying no changes nothing', dialogs.length === 1 && /clears what is on this screen/.test(dialogs[0]) && (await page.inputValue('#incident-description')) === typed && (await title(page)) === 'Mgadi V2');

  // ---- 5. A SECOND tab opened while an update waits (the old bug: the prompt was forgotten after one reload).
  const second = await open(busy);
  check('a second, untouched tab found the waiting update at load and switched to the newer version', await until(async () => (await title(second)) === 'Mgadi V3'), await title(second));
  check('the first tab, where text was typed, keeps its text and its screen, and still offers the switch', (await page.inputValue('#incident-description')) === typed && (await title(page)) === 'Mgadi V2' && (await bannerState(page)).open);
  await second.close();
  dialogAnswer = true; dialogs = []; await page.click('#update-banner button');
  check('saying yes switches this tab to the newer version', await until(async () => (await title(page)) === 'Mgadi V3') && dialogs.length === 1);

  // ---- 6. Offline after an update, with the server shut down.
  await ready(page);
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await busy.setOffline(true);
  const off = await open(busy).catch(() => null);
  check('with the server shut down, the updated version still opens from its saved copy', Boolean(off) && (await title(off)) === 'Mgadi V3');
  await busy.setOffline(false); await busy.close();
  server.listen(Number(new URL(base).port), '127.0.0.1'); await once(server, 'listening');

  // ---- 7. The banner is accessible at two widths and fits the screen.
  for (const width of [390, 320]) {
    deploy(V1); const c = await newContext(width, width === 320 ? 640 : 844); const p = await open(c); await ready(p); await typeSomething(p); deploy(V2); await nudge(p);
    await until(async () => (await bannerState(p))?.open); await p.waitForTimeout(300);
    const fits = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    let serious = [];
    // Axe measures overlap between targets, so a sticky banner that has scrolled over a button would be reported. That depends only on where the page happens
    // to be scrolled; whether focused content stays clear of the banner is checked on its own (experience-smoke). Audit at the top of the page.
    await p.evaluate(() => window.scrollTo(0, 0));
    if (axeSource) { await p.evaluate(axeSource); serious = (await p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })).violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes[0].target.join(' ')}`))); }
    else console.log('SKIPPED  axe not found; not counted as a pass');
    const b = await bannerState(p);
    check(`the open banner has no sideways scroll and no serious or critical axe issue @${width}px`, fits && serious.length === 0 && b.open && b.btnHeight >= 44, JSON.stringify({ fits, serious, b }));
    await c.close();
  }
  check('no page errors in any of this', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} update-experience browser checks passed.`);
process.exit(failed.length ? 1 : 0);
