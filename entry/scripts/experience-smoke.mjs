// The experience: layout on small phones and desktop, one clear primary action, step outcomes, honest pack wording, voice panel layout,
// translation labels and keyboard focus. Real Chromium, the labelled voice SIMULATION (no microphone, no provider), synthetic data.
//   MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs MGADI_AXE=/path/to/axe.min.js node scripts/experience-smoke.mjs
// This is EVIDENCE, NOT A WCAG CONFORMANCE CLAIM: axe finds only part of what matters, and nothing here replaces a screen reader or a person.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../server/app.js';

let chromium;
try { ({ chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright')); }
catch { console.log('SKIPPED: Playwright is not installed (set MGADI_PLAYWRIGHT to its index.mjs). Nothing was tested.'); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url));
const axePath = process.env.MGADI_AXE ?? path.resolve(here, '..', 'node_modules', 'axe-core', 'axe.min.js');
const axeSource = fs.existsSync(axePath) ? fs.readFileSync(axePath, 'utf8') : null;
const server = http.createServer(createHandler({ publicDir: path.resolve(here, '..', 'public'), env: { MGADI_VOICE_MODE: 'mock' } }));
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`); };
const errors = [];
// Three checks below describe the ORIGINAL voice panel and avatar dock (the `.vp-stage` layout). The voice work replaces both (nine states,
// a rebuilt panel, its own suites: voice-smoke, voice-avatar-smoke, voice-live-smoke) and owns that behaviour, so once the new panel is
// present these three are not run. They are printed as NOT APPLICABLE and never counted as passed. (The word SKIPPED is avoided on purpose:
// scripts/run-browser-suites.mjs treats it as "a browser or build was missing", which this is not.)
let legacyPanel = true;
const legacyPanelCheck = (name, ok, detail = '') => (legacyPanel ? check(name, ok, detail) : console.log(`NOT APPLICABLE  ${name} (this describes the old panel; the voice suites cover the new one)`));
const open = async (width = 390, height = 844, options = {}) => { const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, ...options }); const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); await page.goto(base); await page.waitForSelector('h1'); return page; };
const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }; }, sel);
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const paymentRoute = async (page) => { await page.click('.situation-card:has-text("payment")'); await page.click('button:has-text("I paid after")'); await page.waitForSelector('.journey-progress'); };
const ransomRoute = async (page) => { await page.click('.situation-card:has-text("locked")'); await page.waitForSelector('.journey-progress'); };
const stepButtons = (page) => page.locator('.journey-progress .step-link');
const audit = (page) => page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })).violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes[0].target.join(' ')}`));

try {
  // ---- 1. The first screen on a phone
  let page = await open();
  const head = await box(page, '.site-header');
  check('the header (logo and bank button) stays under 100px tall on a phone', head.h <= 100, JSON.stringify(head));
  check('the bank fraud line button is in the header on the first screen', (await page.locator('#emergency-button').isVisible()) && (await box(page, '#emergency-button')).y < 100);
  await page.waitForFunction(() => document.querySelector('#offline-status')?.dataset.state === 'ready', null, { timeout: 25_000 });
  const foot = await box(page, 'footer'); const status = await box(page, '#offline-status'); const main = await box(page, 'main');
  check('"Ready offline" (good news) sits at the bottom of the page, not at the top of every screen', status.y >= foot.bottom - 1 && status.y > main.y, JSON.stringify({ status, foot }));
  await page.context().setOffline(true); await page.waitForFunction(() => document.querySelector('#offline-status')?.dataset.online === 'false');
  const off = await box(page, '#offline-status'); const mainOff = await box(page, 'main');
  check('when the phone goes offline the status moves to the top, where it matters, and says so', off.y < mainOff.y && /You are offline/.test(await page.locator('#offline-status').innerText()), JSON.stringify({ off, mainOff }));
  await page.context().setOffline(false);

  // ---- 2. One clear primary action on the payment route
  page = await open(); await paymentRoute(page);
  const primary = await box(page, '.primary-action'); const h1 = await box(page, 'h1');
  check('payment step 1: the heading and the main action ("Choose a bank fraud line") are on the first phone screen without scrolling', h1.bottom < 844 && primary && primary.bottom <= 844, JSON.stringify({ h1, primary }));
  const names = await stepButtons(page).evaluateAll((els) => els.map((e) => ({ text: e.textContent.replace(/\s+/g, ' ').trim(), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
  check('the four steps are four buttons of at least 44 x 44px, each named with its title and state', names.length === 4 && names.every((n) => n.w >= 44 && n.h >= 44) && /bank/i.test(names[0].text) && /supplier/i.test(names[1].text) && /mailbox/i.test(names[2].text) && /evidence/i.test(names[3].text) && names.every((n) => /Not yet|Done|Need help|Not applicable/.test(n.text)), JSON.stringify(names));
  check('the response order is bank, supplier, mailbox, evidence', names.map((n) => n.text.match(/bank|supplier|mailbox|evidence/i)?.[0].toLowerCase()).join(',') === 'bank,supplier,mailbox,evidence');
  check('no sideways scroll on the step screen (390px)', !(await overflowX(page)));
  const small = await open(320, 640); await paymentRoute(small);
  const smallNames = await stepButtons(small).evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]));
  check('at 320px the step buttons are still 44 x 44px and nothing scrolls sideways', smallNames.every(([w, h]) => w >= 44 && h >= 44) && !(await overflowX(small)));
  await small.context().close();

  // ---- 3. Seven steps (the ransomware route) used to wrap letter by letter
  const rpage = await open(); await ransomRoute(rpage);
  const seven = await stepButtons(rpage).evaluateAll((els) => els.map((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, name: e.textContent.replace(/\s+/g, ' ').trim() })));
  check('seven steps: seven buttons of at least 44 x 44px, with their full titles in the accessible name, and no sideways scroll', seven.length === 7 && seven.every((s) => s.w >= 44 && s.h >= 44 && s.name.length > 10) && !(await overflowX(rpage)), JSON.stringify(seven.slice(0, 2)));
  const hidden = await rpage.locator('.step-words').first().evaluate((e) => { const r = e.getBoundingClientRect(); return r.width <= 2 && r.height <= 2; });
  check('on a phone the long titles are for screen readers only; the heading below carries the visible title', hidden && (await rpage.locator('h1').innerText()).length > 10);

  // ---- 4. Done, Need help, Not applicable, revisiting, and what the pack says
  page = await open(); await paymentRoute(page);
  const noteText = await page.locator('.need-help-note').innerText();
  check('the step screen says plainly that "Need help" only marks the step and nobody is contacted', /does not contact anyone/.test(noteText), noteText);
  check('three outcomes are offered on every step: Done, Need help, Not applicable', (await page.locator('.step-outcomes button').count()) === 3 && /Done/.test(await page.locator('.step-outcomes button').nth(0).innerText()) && /Need help/.test(await page.locator('.step-outcomes button').nth(1).innerText()) && /Not applicable/.test(await page.locator('.step-outcomes button').nth(2).innerText()));
  await page.locator('.step-outcomes button').nth(0).click();            // 1 bank: Done
  await page.locator('.step-outcomes button').nth(1).click();            // 2 supplier: Need help
  await page.locator('.step-outcomes button').nth(2).click();            // 3 mailbox: Not applicable
  const marks = await stepButtons(page).evaluateAll((els) => els.map((e) => e.querySelector('.step-number').textContent));
  check('after those three, the steps show a tick, an exclamation mark and a dash (not colour alone) and the last is still its number', JSON.stringify(marks) === JSON.stringify(['✓', '!', '–', '4']), JSON.stringify(marks));
  await stepButtons(page).nth(1).click();
  check('any earlier step can be revisited from the progress buttons', /supplier/i.test(await page.locator('h1').innerText()));
  await page.locator('.step-outcomes button').nth(0).click();            // 2 supplier: change to Done
  await page.locator('.step-outcomes button').nth(2).click();            // jumps on: 3 is shown again (not applicable stays) -> advance
  const marks2 = await stepButtons(page).evaluateAll((els) => els.map((e) => e.querySelector('.step-number').textContent));
  check('a revisited step can be corrected (Need help became Done) and the progress shows it', marks2[1] === '✓', JSON.stringify(marks2));
  // reach evidence and make the pack
  for (let i = 0; i < 6 && !(await page.locator('#evidence-files').count()); i += 1) { await page.locator('.step-outcomes button').nth(i === 0 ? 0 : 0).click().catch(() => {}); }
  await page.waitForSelector('#evidence-files');
  await page.click('text=Review what goes in the pack'); await page.click('text=Make incident pack'); await page.waitForSelector('.pack-summary');
  const summary = await page.locator('.pack-summary').innerText();
  const pack = JSON.parse(await page.locator('.pack-json').textContent());
  const actions = pack.handoff?.actions ?? [];
  check('the incident pack records the FINAL outcome of every step (a corrected step shows its correction), as the owner\'s own statement', actions.length === 4 && actions[0].status === 'reported-by-owner' && actions[1].status === 'reported-by-owner' && actions[2].status === 'not-applicable-by-owner' && actions[3].status === 'reported-by-owner' && actions.every((a) => /owner|Not reported/i.test(a.note)), JSON.stringify(actions.map((a) => a.status)));
  check('the page people read and print shows each step\'s real outcome in plain words: Done, Not applicable, and nothing lumped as "not yet reported"', /Done \(the owner reported doing this/.test(summary) && /Not applicable \(the owner's own assessment/.test(summary) && !/Not yet reported by the owner/.test(summary), summary.slice(-900));
  check('the pack never says anyone was contacted, notified or is on the way', !/(was|were|has been|have been) (contacted|notified|alerted)|help is on (its|the) way|a responder (has|was)/i.test(summary + JSON.stringify(pack)), summary.slice(0, 300));
  await page.context().close();

  // ---- 5. The voice panel (labelled simulation) on desktop and on a phone
  const desk = await open(1280, 800); await desk.click('.voice-launch'); await desk.waitForSelector('.voice-panel:not([hidden])'); await desk.check('#voice-consent-check'); await desk.click('.vp-start'); await desk.waitForTimeout(1500);
  const dHead = await box(desk, '.site-header'); const dTitle = await box(desk, '.vp-title'); const dSim = await box(desk, '.vp-sim'); const dPanel = await box(desk, '.voice-panel');
  check('desktop: the voice panel title and the SIMULATED badge are below the site header, not hidden behind it', dTitle.y >= dHead.bottom - 1 && dSim.y >= dHead.bottom - 1 && dPanel.y >= dHead.bottom - 1 && dPanel.bottom <= 800, JSON.stringify({ dHead, dTitle, dSim, dPanel }));
  await desk.context().close();
  const ph = await open(390, 844); await ph.click('.voice-launch'); await ph.waitForSelector('.voice-panel:not([hidden])'); await ph.check('#voice-consent-check');
  // Record every accessible state the avatar goes through, so "connecting", "listening" and "speaking" are seen as they happen.
  await ph.evaluate(() => { window.__labels = []; new MutationObserver((list) => { for (const m of list) if (m.target.matches?.('.avatar-dock canvas')) window.__labels.push(m.target.getAttribute('aria-label')); }).observe(document.body, { attributes: true, attributeFilter: ['aria-label'], subtree: true }); });
  legacyPanel = (await ph.locator('.vp-stage').count()) > 0;
  await ph.click('.vp-start'); await ph.waitForSelector('.vp-chat .msg:not(.msg-system)', { timeout: 15_000 }); await ph.waitForTimeout(800);
  const chat = await ph.evaluate(() => { const c = document.querySelector('.vp-chat').getBoundingClientRect(); const b = document.querySelector('.vp-body').getBoundingClientRect(); const m = document.querySelector('.vp-chat .msg:not(.msg-system)').getBoundingClientRect(); return { top: c.top, bottom: Math.min(c.bottom, b.bottom), msgTop: m.top, msgBottom: m.bottom, bodyBottom: b.bottom }; });
  check('phone: the first caption is on screen when the call starts (the captions get the room)', chat.msgTop >= 0 && chat.msgTop < chat.bodyBottom - 20, JSON.stringify(chat));
  const canvas = await box(ph, '.avatar-dock canvas'); const btns = await ph.locator('.avatar-btn').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; }));
  legacyPanelCheck('phone: the avatar\'s size and hide buttons are 44px and sit beside the picture, never over the face', btns.length === 2 && btns.every((b) => b.w >= 44 && b.h >= 44 && (b.x >= canvas.right - 1 || b.y >= canvas.bottom - 1 || b.right <= canvas.x + 1)), JSON.stringify({ canvas, btns }));
  await ph.waitForFunction(() => window.__labels.some((l) => /speaking/.test(l)), null, { timeout: 15_000 }).catch(() => {});
  await ph.click('.vp-controls button:has-text("Mute")'); await ph.waitForFunction(() => /muted/.test(document.querySelector('.avatar-dock canvas').getAttribute('aria-label')), null, { timeout: 5000 }).catch(() => {});
  const mutedLabel = await ph.locator('.avatar-dock canvas').getAttribute('aria-label');
  await ph.click('.vp-controls button:has-text("Unmute")'); await ph.waitForTimeout(500);
  const seenLabels = await ph.evaluate(() => [...new Set(window.__labels)].join(' | '));
  legacyPanelCheck('the avatar goes through connecting, listening and speaking as the call does, and muting says "muted, so Mgadi cannot hear you" (not "resting")', /connecting/.test(seenLabels) && /listening/.test(seenLabels) && /speaking/.test(seenLabels) && /muted, so Mgadi cannot hear you/.test(mutedLabel), `${seenLabels} || muted: ${mutedLabel}`);
  legacyPanelCheck('phone: the voice panel says SIMULATED, says no microphone is used, and has Mute, End call and Use text guidance', (await ph.locator('.vp-sim').isVisible()) && /No microphone/.test(await ph.locator('.vp-chips').innerText()) && (await ph.locator('.vp-controls button:has-text("End call")').isVisible()) && (await ph.locator('.vp-controls button:has-text("Mute")').isVisible()) && (await ph.locator('.vp-controls button:has-text("Use text guidance")').isVisible()));
  if (axeSource) { await ph.evaluate(axeSource); const v = await audit(ph); check('axe: no serious or critical issues in the connected voice panel @390px', v.length === 0, JSON.stringify(v)); }
  await ph.click('.vp-controls button:has-text("End call")');
  check('ending the call hides the avatar and the call buttons, and no microphone is left on', (await ph.locator('.avatar-dock').isHidden()) && (await ph.locator('.vp-controls button:has-text("End call")').isHidden()));
  await ph.context().close();

  // ---- 6. Translation labels come from the screen itself, and never claim review
  const zu = await open(); await zu.click('#accessibility summary'); await zu.selectOption('#language', 'zu'); await zu.waitForTimeout(400);
  const zNote = await zu.locator('#translation-note').innerText();
  check('isiZulu on the start screen: a visible note says what kind of translation this is, and never says reviewed or complete', (await zu.locator('#translation-note').isVisible()) && /isiZulu/.test(zNote) && /draft|English/i.test(zNote) && !/reviewed translation|complete translation|fully translated/i.test(zNote), zNote);
  await zu.click('.situation-card >> nth=1'); await zu.waitForSelector('.journey-progress'); await zu.waitForTimeout(400);
  const zNote2 = await zu.locator('#translation-note').innerText(); const state2 = await zu.locator('#translation-note').getAttribute('data-state');
  check('on a screen with no isiZulu text (the ransomware guide) the note says it is English; the state is partial or english, never draft-only', ['partial', 'english'].includes(state2) && /English/.test(zNote2), `${state2}: ${zNote2}`);
  await zu.selectOption('#language', 'en'); await zu.waitForTimeout(300);
  check('back in English the note disappears', await zu.locator('#translation-note').isHidden());
  await zu.context().close();

  // ---- 7. Keyboard focus is never hidden by the sticky header
  const kb = await open(); await paymentRoute(kb);
  let hiddenFocus = 0; let seen = 0;
  for (let i = 0; i < 40; i += 1) {
    await kb.keyboard.press('Tab');
    // Obscured means something else is drawn over the control's centre, or its centre is off the screen (WCAG 2.2, 2.4.11).
    const r = await kb.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const b = e.getBoundingClientRect(); const cx = b.left + b.width / 2; const cy = b.top + b.height / 2; const top = document.elementFromPoint(cx, cy); return { inHeader: !!e.closest('.site-header'), covered: !(cy >= 0 && cy <= innerHeight && top && (top === e || e.contains(top) || top.contains(e))), name: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30) }; });
    if (!r || r.inHeader) continue; seen += 1; if (r.covered) { hiddenFocus += 1; console.log('   covered:', r.name); }
  }
  check('tabbing through the payment step: every focused control stays fully clear of the sticky header and inside the screen', seen >= 8 && hiddenFocus === 0, `${hiddenFocus} of ${seen} obscured`);
  await kb.context().close();

  // ---- 8. Automated rules on the redesigned screens at two widths
  if (!axeSource) console.log('SKIPPED  axe not found (set MGADI_AXE). Not counted as a pass.');
  else for (const width of [390, 320]) {
    for (const [label, go] of [['start screen', async () => {}], ['payment step', paymentRoute], ['seven-step guide', ransomRoute]]) {
      const p = await open(width, width === 320 ? 640 : 844); await go(p); await p.evaluate(axeSource); const v = await audit(p);
      check(`axe: no serious or critical issues: ${label} @${width}px`, v.length === 0, JSON.stringify(v)); await p.context().close();
    }
  }
  check('no page errors in any of this', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} experience browser checks passed.`);
process.exit(failed.length ? 1 : 0);
