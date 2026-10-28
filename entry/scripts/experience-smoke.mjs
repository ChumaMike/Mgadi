// Complete redesigned journey in Chromium. Synthetic incidents only; no paid provider calls.
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/app.js';
import { verifyPack } from '../public/shared/pack.js';
let chromium;
try { ({ chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright')); }
catch { console.log('SKIPPED: Playwright is unavailable. Nothing was tested.'); process.exit(0); }
const server = createApp({ env: { MGADI_VOICE_MODE: 'mock' } });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = [], errors = [];
const check = (name, ok, detail = '') => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + detail}`); };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mgadi-ui-'));
const fresh = async (width = 390, height = 844, { speech = false } = {}) => {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  await page.addInitScript(() => {
    window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective));
  });
  if (speech) await page.addInitScript(() => {
    window.SpeechRecognition = class { start() { window.__recognizer = this; this.onstart?.(); } stop() { this.onend?.(); } };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(utterance) { window.__utterance = utterance; utterance.onstart?.(); } } });
  });
  page.on('pageerror', e => errors.push(e.message));
  // No request to an external service is allowed in this suite.
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(`${base}/?mockvoice=fast`); await page.locator('.landing-choices').waitFor(); return page;
};
const choose = async (page, name) => {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Tell Mgadi by text', exact: true }).click();
};
const payment = async page => { await choose(page, 'Money or a payment problem'); await page.getByRole('button', { name: 'I paid after bank details changed', exact: true }).click(); await page.locator('.journey-card').waitFor(); };
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const shot = async (page, name) => { if (process.env.MGADI_UI_SCREENSHOTS) { fs.mkdirSync(process.env.MGADI_UI_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.MGADI_UI_SCREENSHOTS, name + '.png'), fullPage: await page.locator('.voice-panel').isHidden() }); } };
const audit = async (page, screen) => {
  if (!process.env.MGADI_AXE) return;
  await page.evaluate(fs.readFileSync(process.env.MGADI_AXE, 'utf8'));
  const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`));
  check(screen + ': axe WCAG checks', !violations.length, violations.join(' | '));
};
try {
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1440, 900]]) {
    const page = await fresh(width, height);
    check(`${width}px home: no horizontal overflow`, !(await overflow(page)));
    const buttons = await page.locator('.landing-mode-buttons').boundingBox();
    check(`${width}px home: text and call above fold`, buttons.y + buttons.height <= height);
    check(`${width}px home: five readable incidents`, await page.locator('.landing-choice').count() === 5);
    const logo = await page.locator('.brand-logo img').evaluate(img => img.complete && img.naturalWidth === 1254);
    check(`${width}px home: actual Mgadi logo loads`, logo);
    if (width === 390) { await shot(page, '01-home-mobile'); await audit(page, 'home'); }
    await payment(page);
    check(`${width}px step: current, remaining and step count present`, await page.locator('[aria-current="step"]').count() === 1 && (await page.locator('.step-count').innerText()) === 'Step 1 of 4');
    check(`${width}px step: sources collapsed`, !(await page.locator('.step-context').getAttribute('open')));
    check(`${width}px step: no horizontal overflow`, !(await overflow(page)));
    if (width === 390) { await shot(page, '03-response-mobile'); await audit(page, 'response'); }
    await page.locator('.voice-launch').click();
    check(`${width}px call: controls inside viewport`, await page.locator('.vp-controls').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1));
    check(`${width}px call: full viewport without page overflow`, await page.locator('.voice-panel').evaluate(el => el.scrollHeight <= innerHeight + 1) && !(await overflow(page)));
    check(`${width}px call: essential consent visible`, await page.locator('#voice-consent-check').isVisible());
    await page.check('#voice-consent-check'); await page.click('.vp-start');
    await page.locator('.vp-status').filter({ hasText: 'Connected' }).waitFor();
    await page.locator('.msg-user').first().waitFor();
    check(`${width}px call: only three live bottom controls`, await page.locator('.vp-controls button:visible').count() === 3);
    check(`${width}px call: current instructions and all outcomes visible`, await page.locator('.vp-instructions li').count() > 0 && await page.locator('.vp-actions button').count() === 3);
    await page.locator('.vp-bank').click(); await page.locator('.bank-popover[open]').waitFor();
    if (width === 390) check('bank dialog: voice shortcut announces expanded', await page.locator('.vp-bank').getAttribute('aria-expanded') === 'true');
    check(`${width}px call: bank shortcut keeps call connected`, await page.locator('.vp-status').innerText() === 'Connected');
    await page.getByRole('button', { name: 'Close bank numbers' }).click();
    if (width === 390) {
      await page.locator('.vp-bank[aria-expanded="false"]').waitFor();
      check('bank dialog: voice shortcut resets after closing', true);
    }
    if (width === 390) { await shot(page, '04-call-mobile'); await audit(page, 'voice'); }
    await page.locator('.vp-actions button').filter({ hasText: 'Need help' }).click();
    check(`${width}px call: advances shared response step`, (await page.locator('.vp-count-row').innerText()).includes('2 / 4'));
    await page.getByRole('button', { name: 'Use text guidance', exact: true }).click();
    check(`${width}px text: progress retained after call`, await page.locator('.step-count').innerText() === 'Step 2 of 4');
    await page.getByRole('button', { name: '← Previous step', exact: true }).click();
    check(`${width}px text: outcome retained on revisit`, (await page.locator('.journey-progress').textContent()).includes('Need help'));
    await page.context().close();
  }
  let page = await fresh();
  await choose(page, "I don't know what happened");
  check('clarification: exactly one question heading and five answers', await page.locator('#app h1').count() === 1 && await page.locator('.incident-choices button').count() === 5 && await page.locator('#app .notice').count() === 0);
  await shot(page, '02-clarification-mobile'); await audit(page, 'clarification');
  await page.locator('.incident-choices button').last().click();
  check('clarification answer advances immediately', await page.locator('.journey-card').count() === 1);
  await page.context().close();

  page = await fresh(); const requests = [];
  page.on('request', req => { if (req.method() === 'POST') requests.push({ url: req.url(), body: req.postData() }); });
  await page.getByRole('button', { name: 'Tell Mgadi by text', exact: true }).click();
  await page.fill('#incident-description', 'We paid after our supplier emailed changed bank details. Phone 082 123 4567.');
  await page.getByRole('button', { name: 'Find my next safe step', exact: true }).click();
  await page.locator('.journey-card').waitFor();
  check('description reaches real local triage endpoint with redaction', requests.some(r => r.url.endsWith('/api/triage') && r.body.includes('[PHONE]') && !r.body.includes('082 123 4567')));
  await page.getByRole('button', { name: 'Need help', exact: true }).click();
  await page.locator('.step-outcomes > button').first().click();
  await page.getByRole('button', { name: 'Not applicable', exact: true }).click();
  check('evidence step: optional non-modal popup', await page.locator('.evidence-permission-prompt[aria-modal="false"]').isVisible());
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  check('evidence denial leaves the journey usable', await page.locator('.evidence-permission-prompt').count() === 0 && await page.getByRole('button', { name: 'Choose evidence files', exact: true }).isVisible());
  await page.locator('.step-outcomes > button').first().click();
  await page.locator('.evidence-screen').waitFor();
  await page.locator('.choose-evidence').click({ trial: true });
  await page.setInputFiles('#evidence-files', { name: 'proof-of-payment.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic evidence; do not upload') });
  await page.locator('.evidence-file').waitFor();
  check('evidence: selected metadata and fingerprint, no upload', (await page.locator('.evidence-file').innerText()).includes('proof-of-payment.txt') && requests.length === 1);
  await shot(page, '05-evidence-mobile'); await audit(page, 'evidence');
  await page.locator('.optional-details summary').click(); await page.fill('#business-name', 'Test Business');
  await page.getByRole('button', { name: 'Review what goes in the pack', exact: true }).click();
  check('review: all four honest step outcomes and evidence metadata', await page.locator('.review-outcomes li').count() === 4 && (await page.locator('.review-outcomes').innerText()).includes('Need help') && (await page.locator('.review-outcomes').innerText()).includes('Not applicable') && (await page.locator('.evidence-file-list').innerText()).includes('proof-of-payment.txt'));
  check('review: personal words remain opt-in', !(await page.locator('#include-original').isChecked()) && !(await page.locator('.preview-box').innerText()).includes('082 123 4567'));
  await shot(page, '06-review-mobile'); await audit(page, 'review');
  await page.getByRole('button', { name: 'Make incident pack', exact: true }).click();
  await page.locator('.pack-result-screen').waitFor();
  await shot(page, '07-result-mobile'); await audit(page, 'result');
  const pack = JSON.parse(await page.locator('.pack-json').textContent());
  check('report: fingerprint verifies and selected file contents excluded', await verifyPack(pack) && !JSON.stringify(pack).includes('synthetic evidence; do not upload') && pack.evidence.length === 1);
  check('report: one completion heading and technical details collapsed', await page.locator('#app h1').count() === 1 && !(await page.locator('.pack-technical').getAttribute('open')));
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download report (.json)', exact: true }).click()]);
  const file = path.join(temp, 'pack.json'); await download.saveAs(file);
  check('download: actual JSON file verifies', await verifyPack(JSON.parse(fs.readFileSync(file, 'utf8'))));
  await page.locator('.pack-technical summary').click(); await page.setInputFiles('#verify-pack', file);
  await page.locator('.notice.good').waitFor();
  check('tamper check: unchanged report accepted', true);
  await page.setInputFiles('#verify-pack', { name: 'modified.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...pack, business: 'Changed' })) });
  await page.locator('.notice.bad').waitFor(); check('tamper check: changed report rejected', true);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  check('print: full human-readable report is expanded', await page.locator('.pack-full-details').getAttribute('open') !== null);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.getByRole('button', { name: 'Review again', exact: true }).click();
  check('review again retains evidence and business', (await page.locator('.preview-box').innerText()).includes('Test Business'));
  await page.getByRole('button', { name: 'Back to evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Start a new incident', exact: true }).click();
  await choose(page, 'A suspicious message or link'); await page.locator('.step-outcomes > button').first().click();
  check('new incident clears previous evidence and offers consent again', await page.locator('.evidence-permission-prompt').count() === 1 && await page.locator('.evidence-file').count() === 0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Accept & choose files', exact: true }).click()]);
  await chooser.setFiles([]); check('accept opens the native file chooser; cancel reads nothing', await page.locator('.evidence-file').count() === 0);
  await page.evaluate(() => { const read = File.prototype.arrayBuffer; File.prototype.arrayBuffer = function() { return this.name === 'broken.txt' ? Promise.reject(new Error('read failed')) : read.call(this); }; });
  await page.setInputFiles('#evidence-files', { name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.from('unreadable test') });
  await page.locator('.evidence-feedback').filter({hasText: 'could not be read'}).waitFor();
  check('evidence read failure is honest and records no file', await page.locator('.evidence-file').count() === 0);
  await page.getByRole('button', { name: 'Review what goes in the pack', exact: true }).click();
  check('evidence stays optional', await page.locator('.pack-review-screen').isVisible());
  await page.context().close();

  // TTS animation tracks actual playback events; it never claims a measured level.
  page = await fresh(390, 844, { speech: true }); await page.getByRole('button', { name: 'Call Mgadi', exact: true }).click();
  await page.getByRole('button', { name: 'Show illustrative gestures', exact: true }).first().click();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('button', { name: 'Start guided voice replies', exact: true }).click();
  await page.evaluate(() => { window.__recognizer.onresult({ results: Object.assign([{ 0: { transcript: 'call' }, isFinal: true }], { length: 1 }) }); });
  check('browser guidance: playback starts speaking animation', await page.locator('.avatar-dock').getAttribute('data-state') === 'speaking');
  check('browser guidance: no audio level fabricated', (await page.locator('.vp-speaking-label').textContent()).includes('no level data'));
  await page.evaluate(() => window.__utterance.onend());
  check('browser guidance: playback end stops speaking animation', await page.locator('.avatar-dock').getAttribute('data-state') !== 'speaking');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  check('browser guidance: messages also appear in main conversation', (await page.locator('.vp-chat').innerText()).includes('Browser guidance:'));
  await page.getByRole('button', { name: 'Options', exact: true }).click(); await page.keyboard.press('Escape');
  check('Options Escape closes only Options', await page.locator('.voice-panel').isVisible() && await page.locator('.vp-compact-tools').isHidden());
  await page.getByRole('button', {name: 'Options', exact: true}).click();
  await page.locator('#accessibility > details > summary').click();
  await page.check('#text-only');
  check('Options: real low-data preference hides visual companion', await page.locator('.vp-compact-side').isHidden());
  await page.uncheck('#text-only'); await page.selectOption('#language','zu');
  check('Options: existing language state and fallback remain accessible', await page.locator('.vp-start').isDisabled() && await page.locator('.vp-avail').textContent() !== '');
  await page.selectOption('#language','en');
  await page.check('#contrast');
  check('Options: existing high-contrast preference works', await page.evaluate(()=>document.documentElement.dataset.contrast === 'true'));
  await page.uncheck('#contrast');
  await page.getByRole('button', {name: 'Close', exact: true}).click();
  await page.context().close();

  // High text scaling, low data and short landscape retain reachable controls.
  for (const [width,height,size] of [[320,568,'largest'],[844,390,'normal']]) {
    page = await fresh(width,height); await payment(page); await page.evaluate(size => document.documentElement.dataset.textSize = size, size);
    await page.locator('.voice-launch').click();
    check(`${width}x${height} ${size}: controls remain visible, no sideways overflow`, !(await overflow(page)) && await page.locator('.vp-controls').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1));
    if (size === 'largest') await shot(page,'08-large-text-call');
    await page.context().close();
  }
  check('no uncaught page errors', !errors.length, errors.join(' | '));
} catch (error) { check('journey completed without an unexpected error', false, error.stack); }
finally { await browser.close(); server.close(); fs.rmSync(temp, { recursive: true, force: true }); }
console.log(`${results.filter(Boolean).length}/${results.length} experience checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
