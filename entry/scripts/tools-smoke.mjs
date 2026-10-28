// Browser checks for the POPIA draft, the supplier payment-change check and the responder handoff.
//   MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/tools-smoke.mjs
// Two SEPARATE browser contexts play the owner and the second person / contact, so everything must travel in the link and the server.
// Synthetic text only. Starts its own local server (memory store); nothing leaves this machine.
import { once } from 'node:events';
import fs from 'node:fs';
import { createApp } from '../server/app.js';

let chromium;
try { ({ chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright')); }
catch { console.log('SKIPPED: Playwright is not installed (set MGADI_PLAYWRIGHT to its index.mjs). Nothing was tested.'); process.exit(0); }

const app = createApp(); app.listen(0, '127.0.0.1'); await once(app, 'listening');
const base = `http://127.0.0.1:${app.address().port}`;
const browser = await chromium.launch();
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`); };
const errors = []; const traffic = [];
const newPage = async (ctx) => { const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); page.on('request', (r) => { if (r.url().includes('/api/links')) traffic.push({ url: r.url(), body: r.postData() ?? '' }); }); return page; };
const context = (width = 390) => browser.newContext({ viewport: { width, height: 844 }, acceptDownloads: true });
const open = async (ctx, url = `${base}/`) => { const page = await newPage(ctx); await page.goto(url); await page.waitForSelector('h1'); return page; };
const h1 = (page) => page.locator('h1').first().innerText();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const tile = (page, text) => page.locator(`.incident-choices button:has-text("${text}")`);
const api = (page, body) => page.evaluate(async (b) => { const r = await fetch('/api/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; }, body);
const SENT = 'SENTINEL-OWNER-ACME';
const XSS = `<img src=x onerror=window.__x=1>${SENT}`;

async function startCheck(page) { await page.click('.tool-entry'); await page.waitForSelector('#chk-supplier'); }
async function fillRequest(page, extra = {}) {
  await page.fill('#chk-supplier', extra.supplier ?? XSS); await page.selectOption('#chk-changed', 'bank_account'); await page.selectOption('#chk-arrived', 'email');
  await page.fill('#chk-amount', 'R 70 000,00'); await page.fill('#chk-note', extra.note ?? 'Please pay urgently, do not call us'); await page.check('#chk-q-dont_call');
  await page.click('button:has-text("Check for red flags")'); await page.waitForSelector('#ver-who');
}
async function saveVerification(page, { source = 'old_invoice', result = 'confirmed', mine = true } = {}) {
  await page.fill('#ver-who', 'Thandi, accounts'); await page.selectOption('#ver-source', source); await page.selectOption('#ver-result', result);
  if (mine) await page.check('#ver-mine'); await page.click('button:has-text("Save my check")');
}
const ownerLinkOf = (page) => page.locator('input[aria-label="Your link to see the answer"]').inputValue();
const contactLinkOf = (page) => page.locator('input[aria-label="Link for the second person"]').inputValue();
async function makePack(page) {
  await tile(page, 'A suspicious message or link').click(); await page.locator('#app .step-outcomes > button.button:not(.secondary)').first().click(); await page.waitForSelector('#evidence-files');
  await page.fill('#business-name', 'SENTINEL-BUSINESS-PACK'); await page.fill('#amount-paid', 'SENTINEL-AMOUNT-PACK');
  await page.click('summary:has-text("Add details for your bank")'); await page.fill('#handoff-discovered', 'Monday 08:00'); await page.fill('#handoff-reference', 'CAS 123/10/2026');
  await page.click('text=Review what goes in the pack'); await page.click('text=Make incident pack'); await page.waitForSelector('.pack-summary');
}

try {
  const ownerCtx = await context(); const otherCtx = await context();
  let owner = await open(ownerCtx);

  // ---- 1. Entry, and "already paid" goes to the bank first
  check('the supplier check is offered on the home screen, outside the five emergency choices (which are still five)', (await owner.locator('.tool-entry').count()) === 1 && (await owner.locator('.incident-choices button').count()) === 5 && (await owner.locator('.incident-choices .tool-entry').count()) === 0);
  await startCheck(owner);
  check('the first thing on the check is that Mgadi cannot stop, block or release a payment', /Mgadi cannot stop, block or release a payment/.test(await owner.locator('#app .notice').first().innerText()));
  await owner.click('button:has-text("I have already paid")'); await owner.waitForSelector('text=Step 1 of');
  check('"I have already paid" goes straight to the existing bank-first guide', (await h1(owner)).includes("bank's fraud line") && (await owner.locator('#emergency-button').isVisible()));
  await owner.click('text=Start again'); await startCheck(owner);
  await owner.click('button:has-text("Check for red flags")');
  check('an empty request is refused and says what is missing', /Please fill in: the supplier, what changed, how it arrived/.test(await owner.locator('[role=alert]').innerText()));

  // ---- 2. Red flags, hostile text, independent verification
  await fillRequest(owner);
  const banner = await owner.locator('#app .notice').first().innerText();
  check('the result says VERIFY BEFORE PAYING and again that Mgadi cannot block a payment', /VERIFY BEFORE PAYING/.test(banner) && /Mgadi cannot stop, block or release a payment/.test(await owner.locator('#app').innerText()));
  const flagsText = await owner.locator('.flags').innerText();
  check('red flags are listed with a text level (not colour alone) and a reason', /High: .*banking details changed/.test(flagsText) && /High: .*email/.test(flagsText) && /not to phone|not phone|phone call on a number you already have/i.test(flagsText) && /pressure, secrecy or a new account/.test(flagsText), flagsText);
  check('markup typed into a field is shown as text and never runs', (await owner.locator('#app img').count()) === 0 && (await owner.evaluate(() => window.__x)) === undefined);
  check('no second-person link can be made before a check is recorded', (await owner.locator('button:has-text("Create a link for the second person")').count()) === 0);
  await saveVerification(owner, { source: 'from_request' });
  check('a number taken from the request itself does NOT count as independent', /does not count as independent/.test(await owner.locator('.tool-status').innerText()) && (await owner.locator('button:has-text("Create a link for the second person")').count()) === 0);
  await saveVerification(owner, { source: 'old_invoice', result: 'denied' });
  check('"they said they did not ask for it" says do not pay, offers no approval, and offers the bank', /Do not pay to the new details/.test(await owner.locator('.tool-status').innerText()) && (await owner.locator('button:has-text("Create a link for the second person")').count()) === 0 && (await owner.locator('button:has-text("I have already paid")').count()) >= 1);
  await owner.fill('#ver-who', ''); await owner.click('button:has-text("Save my check")');
  check('a check without the caller is refused', /Please complete: who you spoke to/.test(await owner.locator('[role=alert]').last().innerText()));
  await owner.uncheck('#ver-mine'); await owner.fill('#ver-who', 'Thandi'); await owner.click('button:has-text("Save my check")');
  check('"I made this call myself" must be ticked by the person', /tick that you made the call yourself/.test(await owner.locator('[role=alert]').last().innerText()));
  await saveVerification(owner, { source: 'old_invoice', result: 'confirmed' });
  check('a call on a number already held, confirmed, is shown as the owner\'s own report that Mgadi cannot check', /You report that you phoned a number you already had/.test(await owner.locator('.tool-status').innerText()) && /cannot check that/.test(await owner.locator('.tool-status').innerText()));

  // ---- 3. Create the link: a retry after a lost reply must not make a second record; a double click must not either
  let cut = false;
  await owner.route('**/api/links', async (route) => { if (!cut && (route.request().postData() ?? '').includes('"op":"create"')) { cut = true; await route.fetch(); return route.abort(); } return route.continue(); });
  await owner.click('button:has-text("Create a link for the second person")');
  await owner.waitForSelector('text=This needs an internet connection. Nothing was sent.');
  check('when the reply is lost the person is told, nothing is shown as made, and the button works again', /This needs an internet connection\. Nothing was sent\./.test(await owner.locator('[role=alert]').last().innerText()) && (await owner.locator('input[aria-label="Link for the second person"]').count()) === 0 && (await owner.locator('button:has-text("Create a link for the second person")').isEnabled()));
  await owner.locator('button:has-text("Create a link for the second person")').dblclick();
  await owner.waitForSelector('input[aria-label="Link for the second person"]');
  await owner.unroute('**/api/links');
  const creates = traffic.filter((t) => t.body.includes('"op":"create"')).map((t) => JSON.parse(t.body));
  check('the retry reused the SAME record id, so the server held one record (it answered "duplicate"), and the double click sent only one request', creates.length === 2 && creates[0].id === creates[1].id && creates[0].ct === creates[1].ct, JSON.stringify(creates.map((c) => c.id)));
  const contactLink = await contactLinkOf(owner); const ownerLink = await ownerLinkOf(owner);
  check('both links keep everything secret after the # sign', new URL(contactLink).search === '' && new URL(contactLink).hash.startsWith('#mgadi=1.c.') && new URL(ownerLink).hash.startsWith('#mgadi=1.o.'));
  const key = new URL(contactLink).hash.split('.')[4]; const ownerToken = new URL(ownerLink).hash.split('.')[3]; const contactToken = new URL(contactLink).hash.split('.')[3];
  const createBodies = traffic.filter((t) => t.body.includes('"op":"create"')).map((t) => t.body).join('\n');
  const everythingSent = traffic.map((t) => `${t.url} ${t.body}`).join('\n');
  const leakedAtCreate = [['the typed supplier text', SENT], ['the key', key], ['the owner code', ownerToken], ['the second-person code', contactToken], ['the caller\'s name', 'Thandi']].filter(([, s]) => createBodies.includes(s)).map(([what]) => what);
  const leakedEver = [['the typed supplier text', SENT], ['the key', key], ['the caller\'s name', 'Thandi']].filter(([, s]) => everythingSent.includes(s)).map(([what]) => what);
  check('making the link sent the server only fingerprints and locked content: no text, no key, no raw code', leakedAtCreate.length === 0 && createBodies.length > 0, `it was sent: ${leakedAtCreate.join(', ')}`);
  check('across everything the owner\'s page has sent so far, the server never received the typed text, the key or the caller\'s name (a raw code is sent only when it is presented to use the link)', leakedEver.length === 0 && traffic.length > 0, `it was sent: ${leakedEver.join(', ')}`);
  check('the owner sees that the answer is awaited, and that Mgadi cannot tell whether the link was opened', /Waiting for your second person/.test(await owner.locator('.tool-status').innerText()) && /cannot tell whether they have opened the link/.test(await owner.locator('.tool-status').innerText()));
  check('the screen tells the owner what the server keeps, and for how long', /7 days/.test(await owner.locator('details.resources').innerText().catch(() => '')) || /7 days/.test(await owner.locator('details.resources').textContent()));

  // ---- 4. The second person: tampering, hostile content, the decision, replay
  const bad = [[contactLink.slice(0, -1), 'a link with its last character cut off'], [contactLink.replace(/\.[A-Za-z0-9_-]{43}$/, (m) => m.slice(0, -1) + (m.endsWith('A') ? 'B' : 'A')), 'a link with one character of the key changed'], [contactLink.replace(contactToken, (contactToken[0] === 'A' ? 'B' : 'A') + contactToken.slice(1)), 'a link with one character of the code changed'], [`${base}/#mgadi=1.c.${'A'.repeat(16)}.${contactToken}.${key}`, 'a link to a record that does not exist']];
  for (const [url, what] of bad) {
    const page = await open(otherCtx, url); await page.waitForSelector('text=This link cannot be used');
    check(`${what}: refused, with nothing decided`, (await page.locator('button:has-text("Approve")').count()) === 0 && /Nothing has been changed/.test(await page.locator('#app').innerText())); await page.close();
  }
  let other = await open(otherCtx, contactLink); await other.waitForSelector('button:has-text("Approve")');
  const seen = await other.locator('#app').innerText();
  check('the second person sees the request, the red flags and the owner\'s reported check, and a warning that Mgadi has not checked who sent it', seen.includes(SENT) && /High: /.test(seen) && /Spoke to: Thandi/.test(seen) && /Number came from: an old invoice or contract/.test(seen) && /Mgadi has not checked who/.test(seen));
  check('hostile text from a link is inert in the second person\'s browser, and nothing in it is a link or a phone link', (await other.locator('#app img, #app a, #app script').count()) === 0 && (await other.evaluate(() => window.__x)) === undefined);
  check('no screen size overflows (390px)', !(await overflow(other)));
  // the owner's page is watching: it must change by itself
  await other.fill('#dec-by', 'Sipho (manager)'); await other.fill('#dec-note', 'Checked the old invoice'); await other.click('button:has-text("Approve")');
  await other.waitForSelector('text=This was approved at');
  check('the decision is recorded and shown as final', /cannot be changed/.test(await other.locator('.tool-status').innerText()) && (await other.locator('button:has-text("Approve")').count()) === 0);
  await other.reload(); await other.waitForSelector('text=This was approved at');
  check('opening the same link again (a replay) only shows the final state; there is nothing to press', (await other.locator('button:has-text("Approve"), button:has-text("Reject")').count()) === 0);
  const flipTo = await api(other, { op: 'decide', id: contactLink.match(/mgadi=1\.c\.([^.]+)\./)[1], token: contactToken, decision: 'rejected' });
  const dup = await api(other, { op: 'decide', id: contactLink.match(/mgadi=1\.c\.([^.]+)\./)[1], token: contactToken, decision: 'approved' });
  check('replaying the request with a different answer is refused (409) and with the same answer changes nothing', flipTo.status === 409 && flipTo.json.status === 'approved' && dup.status === 200 && dup.json.duplicate === true);
  const asOwner = await api(other, { op: 'decide', id: contactLink.match(/mgadi=1\.c\.([^.]+)\./)[1], token: ownerToken, decision: 'approved' });
  check('the owner\'s own code cannot approve the owner\'s own request (403)', asOwner.status === 403);

  // ---- 5. The owner sees the answer by itself, then makes the audit record
  await owner.waitForSelector('text=Approved by the second person', { timeout: 20_000 });
  const answer = await owner.locator('.tool-status').innerText();
  check('the owner\'s open page updated by itself: approved, with the server\'s time, the typed name and note, and that no payment was released or blocked', /Approved by the second person at/.test(answer) && /server clock/.test(answer) && /Sipho \(manager\)/.test(answer) && /Checked the old invoice/.test(answer) && /does not release or block any payment/.test(answer), answer);
  await owner.click('button:has-text("Create the audit record")'); await owner.waitForSelector('.audit .hash');
  const fingerprint = await owner.locator('.audit .hash').innerText();
  check('the audit record shows a SHA-256 fingerprint and says it is not a signature and that Mgadi does not keep it', /^[0-9a-f]{64}$/.test(fingerprint) && /not a signature/.test(await owner.locator('.audit').innerText()) && /does not keep this record/.test(await owner.locator('.audit').innerText()));
  const [download] = await Promise.all([owner.waitForEvent('download'), owner.click('button:has-text("Export the audit record")')]);
  const exported = await download.path(); const record = JSON.parse(fs.readFileSync(exported, 'utf8'));
  check('the export holds the request, red flags, the owner\'s check and the second person\'s decision, and no phone number, link or key', record.format === 'mgadi-supplier-check/1' && record.secondPerson.status === 'approved' && record.request.supplier.includes(SENT) && record.verification.independent === true && record.fingerprint === fingerprint && !/#mgadi|token|\+27/.test(JSON.stringify(record)));
  await owner.click('summary:has-text("Technical")').catch(() => {});
  await owner.setInputFiles('input[aria-label="Audit record to verify"]', exported); await owner.waitForSelector('text=Unchanged: its fingerprint matches.');
  const verifiedOriginal = (await owner.locator('text=Unchanged: its fingerprint matches.').count()) === 1;
  const tampered = { ...record, secondPerson: { ...record.secondPerson, status: 'rejected' } }; fs.writeFileSync('/tmp/mgadi-tampered-audit.json', JSON.stringify(tampered));
  await owner.setInputFiles('input[aria-label="Audit record to verify"]', '/tmp/mgadi-tampered-audit.json'); await owner.waitForSelector('text=This record has been changed.');
  check('the saved record verifies, and changing a single word is caught', verifiedOriginal && (await owner.locator('text=This record has been changed.').count()) === 1 && (await owner.locator('text=Unchanged: its fingerprint matches.').count()) === 0);
  const reopened = await open(ownerCtx, ownerLink); await reopened.waitForSelector('text=Approved by the second person');
  check('the owner\'s own link brings the answer back later, from the server', (await reopened.locator('.tool-status').innerText()).includes('Approved by the second person'));

  // ---- 6. A rejection
  let owner2 = await open(ownerCtx); await startCheck(owner2); await fillRequest(owner2, { supplier: 'Second Supplier', note: 'x' }); await saveVerification(owner2);
  await owner2.click('button:has-text("Create a link for the second person")'); await owner2.waitForSelector('input[aria-label="Link for the second person"]');
  const other2 = await open(otherCtx, await contactLinkOf(owner2)); await other2.waitForSelector('button:has-text("Reject")'); await other2.click('button:has-text("Reject")'); await other2.waitForSelector('text=This was rejected at');
  const owner2Again = await open(ownerCtx, await ownerLinkOf(owner2)); await owner2Again.waitForSelector('text=Rejected by the second person');
  check('a rejection says do not pay to the new details, and still never claims to block anything', /Do not pay to the new details/.test(await owner2Again.locator('.tool-status').innerText()) && !/blocked|stopped the payment/i.test(await owner2Again.locator('#app').innerText()));

  // ---- 7. Hostile links made by someone else, opened by a victim
  const victim = await open(otherCtx);
  const crafted = await victim.evaluate(async () => {
    const m = await import('/shared/seal.js'); const id = m.randomId(); const key = m.newKey(); const owner = m.randomToken(); const contact = m.randomToken();
    const lines = ['<script>window.__pwn=1</script>tel:0821234567 javascript:alert(1) \u202eevil', ...Array.from({ length: 3 }, () => `<img src=x onerror=window.__pwn=2>${'z'.repeat(900)}`)];
    const sealed = await m.seal({ v: 1, type: 'handoff', from: '<b>attacker</b>', summary: { title: '<h1>Urgent</h1>', lines } }, { key, kind: 'handoff', id });
    const r = await fetch('/api/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'create', kind: 'handoff', id, oh: await m.tokenHash(owner), ch: await m.tokenHash(contact), ...sealed }) });
    return { status: r.status, link: m.buildLink(location.origin, 'c', id, contact, key) };
  });
  const victimPage = await open(otherCtx, crafted.link); await victimPage.waitForSelector('button:has-text("Acknowledge")');
  const view = await victimPage.evaluate(() => ({ pwn: window.__pwn, active: document.querySelectorAll('#app img, #app a, #app script, #app [onerror]').length, text: document.querySelector('#app').innerText, lines: [...document.querySelectorAll('.preview-box li')].map((l) => l.textContent.length) }));
  check('a link crafted by an attacker cannot run script or create links or phone links, and its text is cut to length and cleaned', crafted.status === 201 && view.pwn === undefined && view.active === 0 && view.lines.length === 4 && Math.max(...view.lines) <= 400 && !/[<>\u202e]/.test(view.text));
  check('the victim is warned that Mgadi has not checked who sent it and not to use numbers or links inside it', /Mgadi has not checked who sent it/.test(view.text) && /Do not call any number or open any link written inside it/.test(view.text));

  // ---- 8. POPIA draft and the responder handoff, from a real incident pack
  owner = await open(ownerCtx); await makePack(owner);
  check('the pack screen offers the POPIA draft and the helper summary', (await owner.locator('button:has-text("Draft a POPIA notification (template)")').count()) === 1 && (await owner.locator('button:has-text("Send a summary to a helper")').count()) === 1);
  const before = traffic.length;
  await owner.click('button:has-text("Draft a POPIA notification (template)")'); await owner.waitForSelector('.popia-draft');
  await owner.fill('#popia-party', 'Test Co (Pty) Ltd'); await owner.fill('#popia-officer', 'Nomsa Officer');
  const draft = await owner.locator('.popia-draft').innerText();
  check('the POPIA draft says first and last that it is a template for the information officer and not legal advice', /TEMPLATE FOR THE INFORMATION OFFICER TO REVIEW\. NOT LEGAL ADVICE\./.test(await owner.locator('.notice.bad').first().innerText()) && (draft.match(/NOT LEGAL ADVICE/g) ?? []).length === 2);
  check('it is built from the pack, uses what was typed, leaves unknowns as visible blanks, and leaves the decision to the information officer', /Test Co \(Pty\) Ltd/.test(draft) && /Nomsa Officer/.test(draft) && /\[to be completed by the information officer\]/.test(draft) && /Mgadi cannot make it/.test(draft) && /Reference number|Monday 08:00/.test(draft));
  check('it does not carry the business name or the amount from the pack', !/SENTINEL-BUSINESS-PACK|SENTINEL-AMOUNT-PACK/.test(draft));
  const [file] = await Promise.all([owner.waitForEvent('download'), owner.click('button:has-text("Download as a text file")')]);
  const text = fs.readFileSync(await file.path(), 'utf8');
  check('the downloaded text carries the same disclaimer, and drafting sent nothing to any server', /NOT LEGAL ADVICE/.test(text) && /POPIA security compromise notification: DRAFT TEMPLATE/.test(text) && traffic.length === before);
  check('no sideways scroll on the POPIA screen at 390px', !(await overflow(owner)));
  await owner.click('button:has-text("Back to the incident summary")'); await owner.waitForSelector('.pack-summary');

  await owner.click('button:has-text("Send a summary to a helper")'); await owner.waitForSelector('#ho-approve');
  const preview = await owner.locator('.preview-box').innerText();
  check('the preview is shown before anything is shared, says what is not included, and carries no business name, amount or evidence name', /Not included: what the owner wrote about the incident, the business name, any amount/.test(preview) && !/SENTINEL-BUSINESS-PACK|SENTINEL-AMOUNT-PACK/.test(preview));
  check('the status starts as Draft: nothing has been shared, and the link cannot be made until the owner approves', /Draft: nothing has been shared\./.test(await owner.locator('.tool-status').innerText()) && (await owner.locator('button:has-text("Create the link")').isDisabled()));
  await owner.fill('#ho-from', 'The Owner'); await owner.fill('#ho-label', 'My IT person'); await owner.check('#ho-approve');
  const handoffTraffic = traffic.length; await owner.click('button:has-text("Create the link")'); await owner.waitForSelector('input[aria-label="Link for the contact"]');
  check('after approval the status becomes "sent", worded as a link made, and Mgadi says it cannot tell whether it was delivered or opened', /Link created\. Mgadi cannot tell whether it was delivered or opened\./.test(await owner.locator('.tool-status').innerText()) && traffic.length > handoffTraffic);
  const hoLink = await owner.locator('input[aria-label="Link for the contact"]').inputValue();
  check('what was sent to the server for the handoff holds none of the summary text', !traffic.slice(handoffTraffic).map((t) => t.body).join('').match(/Possible|suspicious|CAS 123|Monday 08:00|The Owner/i));

  const contact = await open(otherCtx, hoLink); await contact.waitForSelector('button:has-text("Acknowledge")');
  const contactText = await contact.locator('#app').innerText();
  check('the contact sees the summary and that acknowledging does not mean accepting the work', /CAS 123\/10\/2026/.test(contactText) && /does not mean you have accepted any work/.test(contactText) && /Mgadi has not checked who sent it/.test(contactText));
  const hoParts = new URL(hoLink).hash.slice(1).split('.'); const hoId = hoParts[2]; const hoContactToken = hoParts[3];
  await contact.click('button:has-text("Acknowledge")'); await contact.waitForSelector('text=Acknowledged at');
  await contact.reload(); await contact.waitForSelector('text=Acknowledged at');
  const ackAgain = await api(contact, { op: 'ack', id: hoId, token: hoContactToken });
  check('acknowledging twice is harmless and the first time stands', ackAgain.status === 200 && ackAgain.json.duplicate === true && (await contact.locator('button:has-text("Acknowledge")').count()) === 0);
  await owner.waitForSelector('text=Acknowledged: the contact opened the link', { timeout: 20_000 });
  const ownerAck = await owner.locator('.tool-status').innerText();
  check('the owner\'s page changed to acknowledged by itself, with the server time, and says it does not mean the work was accepted', /Acknowledged at|Acknowledged:/.test(ownerAck) && /does not mean they accepted the work/.test(ownerAck) && /server clock/.test(ownerAck), ownerAck);
  const ownerHoLink = await owner.locator('input[aria-label="Your link to see the status"]').inputValue();
  const sentByOwner = await api(contact, { op: 'ack', id: hoId, token: new URL(ownerHoLink).hash.split('.')[3] });
  check('the sender cannot acknowledge their own summary (403), so nothing can be acknowledged except by the link holder', sentByOwner.status === 403);

  // ---- 9. Failure modes, storage, layout
  const down = await open(ownerCtx); await makePack(down); await down.click('button:has-text("Send a summary to a helper")'); await down.waitForSelector('#ho-approve'); await down.check('#ho-approve');
  await down.route('**/api/links', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"links_unavailable"}' }));
  await down.click('button:has-text("Create the link")'); await down.waitForSelector('text=Sharing links are not available on this server right now. Nothing was sent.');
  check('when the server cannot keep links it says so, nothing was sent, and the status stays a draft', /Draft: nothing has been shared\./.test(await down.locator('.tool-status').innerText()) && (await down.locator('input[aria-label="Link for the contact"]').count()) === 0);
  await down.unroute('**/api/links'); await ownerCtx.setOffline(true);
  await down.click('button:has-text("Create the link")'); await down.waitForSelector('text=This needs an internet connection. Nothing was sent.'); await ownerCtx.setOffline(false);
  check('offline it says it needs the internet, nothing was made, and the status is still a draft', /Draft: nothing has been shared\./.test(await down.locator('.tool-status').innerText()) && (await down.locator('input[aria-label="Link for the contact"]').count()) === 0);
  const stores = await Promise.all([owner, other, contact, down].map((p) => p.evaluate(async () => ({ local: JSON.stringify({ ...localStorage }), session: JSON.stringify({ ...sessionStorage }), cookie: document.cookie, caches: (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat().join(' '), idb: ((await indexedDB.databases?.()) ?? []).length }))));
  check('nothing is kept in browser storage, cookies or the offline cache by any of these screens', stores.every((s) => s.local === '{}' && s.session === '{}' && s.cookie === '' && s.idb === 0 && !/api\/links|mgadi=1|SENTINEL/.test(s.caches)), JSON.stringify(stores).slice(0, 200));
  const narrow = await open(await context(320)); await startCheck(narrow);
  check('the check screen has no sideways scroll at 320px', !(await overflow(narrow))); await fillRequest(narrow); check('and neither has the result screen', !(await overflow(narrow)));
  // ---- 10. Offline, with the SERVER SHUT DOWN (the browser's offline switch alone is not trusted as proof): what still works, and what says it cannot
  const offlineCtx = await context(); const online = await open(offlineCtx);
  await online.waitForFunction(() => document.querySelector('#offline-status')?.dataset.state === 'ready', null, { timeout: 25_000 }); await online.close();
  app.closeAllConnections(); await new Promise((resolve) => app.close(resolve)); await offlineCtx.setOffline(true);
  const off = await open(offlineCtx); await startCheck(off); await fillRequest(off, { supplier: 'Offline Supplier', note: 'x' });
  check('with the server shut down, the app reopens from the saved copy and the supplier check still gives its red flags and VERIFY BEFORE PAYING', /VERIFY BEFORE PAYING/.test(await off.locator('#app .notice').first().innerText()) && /High: /.test(await off.locator('.flags').innerText()));
  await saveVerification(off); await off.click('button:has-text("Create a link for the second person")');
  await off.waitForSelector('text=This needs an internet connection. Nothing was sent.');
  check('offline, making a link says it needs the internet, and nothing is made', (await off.locator('input[aria-label="Link for the second person"]').count()) === 0);
  const offPack = await open(offlineCtx); await makePack(offPack); await offPack.click('button:has-text("Draft a POPIA notification (template)")'); await offPack.waitForSelector('.popia-draft');
  const [offFile] = await Promise.all([offPack.waitForEvent('download'), offPack.click('button:has-text("Download as a text file")')]);
  check('offline, the POPIA draft still works and downloads, with its disclaimer', /NOT LEGAL ADVICE/.test(fs.readFileSync(await offFile.path(), 'utf8')));
  await offPack.click('button:has-text("Back to the incident summary")'); await offPack.click('button:has-text("Send a summary to a helper")'); await offPack.waitForSelector('#ho-approve'); await offPack.check('#ho-approve'); await offPack.click('button:has-text("Create the link")');
  await offPack.waitForSelector('text=This needs an internet connection. Nothing was sent.');
  check('offline, the helper summary says it needs the internet and stays a draft', /Draft: nothing has been shared\./.test(await offPack.locator('.tool-status').innerText()));
  check('no page errors or console errors anywhere', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} finally { await browser.close(); app.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} supplier-check, handoff and POPIA browser checks passed.`);
process.exit(failed.length ? 1 : 0);
