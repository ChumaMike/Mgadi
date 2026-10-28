// Makes a branded, scannable QR code for the FINAL live URL, then DECODES the image it just made and refuses to finish unless the
// decoded text is exactly the URL. A QR that has not been decoded back is not trusted.
//   MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs MGADI_QR_LIBS=/path/to/node_modules node scripts/make-qr.mjs https://the-live-url out-folder
// MGADI_QR_LIBS must hold qrcode, jsqr and pngjs (they are NOT project dependencies; install them in a scratch folder).
// This tool does not check that the URL works. Open it in a signed-out browser, and scan the PNG with a different phone, before printing.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [url, outDir = 'qr-out'] = process.argv.slice(2);
if (!url || !/^https:\/\/[^\s]+$/.test(url)) { console.error('Give the final https URL as the first argument.'); process.exit(2); }
if (/\.invalid\b|example\.(com|org|net)\b|localhost|127\.0\.0\.1/.test(new URL(url).hostname) && process.env.MGADI_QR_ALLOW_TEST !== 'yes') { console.error('That is a test address, not a live one. Refusing (set MGADI_QR_ALLOW_TEST=yes only to test this tool).'); process.exit(2); }
const need = createRequire(path.join(process.env.MGADI_QR_LIBS ?? '.', 'x.js'));
const QRCode = need('qrcode'); const jsQR = need('jsqr'); const { PNG } = need('pngjs');
const { chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright');

fs.mkdirSync(outDir, { recursive: true });
const qrPng = await QRCode.toBuffer(url, { errorCorrectionLevel: 'H', margin: 2, width: 720, color: { dark: '#123c35', light: '#ffffff' } });
const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = `<html><body style="margin:0;background:#f7f4ec;font-family:Arial,sans-serif;color:#123c35"><div style="width:900px;height:1200px;box-sizing:border-box;padding:60px;text-align:center;border:12px solid #123c35;border-bottom:12px solid #e9b44c">
<div style="font-size:84px;font-weight:800;letter-spacing:-3px">Mgadi</div><div style="font-size:34px;margin-top:8px">The First Hour, Guided</div>
<img src="data:image/png;base64,${qrPng.toString('base64')}" style="width:720px;height:720px;margin-top:50px;background:#fff"/>
<div style="font-size:30px;margin-top:30px;font-weight:700">Scan to open Mgadi</div><div style="font-size:24px;margin-top:10px;word-break:break-all">${esc(url)}</div>
<div style="font-size:26px;margin-top:34px">Team soloDolo &middot; HackSecure 2026</div><div style="font-size:20px;margin-top:10px;color:#50645d">Use synthetic information only. This is a hackathon demonstration.</div></div></body></html>`;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
await page.setContent(html); const poster = await page.screenshot({ type: 'png' }); await page.pdf({ path: path.join(outDir, 'mgadi-qr.pdf'), width: '900px', height: '1200px', printBackground: true }); await browser.close();
fs.writeFileSync(path.join(outDir, 'mgadi-qr.png'), poster); fs.writeFileSync(path.join(outDir, 'qr-only.png'), qrPng);

// Decode what was actually written. The poster must scan, not just the bare code.
let bad = 0;
for (const file of ['qr-only.png', 'mgadi-qr.png']) {
  const png = PNG.sync.read(fs.readFileSync(path.join(outDir, file))); const found = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  const ok = found?.data === url; console.log(`${ok ? 'DECODES TO THE URL' : 'FAILED'}  ${file}${ok ? '' : `  got ${JSON.stringify(found?.data)}`}`); if (!ok) bad += 1;
}
console.log(`Wrote ${outDir}/mgadi-qr.png, mgadi-qr.pdf and qr-only.png for ${url}`);
console.log('STILL TO DO BY A PERSON: scan with a different phone, and open the URL in a signed-out browser.');
process.exit(bad ? 1 : 0);
