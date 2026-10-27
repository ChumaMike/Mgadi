import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const parse = (csp) => Object.fromEntries(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [name, ...values] = d.split(/\s+/); return [name, values]; }));

async function localHeaders(t) {
  const server = createApp(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  return { csp: response.headers.get('content-security-policy'), permissions: response.headers.get('permissions-policy') };
}
const hostedHeaders = () => Object.fromEntries(vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));

for (const [name, get] of [['local server', localHeaders], ['Vercel config', async () => { const h = hostedHeaders(); return { csp: h['Content-Security-Policy'], permissions: h['Permissions-Policy'] }; }]]) {
  test(`${name}: voice opens the microphone for our own origin only, and nothing else`, async (t) => {
    const { permissions } = await get(t);
    assert.equal(permissions, 'camera=(), microphone=(self), geolocation=(), payment=()');
  });

  test(`${name}: CSP adds only Retell's API host for connections and keeps scripts, styles and framing locked`, async (t) => {
    const { csp } = await get(t);
    const d = parse(csp);
    assert.deepEqual(d['connect-src'], ["'self'", 'https://api.retellai.com', 'wss://api.retellai.com']);
    assert.deepEqual(d['script-src'], ["'self'"]);
    assert.deepEqual(d['style-src'], ["'self'"]);
    assert.deepEqual(d['default-src'], ["'self'"]);
    assert.deepEqual(d['frame-ancestors'], ["'none'"]);
    assert.deepEqual(d['object-src'], ["'none'"]);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|livekit|\*/, 'no wildcards, no unsafe directives, no LiveKit hosts (v3 uses the gateway transport)');
  });
}

test('the Vercel voice functions are configured, and the build makes the vendor bundle, the icons and the offline manifest', () => {
  assert.equal(vercel.buildCommand, 'npm run build');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.build, 'node scripts/build.mjs');
  const build = fs.readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(build, /vendor-retell\.mjs/); assert.match(build, /writeIcons/); assert.match(build, /precache-manifest\.json/);
  const headers = Object.fromEntries(vercel.headers.map((h) => [h.source, Object.fromEntries(h.headers.map((x) => [x.key, x.value]))]));
  assert.equal(headers['/sw.js']['Cache-Control'], 'no-cache', 'the worker is always revalidated so updates are found');
  assert.equal(headers['/precache-manifest.json']['Cache-Control'], 'no-store');
  assert.match(headers['/manifest.webmanifest']['Content-Type'], /manifest\+json/);
  assert.ok(vercel.functions['api/voice/*.js']);
  assert.match(JSON.stringify(vercel.functions), /public\/data\/playbook\.json/);
  for (const file of ['config', 'session']) assert.ok(fs.existsSync(new URL(`../api/voice/${file}.js`, import.meta.url)));
});

test('the Retell SDK is pinned exactly and no private key is referenced in browser code', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.dependencies['retell-client-js-sdk'], /^\d+\.\d+\.\d+$/);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() && e.name !== 'vendor' ? walk(new URL(`${e.name}/`, d)) : e.isFile() ? [new URL(e.name, d)] : []));
  for (const file of walk(new URL('../public/', import.meta.url))) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /RETELL_API_KEY|key_[a-f0-9]{16,}/i, file.pathname);
});
