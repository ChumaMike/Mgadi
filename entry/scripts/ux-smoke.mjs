// The mobile-first redesign, end to end: the two doors on the home screen, the continue card, the three-step supplier check with its
// explicit verdicts, the Evidence Assist stages, the pack's "what happens next", all eleven languages (and that switching never resets an
// incident), settings, and the accessibility checks a machine can do, across seven screen widths. Real Chromium, the labelled voice
// SIMULATION (no microphone, no provider), synthetic data only.
//   MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs MGADI_AXE=/path/to/axe.min.js node scripts/ux-smoke.mjs
// This is EVIDENCE, NOT A WCAG CONFORMANCE CLAIM. Axe finds only part of what matters. It does not replace a screen reader, a phone in a
// hand, or a person who has never seen Mgadi: no usability testing with people has been done.
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
const WIDTHS = [320, 360, 390, 430, 768, 1280, 1920];
const HEIGHT = { 320: 640, 360: 740, 390: 844, 430: 932, 768: 1024, 1280: 800, 1920: 1080 };
const MESSAGE = 'SYNTHETIC. Hi, our bank details have changed. Please pay invoice INV-2026-0412 for R 70 000,00 to Acme Supplies (synthetic), First National Bank, account 9876501234, branch code 250655. Urgent.';
const open = async (width = 390, height = HEIGHT[width] ?? 800, options = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, ...options }); const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base); await page.waitForSelector('.welcome-choices'); return page;
};
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const wideNodes = (page) => page.evaluate(() => [...document.querySelectorAll('#app *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !e.closest('pre, .pack-json'); }).map((e) => `${e.tagName}.${e.className}`.slice(0, 50)).slice(0, 4));
const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, w: r.width }; }, sel);
const tile = (page, text) => page.locator(`.incident-choices button:has-text("${text}")`).first();
const audit = (page) => page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })).violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes[0].target.join(' ')}`));
const axeClean = async (page) => { if (!axeSource) { console.log('SKIPPED  axe not found; not counted as a pass'); return null; } await page.evaluate(axeSource); await page.evaluate(() => window.scrollTo(0, 0)); return audit(page); };
const text = (page, sel = '#app') => page.locator(sel).innerText();
const oneLine = (value) => value.replace(/\s+/g, ' ');

// Reusable routes
const startCheck = async (page) => { await page.click('.tool-entry'); await page.waitForSelector('#chk-supplier'); };
const toReview = async (page) => { await startCheck(page); await page.click('button:has-text("Fill in a synthetic example")'); await page.click('button:has-text("Check for red flags")'); await page.waitForSelector('text=Step 2 of 3'); };
const toRecord = async (page) => { await toReview(page); await page.click('button:has-text("Next: record my call")'); await page.waitForSelector('#ver-who'); };
const record = async (page, { source = 'old_invoice', result = 'confirmed' } = {}) => { await page.fill('#ver-who', 'Thandi, accounts'); await page.selectOption('#ver-source', source); await page.selectOption('#ver-result', result); await page.check('#ver-mine'); await page.click('button:has-text("Save my check")'); await page.waitForSelector('.ds-status.tool-status'); };
const toEvidenceWithSource = async (page) => { await page.click('.secondary-item button:has-text("Check a PDF or message")'); await page.waitForSelector('#ev-paste'); await page.fill('#ev-paste', MESSAGE); await page.click('button:has-text("Add this text")'); await page.waitForSelector('.evidence-source'); };
const toPack = async (page) => { await tile(page, 'A suspicious message or link').click(); await page.locator('#app .step-outcomes > button.button:not(.secondary)').first().click(); await page.waitForSelector('#evidence-files'); await page.click('text=Review what goes in the pack'); await page.click('text=Make incident pack'); await page.waitForSelector('.pack-next'); };
const paymentRoute = async (page) => { await tile(page, 'Money or a payment problem').click(); await tile(page, 'I paid after').click(); await page.waitForSelector('.journey-progress'); };

try {
  // ---------------------------------------------------------------- A. The home screen: two doors, one tap to the next step
  let home = await open(390);
  const regions = await home.evaluate(() => [...document.querySelectorAll('.primary-actions > section')].map((s) => ({ name: document.getElementById(s.getAttribute('aria-labelledby'))?.textContent, urgent: s.classList.contains('action-card--urgent') })));
  check('the home screen has exactly two primary doors, each with a name: "I think something has gone wrong" (first) and "Check before paying"', regions.length === 2 && regions[0].name === 'I think something has gone wrong' && regions[0].urgent && regions[1].name === 'Check before paying', JSON.stringify(regions));
  check('the five situations are inside the emergency door as a list, and the supplier check is one button inside the other', (await home.locator('.action-card--urgent .incident-choices button').count()) === 5 && (await home.locator('.action-card--calm .tool-entry').count()) === 1 && (await home.locator('.situation-card').count()) === 5);
  const urgentHead = await box(home, '#urgent-title'); const last = await box(home, '.incident-choices button:last-child'); const calmHead = await box(home, '#check-title');
  check('at 390x844 all five situations are on the first screen, and the "Check before paying" door starts on it too', last.bottom <= 844 && urgentHead.top > 0 && calmHead.top < 844, JSON.stringify({ lastBottom: last.bottom, calmTop: calmHead.top }));
  const small = await open(360); const first3 = await small.evaluate(() => [...document.querySelectorAll('.incident-choices button')].slice(0, 3).map((b) => b.getBoundingClientRect().bottom));
  check('at 360x740 the emergency door and its first three choices are on the first screen', first3.every((b) => b <= 740), JSON.stringify(first3));
  check('every control on the home screen is at least 44px tall (the targets people must tap)', await home.evaluate(() => [...document.querySelectorAll('#app button, #app summary')].filter((e) => e.offsetWidth > 0).every((e) => e.getBoundingClientRect().height >= 44)));
  const rows = await home.locator('.secondary-item').allInnerTexts();
  check('secondary access is four calm rows (talk, documents, incident pack, language and accessibility), not more cards', rows.length === 4 && /Talk to Mgadi/.test(rows[0]) && /Check a PDF or message/.test(rows[1]) && /Build an incident pack/.test(rows[2]) && /Language and accessibility/.test(rows[3]), rows.join(' | ').slice(0, 300));
  check('the bank fraud line is in the header on the home screen', await home.locator('#emergency-button').isVisible());

  // ---------------------------------------------------------------- B. Continue an incident, secondary rows, and no browser storage
  check('a fresh start has no "Continue your incident" card', (await home.locator('.continue-card').count()) === 0);
  await paymentRoute(home);
  await home.locator('.step-outcomes > button').nth(0).click(); await home.waitForSelector('text=Step 2 of');
  await home.click('text=Start again'); await home.waitForSelector('.welcome-choices');
  const card = await home.locator('.continue-card').innerText().catch(() => '');
  check('after going home mid-incident, a Continue card names the place ("step 2 of") and says nothing is saved in the browser', /step 2 of/i.test(card) && /does not save it in your browser/.test(card), card);
  await home.click('.continue-card button'); await home.waitForSelector('.journey-progress');
  check('Continue returns to the same step with the earlier answer still marked Done', /Step 2 of/.test(await home.locator('.step-count').textContent()) && /Done/.test(await home.locator('.journey-progress li').first().innerText()));
  check('no browser storage was used by any of this (localStorage, sessionStorage, cookies)', await home.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ''));
  await home.reload(); await home.waitForSelector('.welcome-choices');
  check('after a reload there is nothing to continue (the incident was never saved), and the home screen says so honestly', (await home.locator('.continue-card').count()) === 0);
  await home.click('.secondary-item:has-text("Language and accessibility") button');
  check('"Language and accessibility" opens the settings and puts focus on the language list', await home.evaluate(() => document.querySelector('#accessibility details').open && document.activeElement.id === 'language'));
  await home.click('.secondary-item:has-text("Talk to Mgadi") button'); await home.waitForSelector('.vp-sim', { state: 'visible' });
  check('"Talk to Mgadi" opens the voice panel and it says SIMULATED (this build is in simulation mode)', /SIMULATED/.test(await text(home, '.vp-head')));

  // Words must never be cut in half on a button ("Not applica / ble" was seen on a 390px phone).
  const wordsWhole = async (page) => page.evaluate(() => [...document.querySelectorAll('.step-outcomes .button, .situation-card, .tool-entry')].filter((b) => b.offsetWidth > 0).flatMap((b) => {
    const out = []; const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent; const range = document.createRange();
      for (const match of text.matchAll(/\S+/g)) {
        const tops = new Set();
        for (let i = match.index; i < match.index + match[0].length; i += 1) { range.setStart(node, i); range.setEnd(node, i + 1); const r = range.getClientRects()[0]; if (r) tops.add(Math.round(r.top)); }
        if (tops.size > 1) out.push(match[0]);
      }
    }
    return out;
  }));
  const splitWords = [];
  for (const [width, size] of [[320, 'normal'], [360, 'normal'], [390, 'normal'], [320, 'largest']]) {
    const w = await open(width); if (size !== 'normal') { await w.click('#accessibility summary'); await w.selectOption('#text-size', size); await w.click('#accessibility summary'); }
    splitWords.push(...(await wordsWhole(w)).map((x) => `home@${width}/${size}: ${x}`));
    await paymentRoute(w); splitWords.push(...(await wordsWhole(w)).map((x) => `step@${width}/${size}: ${x}`));
  }
  check('no word on a situation, step-answer or supplier-check button is split across two lines (320, 360, 390px, and 200% text at 320px)', splitWords.length === 0, splitWords.join('; '));

  // ---------------------------------------------------------------- C. Supplier payment check: three steps
  let c = await open(390); await startCheck(c);
  const steps = await c.evaluate(() => [...document.querySelectorAll('.ds-steps li')].map((li) => ({ t: li.textContent.trim(), current: li.getAttribute('aria-current') === 'step', done: li.classList.contains('is-done') })));
  check('the check shows three steps (Describe, Review, Record) with the first current', steps.length === 3 && /Describe/.test(steps[0].t) && steps[0].current && !steps[1].current, JSON.stringify(steps));
  const optionalOpen = await c.evaluate(() => [...document.querySelectorAll('details.ds-optional')].map((d) => d.open));
  const cardH = (await box(c, '#app .card')).h;
  check('step 1 asks for three things and keeps the optional parts folded away, so the screen is short (the card was 2,858px tall at 390px wide before; now under 1,400px)', optionalOpen.length === 2 && optionalOpen.every((o) => !o) && cardH < 1400, JSON.stringify({ optionalOpen, cardH }));
  check('the first thing on the screen says Mgadi cannot stop or release a payment, and "already paid" is its own banner that goes to the bank first', /cannot stop, block or release a payment/.test(await text(c, '#app .notice')) && (await c.locator('.ds-status--danger button').count()) === 1);
  await c.click('.ds-status--danger button'); await c.waitForSelector('text=Step 1 of');
  check('"I have already paid" opens the bank-first guide', /bank's fraud line/.test(await text(c, '#app h1')));
  c = await open(390); await toReview(c);
  const trk = await c.evaluate(() => [...document.querySelectorAll('.ds-steps li')].map((li) => ({ current: li.getAttribute('aria-current') === 'step', done: li.classList.contains('is-done'), sr: li.querySelector('.sr-only')?.textContent ?? '' })));
  check('on the review screen step 2 is current, step 1 is marked done in words for a screen reader', trk[1].current && trk[0].done && /done/.test(trk[0].sr), JSON.stringify(trk));
  const review = await text(c);
  check('the review shows what differs (account number DIFFERENT, last four digits only), the warning signs, and no full account number', /Account number: Different/.test(review) && /••••7890/.test(review) && /High: /.test(review) && !/\b\d{9,}\b/.test(review.replace(/\d{4}[- ]?\d{2}[- ]?\d{2}/g, '')), review.slice(0, 200));
  await c.click('summary:has-text("Add evidence from your own files")'); await c.fill('#ev-paste', MESSAGE); await c.click('button:has-text("Add this text")'); await c.waitForSelector('.evidence-source');
  await c.click('button:has-text("Next: record my call")'); await c.waitForSelector('#ver-who');
  const rec = await c.evaluate(() => [...document.querySelectorAll('.ds-steps li')].map((li) => li.getAttribute('aria-current') === 'step'));
  check('the record screen is step 3, and explains why a number you already had matters', rec[2] && /criminal puts their own phone number in the fake message/.test(oneLine(await text(c))));
  await c.click('button:has-text("Back to the review")'); await c.waitForSelector('text=Step 2 of 3');
  check('going back to the review keeps the evidence that was added (nothing is lost between steps)', (await c.locator('.evidence-source').count()) === 1);
  await c.click('button:has-text("Next: record my call")'); await record(c, { source: 'old_invoice', result: 'confirmed' });
  let st = await c.locator('.ds-status.tool-status').first();
  check('CONFIRMED is a green status with a symbol and the words "Confirmed by your call", and it says Mgadi cannot check it', (await st.getAttribute('class')).includes('ds-status--ok') && /Confirmed by your call/.test(await st.innerText()) && /Mgadi cannot check/.test(await st.innerText()) && (await st.locator('svg[aria-hidden="true"]').count()) === 1);
  check('confirmed offers a second person; it does not call the supplier or the account "verified"', (await c.locator('button:has-text("Create a link for the second person")').count()) === 1 && !/bank account (has been |is )?verified|ownership/i.test(await text(c)));
  const u = await open(390); await toRecord(u); await record(u, { source: 'from_request', result: 'confirmed' });
  st = u.locator('.ds-status.tool-status').first();
  check('UNVERIFIED (a number taken from the request) is an amber status, "Unverified", and offers no second person', (await st.getAttribute('class')).includes('ds-status--warn') && /Unverified/.test(await st.innerText()) && (await u.locator('button:has-text("Create a link for the second person")').count()) === 0);
  const r = await open(390); await toRecord(r); await record(r, { source: 'old_invoice', result: 'denied' });
  st = r.locator('.ds-status.tool-status').first();
  check('REJECTED (the supplier denied it) is a red status, "Rejected", says do not pay, offers no approval, and offers the bank first', (await st.getAttribute('class')).includes('ds-status--danger') && /Rejected/.test(await st.innerText()) && /Do not pay to the new details/.test(await st.innerText()) && (await r.locator('button:has-text("I have already paid")').count()) === 1 && (await r.locator('button:has-text("Create a link")').count()) === 0);

  // ---------------------------------------------------------------- C2. The demo scenario as one journey
  const D = await open(390); let taps = 0; const tap = async (selector) => { await D.click(selector); taps += 1; };
  await tap('.tool-entry'); await tap('button:has-text("Fill in a synthetic example")'); await tap('button:has-text("Check for red flags")'); await D.waitForSelector('text=Step 2 of 3');
  check('demo 1: a supplier sends changed bank details and Mgadi shows a verification warning and the differences', /VERIFY BEFORE PAYING/.test(await text(D)) && /Account number: Different/.test(await text(D)));
  check('demo 2: "I have already paid" is on the review screen, one tap away', (await D.locator('button:has-text("I have already paid")').count()) === 1);
  await tap('button:has-text("I have already paid")'); await D.waitForSelector('text=Step 1 of');
  const bankBtn = await box(D, '.primary-action');
  check('demo 3: the first-hour response starts with the bank (first step), and "Choose a bank fraud line" is on the first screen', /bank's fraud line/.test(await text(D, '#app h1')) && bankBtn && bankBtn.bottom <= 844, JSON.stringify(bankBtn));
  await tap('.voice-launch'); await D.waitForSelector('.vp-sim', { state: 'visible' });
  const headerClear = await D.evaluate(() => { const b = document.querySelector('#emergency-button').getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return hit === document.querySelector('#emergency-button') || document.querySelector('#emergency-button').contains(hit); });
  check('demo 4: with the labelled voice simulation open, the bank fraud line button in the header is still clear and tappable', headerClear && /SIMULATED/.test(await text(D, '.vp-head')));
  await tap('.vp-controls button:has-text("Use text guidance")'); await D.waitForSelector('.journey-progress');
  const stepsLeft = await D.locator('.step-count').textContent();
  for (let i = 0; i < 4; i += 1) { const done = D.locator('#app .step-outcomes > button.button:not(.secondary)').first(); if (!(await done.isVisible().catch(() => false))) break; await done.click(); taps += 1; await D.waitForTimeout(150); }
  await D.waitForSelector('#evidence-files', { timeout: 5000 }); await D.click('text=Review what goes in the pack'); taps += 1; await D.click('text=Make incident pack'); taps += 1; await D.waitForSelector('.pack-next');
  check(`demo 5: from the supplier warning to a finished incident pack took ${taps} taps (the voice panel opened and closed once, the four steps reported Done, nothing typed), and the pack says nothing has been shared`, taps <= 12 && /nothing has been shared/.test(await text(D, '.pack-next')), `taps=${taps} (${stepsLeft})`);

  // ---------------------------------------------------------------- D. Evidence Assist stages
  const e = await open(390); await toEvidenceWithSource(e);
  const order = await e.evaluate(() => { const names = ['Evidence selected', 'Information found', 'Possible matches', 'Missing or contradictory', 'Facts you confirmed', 'Ready to export']; const nodes = names.map((n) => [...document.querySelectorAll('#app h3, #app h5')].find((h) => h.textContent.trim() === n)); return { found: nodes.every(Boolean), inOrder: nodes.every((n, i) => !i || (nodes[i - 1].compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) }; });
  check('Evidence Assist separates the six stages in order: selected, found, possible matches, missing or contradictory, facts you confirmed, ready to export', order.found && order.inOrder, JSON.stringify(order));
  await e.selectOption('#ev-s1-account', '0');
  const facts = await text(e, '.confirmed-facts');
  check('a detail only becomes a confirmed fact when the person chooses it, and the account number is masked to its last four digits', /Account number: ••••1234|Account number: ••••/.test(facts) && !/9876501234/.test(facts), facts);
  check('the export area says nothing is sent, and the pasted text itself is not kept', /Nothing is sent anywhere/.test(await text(e)) && /pasted text itself is not kept/.test(await text(e)));

  // ---------------------------------------------------------------- E. Incident pack: what happens next
  const k = await open(390); await toPack(k);
  const next = await text(k, '.pack-next');
  check('the pack says it is a draft on this device and that nothing has been shared, and explains "link created" versus "acknowledged"', /Draft on this device: nothing has been shared/.test(next) && /"link created"/.test(next) && /only if the other person confirms/.test(next), next.slice(0, 300));
  check('what happens next is six actions, each with a plain line saying what it does (download, print, helper link, check documents, POPIA draft, start again)', (await k.locator('.pack-next .secondary-item').count()) === 6 && /Saves a file on this device\. Nothing is sent/.test(next) && /not legal advice/.test(next));
  check('nothing on the pack screen claims a helper, bank or responder has accepted anything', !/(has|have) accepted|accepted your|responder accepted|help is on the way/i.test(await text(k, '.pack-next')));
  await k.emulateMedia({ media: 'print' });
  check('the on-screen actions do not appear when the summary is printed', (await k.locator('.pack-next').isHidden()) && (await k.locator('.pack-summary').isVisible()));
  await k.emulateMedia({ media: 'screen' });
  await k.click('button:has-text("Send a summary to a helper")'); await k.waitForSelector('#ho-approve');
  check('the helper screen starts as "Draft: nothing has been shared" until the owner approves', /Draft: nothing has been shared\./.test(await text(k, '.tool-status')));

  // ---------------------------------------------------------------- F. Eleven languages, and switching never resets an incident
  const L = await open(390); await L.click('#accessibility summary');
  const options = await L.locator('#language option').allInnerTexts();
  check('the language list has the eleven written languages and not "SASL" (sign language is a separate pathway)', options.length === 11 && !options.some((o) => /sign|sasl/i.test(o)) && options[0] === 'English' && options.includes('Tshivenda') && options.includes('Sepedi (Sesotho sa Leboa)'), options.join(', '));
  const state = {};
  for (const code of ['st', 'tn', 'nso', 'ss', 'nr', 'ts', 've']) {
    await L.selectOption('#language', code); await L.waitForTimeout(150);
    state[code] = await L.evaluate(() => ({ lang: document.documentElement.lang, h1: document.querySelector('#app h1').lang, note: document.querySelector('#translation-note').textContent, status: document.querySelector('#language-status').textContent, voice: document.querySelector('#voice-availability').textContent, notelang: document.querySelector('#translation-note').lang }));
  }
  const bad = Object.entries(state).filter(([code, s]) => s.lang !== code || s.h1 !== 'en' || !/there is no .+ translation for it yet/.test(s.note) || !/there is no .+ translation yet, so Mgadi shows English/.test(s.status) || !/Live voice: not available/.test(s.voice));
  check('each of the seven languages without text: the page language is set, the English text is tagged as English, and the note, status and voice line all say plainly that it is English and there is no voice', bad.length === 0, JSON.stringify(bad));
  const claims = Object.values(state).map((s) => `${s.note} ${s.status} ${s.voice}`).join(' ');
  check('none of that text claims a translation is reviewed, verified, approved or complete', !/\b(reviewed|verified|approved|certified|complete|fully)\b/i.test(claims.replace(/Live voice: not available[^.]*\./g, '')), claims.slice(0, 200));
  await L.selectOption('#language', 'zu'); await L.waitForTimeout(200);
  const zu = await L.evaluate(() => ({ title: document.querySelector('#urgent-title').textContent, lang: document.querySelector('#urgent-title').lang, note: document.querySelector('#translation-note').textContent, check: document.querySelector('#check-title').textContent }));
  check('isiZulu: the two doors show the draft isiZulu titles, tagged zu, with a note that no isiZulu speaker has checked it', /Ngicabanga/.test(zu.title) && zu.lang === 'zu' && /Hlola/.test(zu.check) && /draft/.test(zu.note) && /no isiZulu speaker has checked/.test(zu.note), JSON.stringify(zu));
  const P = await open(390); await P.click('.describe-incident > summary'); await P.fill('#incident-description', 'typed text that must survive'); await P.click('#accessibility summary');
  for (const code of ['zu', 'tn', 'af', 'en']) { await P.selectOption('#language', code); await P.waitForTimeout(120); }
  check('typed text survives switching through isiZulu, Setswana, Afrikaans and back', (await P.inputValue('#incident-description')) === 'typed text that must survive');
  const Q = await open(390); await paymentRoute(Q); await Q.locator('.step-outcomes > button').nth(0).click(); await Q.locator('.step-outcomes > button').nth(1).click(); await Q.waitForSelector('text=Step 3 of');
  await Q.click('#accessibility summary');
  for (const code of ['xh', 'nr', 've', 'en']) { await Q.selectOption('#language', code); await Q.waitForTimeout(150); }
  const prog = await Q.evaluate(() => ({ step: document.querySelector('.step-count').textContent, marks: [...document.querySelectorAll('.journey-progress .step-number')].slice(0, 2).map((n) => n.textContent) }));
  check('an incident in progress is not reset by changing language four times: same step, earlier answers (tick, exclamation mark) still there', /Step 3 of/.test(prog.step) && prog.marks[0] === '✓' && prog.marks[1] === '!', JSON.stringify(prog));
  const NR = await open(390); await NR.click('#accessibility summary'); await NR.selectOption('#language', 'nr'); await NR.waitForTimeout(200);
  const nrAxe = await axeClean(NR);
  if (nrAxe) check('isiNdebele (English fallback) home screen: no serious or critical axe issue', nrAxe.length === 0, nrAxe.join('; '));

  // ---------------------------------------------------------------- G. Accessibility: automated evidence only
  const screens = {
    'home': async (p) => p,
    'supplier check, step 1': async (p) => { await startCheck(p); return p; },
    'supplier check, step 2': async (p) => { await toReview(p); return p; },
    'supplier check, step 3 (saved)': async (p) => { await toRecord(p); await record(p); return p; },
    'evidence with a pasted message': async (p) => { await toEvidenceWithSource(p); return p; },
    'incident pack': async (p) => { await toPack(p); return p; },
  };
  for (const [name, go] of Object.entries(screens)) {
    for (const width of [390, 320]) {
      const p = await open(width); await go(p);
      const found = await axeClean(p);
      if (found) check(`${name} @${width}px: no serious or critical axe issue`, found.length === 0, found.join('; '));
    }
  }
  for (const size of ['largest']) for (const width of [320, 390]) {
    const p = await open(width); await p.click('#accessibility summary'); await p.selectOption('#text-size', size); await p.waitForTimeout(200);
    const homeOverflow = await overflowX(p); const five = await p.locator('.incident-choices button').count();
    await p.click('#accessibility summary'); await startCheck(p); const checkOverflow = await overflowX(p);
    check(`200% text at ${width}px: the home and supplier-check screens do not scroll sideways and the five choices are all still there`, homeOverflow <= 0 && checkOverflow <= 0 && five === 5, JSON.stringify({ homeOverflow, checkOverflow, five }));
  }
  const hc = await open(390); await hc.click('#accessibility summary'); await hc.check('#contrast'); await hc.waitForTimeout(150);
  if (axeSource) { await hc.evaluate(axeSource); const found = await hc.evaluate(async () => (await window.axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['violations'] })).violations.map((v) => v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', '))); check('high contrast: the home screen has no colour-contrast violation', found.length === 0, found.join('; ')); }
  const rm = await open(390); await rm.click('#accessibility summary'); await rm.check('#reduced-motion');
  check('"Reduce movement" removes the transitions on the situation buttons', await rm.evaluate(() => getComputedStyle(document.querySelector('.situation-card')).transitionDuration.split(',').every((d) => parseFloat(d) === 0)));
  const sysRm = await open(390, 844, { reducedMotion: 'reduce' });
  check('the device-wide "reduce motion" setting is honoured too', await sysRm.evaluate(() => getComputedStyle(document.querySelector('.situation-card')).transitionDuration.split(',').every((d) => parseFloat(d) === 0)));
  const kb = await open(390); await kb.keyboard.press('Tab'); await kb.keyboard.press('Tab');
  let reached = false; for (let i = 0; i < 12 && !reached; i += 1) { reached = await kb.evaluate(() => document.activeElement.classList.contains('situation-card')); if (!reached) await kb.keyboard.press('Tab'); }
  const ring = await kb.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
  check('by keyboard alone, Tab reaches the situation buttons within a few presses and the focus ring is drawn (3px)', reached && ring.style !== 'none' && ring.width >= 2, JSON.stringify(ring));
  await kb.keyboard.press('Enter'); await kb.waitForTimeout(400);
  check('Enter on a situation button works (no mouse needed) and focus moves to the new screen heading', await kb.evaluate(() => document.activeElement.tagName === 'H1'));
  const f = await open(390); await startCheck(f); await f.click('summary:has-text("Compare the old")');
  const fonts = await f.evaluate(() => [...document.querySelectorAll('#app input:not([type=checkbox]), #app select, #app textarea')].filter((e) => e.offsetWidth > 0).map((e) => parseFloat(getComputedStyle(e).fontSize)));
  check('every text field and list is at least 16px, so a phone does not zoom the page when the keyboard opens', fonts.length > 5 && fonts.every((px) => px >= 16), JSON.stringify(fonts));
  check('account number and branch code fields ask the phone for the numeric keypad, and no field offers to remember what was typed', await f.evaluate(() => ['tb-account', 'tb-branch', 'pb-account', 'pb-branch'].every((id) => document.getElementById(id).getAttribute('inputmode') === 'numeric') && [...document.querySelectorAll('#app input[type=text]')].every((i) => i.autocomplete === 'off')));
  const net = []; const lb = await browser.newContext({ viewport: { width: 360, height: 740 } }); const lbPage = await lb.newPage();
  lbPage.on('response', async (res) => { try { net.push({ url: res.url(), bytes: (await res.body()).length }); } catch { /* redirects have no body */ } });
  await lbPage.goto(base); await lbPage.waitForSelector('.welcome-choices'); await lbPage.waitForLoadState('networkidle');
  const total = net.reduce((n, x) => n + x.bytes, 0); const foreign = net.filter((x) => !x.url.startsWith(base) && !x.url.startsWith('data:'));
  console.log(`INFO  first load of the home screen: ${net.length} requests, ${(total / 1024).toFixed(0)} KB uncompressed (the server compresses; measured here without compression)`);
  check('the home screen loads only from Mgadi itself (no other host, no web fonts, no trackers) and needs no image besides the logo and icons', foreign.length === 0 && net.every((x) => !/\.(woff2?|ttf|otf)$/.test(x.url)), JSON.stringify(foreign.slice(0, 3)));

  // ---------------------------------------------------------------- H. Width matrix: nothing scrolls sideways at any of the seven widths
  const matrix = { home: [], 'supplier step 1': [], 'supplier step 2': [], 'evidence with source': [], 'incident pack': [] };
  for (const width of WIDTHS) {
    for (const [name, go] of [['home', async (p) => p], ['supplier step 1', async (p) => { await startCheck(p); }], ['supplier step 2', async (p) => { await toReview(p); }], ['evidence with source', async (p) => { await toEvidenceWithSource(p); }], ['incident pack', async (p) => { await toPack(p); }]]) {
      const p = await open(width); await go(p); const over = await overflowX(p); const wide = over > 0 ? await wideNodes(p) : [];
      if (over > 0 || wide.length) matrix[name].push(`${width}px (+${over}) ${wide.join(',')}`);
      await p.context().close();
    }
  }
  for (const [name, bad2] of Object.entries(matrix)) check(`${name}: no sideways scrolling at 320, 360, 390, 430, 768, 1280 and 1920px`, bad2.length === 0, bad2.join('; '));

  check('no script errors or console errors in any of these journeys', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  check('the suite finished without crashing', false, `${error.message}`.split('\n')[0]);
} finally { await browser.close(); server.close(); }
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} ux checks passed.${axeSource ? '' : ' (axe was missing: accessibility checks were skipped)'} Automated checks are evidence, not a WCAG conformance claim, and no usability testing with people has been done.`);
process.exit(passed === results.length ? 0 : 1);

