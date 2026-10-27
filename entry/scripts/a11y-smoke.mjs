// Accessibility checks in a real browser: automated rules (axe-core) on every key screen at 320px and 390px, plus keyboard,
// focus, target size, language-fallback honesty and the reviewed-SASL gate. This is EVIDENCE, NOT A WCAG CONFORMANCE CLAIM:
// automated rules catch only part of what matters, and nothing here replaces a screen reader or a person with a disability.
//   MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs MGADI_AXE=/path/to/axe.min.js node scripts/a11y-smoke.mjs
// Without axe-core the automated-rule checks are SKIPPED and reported as skipped, never as passed.
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
catch { console.log('SKIPPED: Playwright is not installed (set MGADI_PLAYWRIGHT). Nothing was tested.'); process.exit(0); }
const axePath = process.env.MGADI_AXE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'axe-core', 'axe.min.js');
const axeSource = fs.existsSync(axePath) ? fs.readFileSync(axePath, 'utf8') : null;

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const copy = (change) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgadi-a11y-')); fs.cpSync(source, dir, { recursive: true, filter: (s) => !s.includes(`${path.sep}vendor`) }); writeIcons(path.join(dir, 'icons')); change?.(dir); return dir; };
// A SYNTHETIC reviewed clip, present only in this temporary copy, to prove the gate shows a real one with its captions.
const FIXTURE = copy((dir) => {
  const f = path.join(dir, 'accessibility', 'signs.js');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('export const reviewedSigns = Object.freeze({});', "export const reviewedSigns = Object.freeze({ 'ransomware_suspected.check_signs': { language: 'sasl', reviewed: true, reviewer: 'TEST FIXTURE (synthetic, not a real reviewer)', reviewedOn: '2026-10-27', rightsCleared: true, src: '/accessibility/media/fixture.webm', captions: '/accessibility/media/fixture.vtt' } });"));
});
const start = async (publicDir, env = {}) => { const server = http.createServer(createHandler({ publicDir, env: { MGADI_VOICE_MODE: 'mock', ...env } })); server.listen(0, '127.0.0.1'); await once(server, 'listening'); return { server, base: `http://127.0.0.1:${server.address().port}` }; };
const real = await start(source); const fixture = await start(FIXTURE);

const browser = await chromium.launch();
const results = []; const skipped = []; const warnings = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`); };
const errors = [];
const open = async (base, { width = 390, height = 844, reducedMotion = 'no-preference' } = {}) => {
  const page = await (await browser.newContext({ viewport: { width, height }, reducedMotion })).newPage();
  page.on('pageerror', (e) => errors.push(e.message)); await page.goto(`${base}/`); await page.waitForSelector('h1'); return page;
};
const tile = (page, text) => page.locator(`.incident-choices button:has-text("${text}")`);

// The ransomware guide to its evidence screen: seven taps, the way a person would.
const toEvidence = async (p) => { await tile(p, 'My device or files are locked').click(); for (let i = 0; i < 7; i += 1) { await p.locator('#app .card > button.button:not(.secondary):not(.danger)').first().click(); await p.waitForTimeout(50); } await p.waitForSelector('#evidence-files'); };
// The supplier check, POPIA draft and helper handoff are reached the way a person would reach them.
const startCheck = async (p) => { await p.click('.tool-entry'); await p.waitForSelector('#chk-supplier'); };
const fillCheck = async (p) => { await startCheck(p); await p.fill('#chk-supplier', 'Test Supplier'); await p.selectOption('#chk-changed', 'bank_account'); await p.selectOption('#chk-arrived', 'email'); await p.fill('#chk-amount', 'R 70 000,00'); await p.check('#chk-q-dont_call'); await p.click('button:has-text("Check for red flags")'); await p.waitForSelector('#ver-who'); };
const recordCheck = async (p) => { await fillCheck(p); await p.fill('#ver-who', 'Thandi'); await p.selectOption('#ver-source', 'old_invoice'); await p.selectOption('#ver-result', 'confirmed'); await p.check('#ver-mine'); await p.click('button:has-text("Save my check")'); await p.waitForSelector('button:has-text("Create a link for the second person")'); };
const makeCheckLink = async (p) => { await recordCheck(p); await p.click('button:has-text("Create a link for the second person")'); await p.waitForSelector('input[aria-label="Link for the second person"]'); return p.locator('input[aria-label="Link for the second person"]').inputValue(); };
const toPack = async (p) => { await tile(p, 'A suspicious message or link').click(); await p.locator('#app .card > button.button:not(.secondary):not(.danger)').first().click(); await p.waitForSelector('#evidence-files'); await p.click('text=Review what goes in the pack'); await p.click('text=Make incident pack'); await p.waitForSelector('.pack-summary'); };
const makeHandoffLink = async (p) => { await toPack(p); await p.click('button:has-text("Send a summary to a helper")'); await p.waitForSelector('#ho-approve'); await p.check('#ho-approve'); await p.click('button:has-text("Create the link")'); await p.waitForSelector('input[aria-label="Link for the contact"]'); return p.locator('input[aria-label="Link for the contact"]').inputValue(); };
// Each screen is reached the way a person would, then audited.
const screens = {
  'home': async () => {},
  'money question': async (p) => { await tile(p, 'Money or a payment problem').click(); await p.waitForSelector('text=What happened with the money?'); },
  'one quick question': async (p) => { await tile(p, "know what happened").click(); await p.waitForSelector('text=One quick question'); },
  'ransomware step 1': async (p) => { await tile(p, 'My device or files are locked').click(); await p.waitForSelector('text=Step 1 of'); },
  'ransomware step 4 (help)': async (p) => { await tile(p, 'My device or files are locked').click(); for (let i = 0; i < 3; i += 1) await p.locator('#app .card > button.button:not(.secondary):not(.danger)').first().click(); await p.waitForSelector('text=Step 4 of'); },
  'payment guide step 1': async (p) => { await tile(p, 'Money or a payment problem').click(); await tile(p, 'I paid after').click(); await p.waitForSelector('text=Step 1 of'); },
  'mailbox guide': async (p) => { await tile(p, 'Someone accessed my email').click(); await p.waitForSelector('text=Step 1 of'); },
  'bank directory': async (p) => { await p.click('#emergency-button'); await p.waitForSelector('text=Call your bank now'); },
  'evidence screen': async (p) => { await tile(p, 'A suspicious message or link').click(); await p.locator('#app .card > button.button:not(.secondary):not(.danger)').first().click(); await p.waitForSelector('#evidence-files'); },
  'pack review': async (p) => { await tile(p, 'A suspicious message or link').click(); await p.locator('#app .card > button.button:not(.secondary):not(.danger)').first().click(); await p.waitForSelector('#evidence-files'); await p.click('text=Review what goes in the pack'); await p.waitForSelector('text=Check what goes in your pack'); },
  'incident summary': async (p) => { await tile(p, 'A suspicious message or link').click(); await p.locator('#app .card > button.button:not(.secondary):not(.danger)').first().click(); await p.waitForSelector('#evidence-files'); await p.click('text=Review what goes in the pack'); await p.click('text=Make incident pack'); await p.waitForSelector('text=Incident summary'); },
  'handoff form open': async (p) => { await toEvidence(p); await p.click('details.handoff-form summary'); await p.fill('#handoff-discovered', 'Monday about 08:00'); await p.selectOption('#handoff-affected', 'server'); await p.fill('#handoff-reference', 'CAS 123/10/2026'); },
  'pack review with handoff': async (p) => { await toEvidence(p); await p.click('details.handoff-form summary'); await p.fill('#handoff-followup', 'Call back Thursday'); await p.click('text=Review what goes in the pack'); await p.waitForSelector('#include-handoff'); },
  'specialist summary (ransomware)': async (p) => { await toEvidence(p); await p.click('details.handoff-form summary'); await p.fill('#handoff-followup', 'Call back Thursday'); await p.click('text=Review what goes in the pack'); await p.click('text=Make incident pack'); await p.waitForSelector('text=Handoff for an IT or security specialist'); },
  'voice panel (simulation)': async (p) => { await tile(p, 'My device or files are locked').click(); await p.waitForSelector('text=Step 1 of'); await p.click('.voice-launch'); await p.waitForSelector('.voice-panel:not([hidden])'); },
  'supplier check: start': startCheck,
  'supplier check: red flags and the verification form': fillCheck,
  'supplier check: check saved, second person offered': recordCheck,
  'supplier check: link made, owner waiting': async (p) => { await makeCheckLink(p); },
  'supplier check: the second person decides': async (p) => { const link = await makeCheckLink(p); await p.goto(link); await p.waitForSelector('button:has-text("Approve")'); },
  'supplier check: a link that cannot be used': async (p) => { await p.goto(`${new URL(p.url()).origin}/#mgadi=1.c.${'A'.repeat(16)}.${'A'.repeat(22)}.${'A'.repeat(43)}`); await p.waitForSelector('text=This link cannot be used'); },
  'POPIA draft (template)': async (p) => { await toPack(p); await p.click('button:has-text("Draft a POPIA notification (template)")'); await p.waitForSelector('.popia-draft'); },
  'helper summary: preview before sending': async (p) => { await toPack(p); await p.click('button:has-text("Send a summary to a helper")'); await p.waitForSelector('#ho-approve'); },
  'helper summary: link made, owner waiting': async (p) => { await makeHandoffLink(p); },
  'helper summary: the contact acknowledges': async (p) => { const link = await makeHandoffLink(p); await p.goto(link); await p.waitForSelector('button:has-text("Acknowledge")'); },
  'signing dialog': async (p) => { await tile(p, 'My device or files are locked').click(); await p.waitForSelector('text=Step 1 of'); await p.click('button:has-text("Sign this")'); await p.waitForSelector('dialog[open]'); },
};
const audit = async (page) => page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })).violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, help: v.help, sample: v.nodes[0].target.join(' ').slice(0, 90) })));

try {
  // ---- 1. Automated rules on every screen at two widths.
  if (!axeSource) { skipped.push('axe-core is not installed: automated rules were NOT run (set MGADI_AXE)'); console.log('SKIPPED  automated rules: axe-core not found'); }
  else for (const width of [390, 320]) for (const [name, go] of Object.entries(screens)) {
    const page = await open(real.base, { width, height: width === 320 ? 640 : 844 }); await go(page); await page.evaluate(axeSource);
    const found = await audit(page); const serious = found.filter((v) => ['serious', 'critical'].includes(v.impact)); const minor = found.filter((v) => !['serious', 'critical'].includes(v.impact));
    for (const v of minor) warnings.push(`${name} @${width}px: ${v.id} (${v.impact}) x${v.count}: ${v.help}`);
    check(`axe: no serious or critical issues: ${name} @${width}px`, serious.length === 0, JSON.stringify(serious));
    await page.context().close();
  }

  // ---- 2. Keyboard: the bank button is reachable at once; focus moves to each new screen's heading.
  let page = await open(real.base);
  const order = []; for (let i = 0; i < 4; i += 1) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => (document.activeElement.id || document.activeElement.className || document.activeElement.tagName).toString().slice(0, 30))); }
  check('keyboard: skip link, then the home link, then the bank button are the first stops', order[0] === 'skip-link' && order.some((o) => o === 'emergency-button') && order.indexOf('emergency-button') <= 2, JSON.stringify(order));
  await tile(page, 'My device or files are locked').click(); await page.waitForSelector('text=Step 1 of'); await page.waitForTimeout(150);
  check('focus moves to the new screen\'s heading, so a screen reader announces where you are', await page.evaluate(() => document.activeElement.tagName === 'H1'));
  await page.locator('#app .card > button.button:not(.secondary):not(.danger)').first().click(); await page.waitForTimeout(150);
  check('and again after moving to the next step', await page.evaluate(() => document.activeElement.tagName === 'H1' && /Disconnect/.test(document.activeElement.textContent)));
  await page.goto(`${real.base}/`); await page.waitForSelector('h1'); for (let i = 0; i < 4 && !(await page.evaluate(() => document.activeElement.id === 'emergency-button')); i += 1) await page.keyboard.press('Tab');
  check('the focused bank button has a visible focus indicator (reached with the keyboard)', await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; }));

  // ---- 3. Touch targets.
  await page.goBack?.().catch(() => {}); page = await open(real.base); await tile(page, 'My device or files are locked').click(); await page.waitForSelector('text=Step 1 of');
  const small = await page.evaluate(() => [...document.querySelectorAll('button, a[href], summary, select, input[type=checkbox]')].filter((e) => e.offsetWidth > 0 && !e.closest('[hidden]') && !(e.tagName === 'A' && e.closest('li, p'))).map((e) => { const r = e.getBoundingClientRect(); const box = e.type === 'checkbox'; return { n: (e.textContent || e.id || e.tagName).trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height), min: box ? 24 : 44 }; }).filter((t) => t.h < t.min || t.w < t.min));
  check('every visible control on a ransomware step meets its minimum: buttons 44 x 44 px, checkboxes 24 x 24 px (WCAG 2.2 AA asks 24); inline text links are exempt', small.length === 0, JSON.stringify(small));

  // ---- 3b. The new screens: focus, announcements, touch targets, and that nothing important is colour alone.
  const tools = await open(real.base); await tools.click('.tool-entry'); await tools.waitForSelector('#chk-supplier'); await tools.waitForTimeout(150);
  check('supplier check: focus moves to the new screen\'s heading', await tools.evaluate(() => document.activeElement.tagName === 'H1'));
  await tools.click('button:has-text("Check for red flags")');
  check('supplier check: a form error is announced (role=alert) and says what is missing', /Please fill in/.test(await tools.locator('[role=alert]').innerText()));
  check('supplier check: every field has a visible label tied to it', await tools.evaluate(() => [...document.querySelectorAll('#app input:not([type=checkbox]):not([type=file]), #app select, #app textarea')].every((e) => e.labels?.length > 0 || e.getAttribute('aria-label'))));
  const result = await open(real.base); await recordCheck(result);
  const tooSmall = await result.evaluate(() => [...document.querySelectorAll('button, summary, select, input[type=checkbox], input[type=text]')].filter((e) => e.offsetWidth > 0 && !e.closest('[hidden]')).map((e) => { const r = e.getBoundingClientRect(); const box = e.type === 'checkbox'; return { n: (e.textContent || e.id || e.tagName).trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height), min: box ? 24 : 44 }; }).filter((t) => t.h < t.min || t.w < t.min));
  check('supplier check result: every control meets its minimum size (buttons 44 px, checkboxes 24 px)', tooSmall.length === 0, JSON.stringify(tooSmall));
  check('supplier check result: the verdict is stated in words, and red-flag levels are written ("High:"), not colour alone', /VERIFY BEFORE PAYING/.test(await result.locator('#app').innerText()) && /High: /.test(await result.locator('.flags').innerText()));
  check('supplier check: the status box is a polite live region, so a screen reader hears the answer arrive', (await result.locator('[role=status].tool-status').count()) >= 1);
  const pack = await open(real.base); await toPack(pack); await pack.click('button:has-text("Send a summary to a helper")'); await pack.waitForSelector('#ho-approve');
  const packSmall = await pack.evaluate(() => [...document.querySelectorAll('button, summary, select, input[type=checkbox], input[type=text]')].filter((e) => e.offsetWidth > 0 && !e.closest('[hidden]')).map((e) => { const r = e.getBoundingClientRect(); const box = e.type === 'checkbox'; return { n: (e.textContent || e.id || e.tagName).trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height), min: box ? 24 : 44 }; }).filter((t) => t.h < t.min || t.w < t.min));
  check('helper summary: every control meets its minimum size, and the disabled "Create the link" button is explained by the tick box next to it', packSmall.length === 0 && (await pack.locator('button:has-text("Create the link")').isDisabled()) && (await pack.locator('label[for="ho-approve"]').count()) === 1, JSON.stringify(packSmall));

  // ---- 4. Language: switching keeps the incident, and untranslated text is marked as English, never passed off as translated.
  await page.locator('#app .card > button.button:not(.secondary):not(.danger)').first().click(); await page.locator('#app .card > button.button:not(.secondary):not(.danger)').first().click();
  await page.waitForSelector('text=Step 3 of'); await page.click('summary:has-text("Language")'); await page.selectOption('#language', 'zu'); await page.waitForTimeout(200);
  check('switching to isiZulu keeps the incident and the step (step 3 of the ransomware guide)', (await page.locator('.step-count').innerText()).includes('Step 3 of 7'));
  const langs = await page.evaluate(() => ({ h1: document.querySelector('h1').lang, htmlLang: document.documentElement.lang, why: [...document.querySelectorAll('h2')].map((h) => [h.textContent, h.lang]) }));
  check('the ransomware text has no isiZulu translation, so it stays English and is MARKED lang="en"', langs.h1 === 'en' && langs.htmlLang === 'zu', JSON.stringify(langs));
  check('strings that DO have a draft translation are marked with the language', langs.why.some(([t, l]) => t !== 'Why this matters' && l === 'zu') || langs.why.some(([, l]) => l === 'zu'), JSON.stringify(langs.why));
  check('the interface says missing translations remain in English and are unreviewed drafts', /Missing translations remain in English/.test(await page.locator('.notice:has-text("Missing translations remain in English")').first().textContent()));
  await page.selectOption('#language', 'en');

  // ---- 5. The reviewed-SASL gate: nothing is shown without a validated clip; a validated clip is shown with its captions.
  await page.click('button:has-text("Sign this")'); await page.waitForSelector('dialog[open]');
  const status = await page.locator('dialog .notice').first().innerText();
  check('no reviewed clip exists: the dialog says so plainly and offers the help that does work', /SASL translation unavailable/.test(status) && /not a signing translation/.test(status) && /Listen, the transcript below, or Talk to Mgadi/.test(status), status);
  check('no video is offered and no sign-language claim is made for the avatar', (await page.locator('dialog video:not([hidden])').count()) === 0 && /Not validated SASL/.test(await page.locator('dialog canvas').getAttribute('aria-label')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check('Escape closes the dialog and focus returns to the control that opened it', await page.evaluate(() => !document.querySelector('dialog[open]') && document.activeElement.textContent.includes('Sign this')));
  const fx = await open(fixture.base); await tile(fx, 'My device or files are locked').click(); await fx.waitForSelector('text=Step 1 of'); await fx.click('button:has-text("Sign this")'); await fx.waitForSelector('dialog[open]');
  const fxStatus = await fx.locator('dialog .notice').first().innerText();
  check('a VALIDATED clip (synthetic fixture) is shown with who reviewed it and when', /Reviewed SASL clip, reviewed by TEST FIXTURE/.test(fxStatus) && /2026-10-27/.test(fxStatus), fxStatus);
  check('and it is shown WITH a captions track', (await fx.locator('dialog video:not([hidden]) track[kind="captions"]').count()) === 1 && (await fx.locator('dialog video').getAttribute('src')) === '/accessibility/media/fixture.webm');
  await fx.keyboard.press('Escape');
  const fx2 = await open(fixture.base); await tile(fx2, 'My device or files are locked').click(); await fx2.waitForSelector('text=Step 1 of'); await fx2.locator('#app .card > button.button:not(.secondary):not(.danger)').first().click(); await fx2.waitForSelector('text=Step 2 of'); await fx2.click('button:has-text("Sign this")'); await fx2.waitForSelector('dialog[open]');
  check('a step with no clip stays unavailable even when another step has one (clips are keyed to the exact step)', /SASL translation unavailable/.test(await fx2.locator('dialog .notice').first().innerText()));

  // ---- 6. Reduced motion and low data.
  const calm = await open(real.base, { reducedMotion: 'reduce' }); await tile(calm, 'My device or files are locked').click(); await calm.waitForSelector('text=Step 1 of'); await calm.click('.voice-launch'); await calm.waitForSelector('.voice-panel:not([hidden])');
  check('reduced motion: no CSS animation or transition is running on the screens', await calm.evaluate(() => document.getAnimations().length === 0));

  check('no page errors on any screen', errors.length === 0, JSON.stringify(errors));
} finally { await browser.close(); real.server.close(); fixture.server.close(); }
const failed = results.filter((r) => !r.ok);
if (warnings.length) { console.log(`\nAutomated-rule findings below "serious" (not failures, but real; ${warnings.length}):`); for (const w of [...new Set(warnings)]) console.log(`  - ${w}`); }
if (skipped.length) console.log(`\nSKIPPED: ${skipped.join('; ')}`);
console.log(`\n${results.length - failed.length}/${results.length} accessibility checks passed${skipped.length ? ' (some SKIPPED, see above)' : ''}. Automated checks are evidence, not a WCAG conformance claim.`);
process.exit(failed.length ? 1 : 0);
