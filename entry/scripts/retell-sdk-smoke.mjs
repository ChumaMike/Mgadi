// Integration test of the REAL Retell browser SDK (the bundled retell-client-js-sdk v3) against a MOCKED provider.
// - Retell's REST API is a local fake server (RETELL_API_BASE), so our server proxy runs for real.
// - api.retellai.com (WebRTC signalling and the transcript WebSocket) is intercepted by Playwright; every other
//   non-local host is blocked. Nothing here can reach the real provider.
// Needs: npm install && npm run vendor, and Playwright:  MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/retell-sdk-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

let chromium;
try { ({ chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright')); }
catch { console.log('SKIPPED: Playwright is not installed. Nothing was tested.'); process.exit(0); }
if (!fs.existsSync(new URL('../public/vendor/retell-client.js', import.meta.url))) { console.log('SKIPPED: run `npm install && npm run vendor` first. Nothing was tested.'); process.exit(0); }

const PRIVATE = 'key_TESTONLY_never_in_browser_1234567890';
const PUBLIC = 'public_key_TESTONLY_for_transcripts';
const upstream = { calls: [] };
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    upstream.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/get-agent/')) return res.end(JSON.stringify({ language: 'en-US', data_storage_setting: 'basic_attributes_only', webhook_url: null }));
    if (req.url === '/v3/create-web-call') { res.statusCode = 201; return res.end(JSON.stringify({ call_id: 'call_fake', access_token: 'tok_fake', transport: 'gateway', ice_servers: [{ urls: 'stun:127.0.0.1:9' }], expires_at: Date.now() + 30000, internal_note: 'must not reach the browser' })); }
    res.statusCode = 404; res.end('{}');
  });
});
fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
const app = createApp({ env: { MGADI_VOICE_MODE: 'retell', RETELL_API_KEY: PRIVATE, RETELL_PUBLIC_KEY: PUBLIC, RETELL_AGENT_ID_EN: 'agent_en', MGADI_VOICE_VERIFIED_LANGUAGES: 'en', RETELL_API_BASE: `http://127.0.0.1:${fake.address().port}` } });
app.listen(0, '127.0.0.1'); await once(app, 'listening');
const base = `http://127.0.0.1:${app.address().port}`;

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`); };
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
const page = await context.newPage();
const seen = { whip: [], blocked: [], requests: [], wsUrls: [], errors: [] };
await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
page.on('pageerror', (e) => seen.errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') seen.errors.push(m.text()); });
page.on('request', async (r) => { seen.requests.push({ url: r.url(), headers: await r.allHeaders().catch(() => ({})), body: r.postData() }); });

// Block every host except our own server and the mocked api.retellai.com.
await context.route((url) => !['127.0.0.1', 'localhost', 'api.retellai.com'].includes(url.hostname) && url.protocol.startsWith('http'), (route) => { seen.blocked.push(route.request().url()); route.abort(); });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let sessionAnswer;
await context.route('https://api.retellai.com/**', async (route) => {
  const request = route.request(); const url = new URL(request.url());
  seen.whip.push({ method: request.method(), path: url.pathname, auth: (await request.allHeaders()).authorization });
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (request.method() === 'POST' && url.pathname.endsWith('/v1/webrtc/sessions')) {
    const { sdp } = JSON.parse(request.postData());
    // Play the gateway: answer the browser's real WebRTC offer from a second peer connection in the page.
    const answer = await page.evaluate(async (offer) => {
      const gateway = new RTCPeerConnection(); window.__gateway = gateway;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((t) => gateway.addTrack(t, stream));
      await gateway.setRemoteDescription({ type: 'offer', sdp: offer }); const a = await gateway.createAnswer(); await gateway.setLocalDescription(a); return gateway.localDescription.sdp;
    }, sdp);
    sessionAnswer = answer;
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ session_id: 'sess_1', sdp: answer }) });
  }
  return route.fulfill({ status: 204, headers: cors });
});
// The transcript stream: a mocked monitor WebSocket that behaves like Retell's documented protocol.
await page.routeWebSocket('wss://api.retellai.com/v2/monitor-call/call_fake', (ws) => {
  seen.wsUrls.push(ws.url());
  setTimeout(() => ws.send(JSON.stringify({ type: 'transcript_snapshot', transcripts: [{ id: 'agent_0', role: 'agent', content: 'Hello. I am the Mgadi assistant, an AI.', time_sec: 0.4 }], pre_session_transcripts: [] })), 200);
  setTimeout(() => ws.send(JSON.stringify({ type: 'transcript_updated', transcripts: [{ id: 'user_0', role: 'user', content: 'I paid the wrong account', time_sec: 4 }] })), 700);
  setTimeout(() => ws.send(JSON.stringify({ type: 'transcript_updated', transcripts: [{ id: 'agent_1', role: 'agent', content: 'Please use the Bank fraud line button now.', time_sec: 7 }] })), 1200);
  setTimeout(() => { ws.send(JSON.stringify({ type: 'call_ended', disconnection_reason: 'agent_hangup' })); ws.close({ code: 1000, reason: 'call_ended' }); }, 6000);
});

try {
  await page.goto(`${base}/`); await page.waitForSelector('h1');
  await page.locator('.incident-choices button:has-text("I paid after")').click(); await page.waitForSelector('text=Step 1 of');
  await page.click('.voice-launch'); await page.waitForSelector('.voice-panel:not([hidden])');
  check('live mode: no SIMULATED badge', await page.locator('.vp-sim').isHidden());
  check('live mode: voice can be started in English once the person agrees', await page.locator('.vp-start').isDisabled() && (await page.check('#voice-consent-check'), !(await page.locator('.vp-start').isDisabled())));
  await page.click('.vp-start');
  await page.waitForSelector('.vp-status:has-text("Connected")', { timeout: 15_000 });
  check('the real SDK connected: status is Connected', true);
  await page.waitForSelector('.msg-assistant', { timeout: 10_000 }); await page.waitForSelector('.msg-user', { timeout: 10_000 });
  const chat = await page.locator('.vp-chat .msg:not(.msg-system) .said').allInnerTexts();
  check('live transcript from the SDK shows distinct assistant and user messages', chat[0].includes('Mgadi assistant') && chat[1] === 'I paid the wrong account', JSON.stringify(chat));
  check('the transcript socket targets the documented monitor endpoint', seen.wsUrls[0] === 'wss://api.retellai.com/v2/monitor-call/call_fake', seen.wsUrls[0]);
  check('captions are reported as on', (await page.locator('.vp-chips').innerText()).includes('Captions stay on this screen only'));

  const create = upstream.calls.find((c) => c.url === '/v3/create-web-call');
  check('our server created the call with the PRIVATE key', create?.auth === `Bearer ${PRIVATE}`);
  check('the upstream request was built by the server: fixed agent, retention override, no visitor-chosen fields', create?.body.agent_id === 'agent_en' && create.body.agent_override.agent.data_storage_setting === 'basic_attributes_only' && create.body.metadata.app === 'mgadi' && create.body.retell_llm_dynamic_variables.current_step.includes("Call your bank's fraud line"), JSON.stringify(create?.body).slice(0, 300));
  const toProxy = seen.requests.find((r) => r.url === `${base}/api/voice/session`);
  check('the browser called only our proxy, with the consent header and no SDK credentials', toProxy && toProxy.headers['x-mgadi-voice-consent'] === 'voice-consent-1' && !toProxy.headers.authorization, JSON.stringify(toProxy?.headers));
  const whip = seen.whip.find((w) => w.method === 'POST' && w.path.endsWith('/v1/webrtc/sessions'));
  check('WebRTC signalling goes to the gateway proxy path with the per-call token only', whip?.path === '/webrtc-proxy/call_fake/v1/webrtc/sessions' && whip.auth === 'Bearer tok_fake', JSON.stringify(whip));
  const everything = JSON.stringify(seen.requests) + JSON.stringify(seen.whip) + await page.content();
  check('the private key never appears in any browser request, header or page content', !everything.includes(PRIVATE));
  check('provider-internal fields from the create response never reach the browser', !everything.includes('internal_note'));
  check('no request went to any host other than our server and the mocked Retell host', seen.blocked.length === 0, JSON.stringify(seen.blocked));
  check('the CSP allowed the Retell host and blocked nothing', (await page.evaluate(() => window.__csp)).length === 0, JSON.stringify(await page.evaluate(() => window.__csp)));
  check('the microphone permission policy allows our own page', (await (await fetch(`${base}/`)).headers.get('permissions-policy')).includes('microphone=(self)'));

  await page.click('.vp-controls button:has-text("Mute")'); check('mute works on the real SDK session', (await page.locator('.vp-status').innerText()).includes('Muted'));
  await page.click('.vp-controls button:has-text("Unmute")');
  await page.waitForSelector('.vp-status:has-text("ended")', { timeout: 15_000 });
  check('the provider ending the call ends the conversation without a reconnect', (await page.locator('.msg-system:has-text("Reconnect")').count()) === 0);
  check('history is kept after the call', (await page.locator('.vp-chat .msg:not(.msg-system)').count()) === 3);
  check('the SDK released the gateway session on close', seen.whip.some((w) => w.method === 'DELETE'));
  check('no page errors', seen.errors.length === 0, JSON.stringify(seen.errors));
} finally { await browser.close(); app.close(); fake.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} real-SDK checks passed (provider mocked).`);
process.exit(failed.length ? 1 : 0);
