// Optional browser smoke test (dev-only, not part of `npm test`, no dependency added).
// Needs Playwright with a Chromium build: MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/browser-smoke.mjs
// All text is synthetic. It starts its own local server; nothing leaves this machine.
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

let chromium;
try { ({ chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright')); }
catch { console.log('SKIPPED: Playwright is not installed (set MGADI_PLAYWRIGHT to its index.mjs). Nothing was tested.'); process.exit(0); }

const app = createApp();
app.listen(0, '127.0.0.1'); await once(app, 'listening');
const base = `http://127.0.0.1:${app.address().port}`;
const browser = await chromium.launch();
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mgadi-'));
const fresh = async (width = 390, height = 844) => { const page = await (await browser.newContext({ viewport: { width, height }, acceptDownloads: true })).newPage(); page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); }); await page.goto(base); await page.waitForSelector('h1'); return page; };
const h1 = (page) => page.locator('h1').first().innerText();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const type = async (page, text) => { if (!(await page.locator('#incident-description').isVisible())) await page.locator('.describe-incident > summary').click(); await page.fill('#incident-description', text); };
const send = async (page) => { await page.click('text=Find my next safe step'); };
const DIVERSION = 'We paid a supplier after an email said their banking details changed, but they say they never got the money. Call 082 123 4567.';

try {
  // 1. Core flow, masked request, bank-first, review status, Back keeps the step.
  let page = await fresh(); const bodies = []; page.on('request', (r) => { if (r.url().endsWith('/api/triage')) bodies.push(r.postData()); });
  check('bank button visible on first screen', await page.locator('#emergency-button').isVisible());
  await type(page, DIVERSION); await send(page); await page.waitForSelector('text=Step 1 of');
  check('request sent to server was masked', bodies.length === 1 && bodies[0].includes('[PHONE]') && !bodies[0].includes('082'));
  check('pasted number never shown as an action', !(await page.content()).includes('082 123 4567'));
  check('draft review status is visible on guidance', (await page.locator('.review-status').first().innerText()).toLowerCase().includes('review pending'));
  check('stale "feature is next" text is gone', !(await page.content()).includes('feature is next'));
  await page.click('text=Choose a bank fraud line');
  check('bank directory shows the checked date', (await page.locator('.bank-popover').innerText()).includes('last checked'));
  await page.click('button:has-text("Close bank numbers")');
  check('Back from bank directory keeps the step', (await page.locator('.step-count').textContent()).includes('Step 1 of'));

  // 2. Honest bank reporting: skipping is allowed and recorded as "not reported".
  await page.click('button:has-text("Need help")');
  for (const l of ["I've spoken to the supplier", "I've checked the mailbox", "I've kept the evidence"]) await page.click(`button[data-report="${l}"]`);
  check('evidence screen has no sideways scroll at 390px', !(await overflow(page)));
  fs.writeFileSync(path.join(tmp, 'e.txt'), 'synthetic evidence'); await page.setInputFiles('#evidence-files', path.join(tmp, 'e.txt')); await page.waitForSelector('li:has-text("SHA-256")');
  await page.fill('#business-name', 'Test Co'); await page.fill('#amount-paid', 'R 70 000,00');
  await page.click('text=Review what goes in the pack');
  const previewText = await page.locator('.preview-box').innerText();
  check('pack preview defaults to the masked story', previewText.includes('[PHONE]') && !previewText.includes('082 123 4567'));
  check('original words are opt-in (unchecked)', !(await page.locator('#include-original').isChecked()));
  await page.click('button:has-text("Back")'); check('Back keeps typed business name', (await page.inputValue('#business-name')) === 'Test Co');
  await page.click('text=Review what goes in the pack'); await page.click('text=Make incident pack'); await page.waitForSelector('text=Incident summary');
  const summaryText = await page.locator('.pack-summary').innerText();
  check('readable summary shows bank NOT reported', summaryText.includes('has not reported calling the bank'));
  check('readable summary excludes the raw number by default', !summaryText.includes('082 123 4567'));
  const pack = JSON.parse(await page.locator('pre.pack-json').textContent());
  check('pack JSON has masked story and no raw number', pack.story.version === 'masked' && !JSON.stringify(pack).includes('082'));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=Download incident pack')]); const good = path.join(tmp, 'pack.json'); await download.saveAs(good);
  const bad = path.join(tmp, 'bad.json'); fs.writeFileSync(bad, JSON.stringify({ ...JSON.parse(fs.readFileSync(good, 'utf8')), business: 'Evil Co' }));
  await page.click('summary:has-text("Technical data")');
  await page.setInputFiles('input[aria-label="Incident pack to verify"]', good); await page.waitForFunction(() => /Pack unchanged/.test(document.querySelector('.pack-technical [role=status]')?.textContent ?? ''));
  check('tamper check: original matches', (await page.locator('.pack-technical .notice.good').count()) === 1);
  await page.setInputFiles('input[aria-label="Incident pack to verify"]', bad); await page.waitForTimeout(250);
  check('tamper check: edited pack is flagged', (await page.locator('.notice.bad').count()) === 1);
  check('no page errors in core flow', page.errors.length === 0, page.errors.join(' | '));

  // 3. Opting in to the original words, and "I called" being recorded.
  page = await fresh(); await type(page, DIVERSION); await send(page); await page.waitForSelector('text=Step 1 of');
  await page.click(`button[data-report="I've called the bank"]`);
  for (const l of ["I've spoken to the supplier", "I've checked the mailbox", "I've kept the evidence"]) await page.click(`button[data-report="${l}"]`);
  await page.click('text=Review what goes in the pack'); await page.check('#include-original');
  check('preview shows original only after opting in', (await page.locator('.preview-box').innerText()).includes('082 123 4567'));
  await page.click('text=Make incident pack'); await page.waitForSelector('text=Incident summary');
  check('bank reported time appears when owner pressed called', (await page.locator('.pack-summary').innerText()).includes('reported calling the bank at'));

  // 4. Clarifying question replaces the silent "unsure" route.
  page = await fresh(); await type(page, 'My bookkeeper says there is a problem with the supplier payment.'); await send(page);
  await page.waitForSelector('text=One quick question');
  check('unclear text asks one question', (await page.locator('.incident-choices button').count()) === 5);
  await page.click('button:has-text("I am not sure")'); await page.waitForSelector('text=Step 1 of');
  check('unsure route lets the owner continue without claiming a call', (await page.locator('#app button:has-text("Need help")').count()) === 1);
  await page.click('button:has-text("Need help")');
  check('unsure route has a second "pause and verify" step', (await h1(page)).includes('Pause before you pay'));
  page = await fresh(); await page.click('.incident-choices button:has-text("know what happened")'); await page.getByRole('button', { name: 'Tell Mgadi by text', exact: true }).click(); await page.waitForSelector('text=One quick question');
  await page.click('button:has-text("nothing has been paid or locked")'); await page.waitForSelector('text=Step 1 of');
  check('answering "suspicious message, nothing paid or locked" goes to the stop-and-verify guide', (await page.locator('.step-count').textContent()).includes('no money moved'));

  // 5. Hung API, API down, and the skip button.
  page = await fresh(); await page.route('**/api/triage', () => {}); await type(page, 'We paid after the supplier changed banking details.'); await send(page);
  await page.waitForSelector('text=Step 1 of', { timeout: 9000 }).catch(() => {});
  check('hung API falls back to local rules within the timeout', (await page.locator('.step-count').count()) === 1);
  page = await fresh(); await page.route('**/api/triage', () => {}); await type(page, 'We paid after the supplier changed banking details.'); await send(page);
  await page.click('text=Use the guide on this phone now'); await page.waitForSelector('text=Step 1 of', { timeout: 2000 }).catch(() => {});
  check('skip button gives an immediate local answer', (await page.locator('.step-count').count()) === 1);
  page = await fresh(); await page.route('**/api/triage', (r) => r.abort()); await type(page, 'We paid after the supplier changed banking details.'); await send(page);
  await page.waitForSelector('text=Step 1 of', { timeout: 3000 }).catch(() => {});
  check('API down falls back immediately', (await page.locator('.step-count').count()) === 1);

  // 6. A late triage result must not pull the owner off the bank numbers.
  page = await fresh(); await page.route('**/api/triage', async (r) => { await new Promise((x) => setTimeout(x, 1200)); await r.continue(); });
  await type(page, 'We paid after the supplier changed banking details.'); await send(page); await page.click('#emergency-button'); await page.waitForTimeout(2200);
  check('bank directory stays on screen when triage finishes', await page.locator('.bank-popover').isVisible());
  await page.click('button:has-text("Close bank numbers")'); await page.waitForSelector('text=Step 1 of');
  check('Back then shows the waiting result', (await page.locator('.step-count').count()) === 1);

  // 7. Accessibility: no "Audio stopped." churn on navigation; language keeps input.
  page = await fresh(); await page.evaluate(() => { window.__m = 0; new MutationObserver((l) => { window.__m += l.length; }).observe(document.querySelector('.audio-status'), { childList: true, characterData: true, subtree: true }); });
  await page.click('.incident-choices button:has-text("Money or a payment problem")'); await page.getByRole('button', { name: 'Tell Mgadi by text', exact: true }).click(); await page.click('.incident-choices button:has-text("I paid after")'); await page.waitForSelector('text=Step 1 of'); await page.click('text=Start again'); await page.waitForSelector('text=What happened?');
  check('navigation does not change the audio status region', (await page.evaluate(() => window.__m)) === 0);
  await page.click('#accessibility > details > summary'); await page.selectOption('#language', 'zu'); await type(page, 'typed text kept?'); await page.selectOption('#language', 'af');
  check('typed text survives a language switch', (await page.inputValue('#incident-description')) === 'typed text kept?');

  // 8. No sideways scrolling on any screen at 320px with 200% text.
  page = await fresh(320, 640); await page.click('#accessibility > details > summary'); await page.selectOption('#text-size', 'largest'); await page.click('#accessibility > details > summary');
  check('home: no sideways scroll at 320px / 200%', !(await overflow(page)));
  await type(page, 'My bookkeeper says there is a problem with the supplier payment.'); await send(page); await page.waitForSelector('text=One quick question');
  check('clarify: no sideways scroll', !(await overflow(page)));
  await page.click('button:has-text("Money has been paid out, or is missing")'); await page.waitForSelector('text=Step 1 of');
  check('guidance step: no sideways scroll', !(await overflow(page)));
  await page.click('#emergency-button'); check('bank directory: no sideways scroll', !(await overflow(page))); await page.click('button:has-text("Close bank numbers")');
  await page.click('button:has-text("Need help")'); for (const l of ["I've spoken to the supplier", "I've checked the mailbox", "I've kept the evidence"]) await page.click(`button[data-report="${l}"]`);
  check('evidence: no sideways scroll', !(await overflow(page)));
  await page.click('text=Review what goes in the pack'); check('pack review: no sideways scroll', !(await overflow(page)));
  await page.click('text=Make incident pack'); await page.waitForSelector('text=Incident summary'); check('pack summary: no sideways scroll', !(await overflow(page)));
} finally { await browser.close(); app.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed.`);
process.exit(failed.length ? 1 : 0);
