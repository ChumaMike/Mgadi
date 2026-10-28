// The presenter's handwritten workflow: text -> answer simulation -> bank -> feedback -> deny -> manual files -> review -> pack.
import { once } from 'node:events';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createApp } from '../server/app.js';
let chromium;
try { ({ chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright')); }
catch { console.log('SKIPPED: Playwright unavailable. Nothing tested.'); process.exit(0); }
const app = createApp({ env: { MGADI_VOICE_MODE: 'mock' } }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const results = []; const check = (name, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
try {
 await page.goto(`http://127.0.0.1:${app.address().port}`); await page.waitForSelector('.describe-incident');
 await page.locator('.describe-incident > summary').click();
 await page.fill('#incident-description', 'I paid a supplier after an email changed their banking details. The real supplier says the details were fraudulent.');
 await page.getByRole('button', { name: 'Find my next safe step', exact: true }).click();
 await page.waitForSelector('.call-invitation'); check('text query produces honest in-app call invitation', (await page.locator('.call-invitation').innerText()).includes('SIMULATED'));
 await page.getByRole('button', { name: 'Answer Mgadi', exact: true }).click(); await page.waitForSelector('.voice-panel[data-phase="live"]');
 check('Answer opens companion and scripted call', await page.locator('.avatar-dock').isVisible() && await page.locator('.vp-sim').isVisible());
 await page.locator('.vp-bank').click(); check('bank contacts open during call', await page.locator('.bank-popover').isVisible()); await page.locator('.vp-bank').click();
 await page.getByRole('button', { name: 'End call', exact: true }).click();
 check('hanging up returns to bank feedback without claiming a bank call', await page.locator('#bank-feedback').isVisible());
 await page.fill('#bank-feedback', 'Bank gave reference CASE-123. Recall request pending.');
 await page.locator('.step-outcomes').getByRole('button', { name: 'Done', exact: false }).click();
 await page.getByRole('button', { name: 'Skip to evidence and incident pack', exact: true }).click();
 check('skip opens optional evidence assistance', await page.getByRole('button', { name: 'Deny', exact: true }).isVisible());
 check('formal access explanation linked', (await page.getByRole('link', { name: 'What access will Mgadi have?', exact: true }).getAttribute('href')) === '/evidence-access.html');
 await page.getByRole('button', { name: 'Deny', exact: true }).click();
 check('denying leaves manual picker available', await page.locator('#evidence-files').isVisible());
 const bytes = Buffer.from('SYNTHETIC PROOF OF PAYMENT');
 await page.setInputFiles('#evidence-files', { name: 'proof-of-payment.txt', mimeType: 'text/plain', buffer: bytes }); await page.waitForSelector('li:has-text("SHA-256")');
 await page.getByRole('button', { name: 'Review what goes in the pack', exact: true }).click();
 const review = await page.locator('.preview-box').innerText(); const sha = crypto.createHash('sha256').update(bytes).digest('hex');
 check('review shows actual selected filename and fingerprint', review.includes('proof-of-payment.txt') && review.includes(sha));
 check('review shows bank feedback and unfinished actions honestly', review.includes('CASE-123') && review.includes('Not reported yet'));
 await page.getByRole('button', { name: 'Make incident pack', exact: true }).click(); await page.waitForSelector('.pack-summary');
 const pack = JSON.parse(await page.locator('.pack-json').textContent()); check('pack retains metadata and owner bank feedback', pack.evidence[0].sha256 === sha && pack.handoff.bankFeedback.includes('CASE-123'));
 check('skipped-to-evidence actions are not marked complete', pack.handoff.actions.filter(x => x.status === 'reported-by-owner').length === 1);
 const { fingerprint, ...content } = pack; const { canonicalJSON } = await import('../public/shared/sha256.js');
 check('pack SHA-256 is valid', crypto.createHash('sha256').update(canonicalJSON(content)).digest('hex') === fingerprint);
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download incident pack (.json)', exact: true }).click()]);
 check('download matches reviewed generated pack', fs.readFileSync(await download.path(), 'utf8') === JSON.stringify(pack, null, 2));
} catch(e) { console.log('FAIL ', e.stack); results.push(false); }
finally { await browser.close(); app.close(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} presentation checks passed.`);process.exit(results.every(Boolean)?0:1);
