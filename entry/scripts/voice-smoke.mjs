// Browser smoke test for the voice companion, using the labelled SIMULATION adapter. No real provider, microphone or
// network is used, and nothing leaves this machine. Optional dev tool (needs Playwright):
//   MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/voice-smoke.mjs
import { once } from 'node:events';
import { createApp } from '../server/app.js';

let chromium;
try { ({ chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright')); }
catch { console.log('SKIPPED: Playwright is not installed (set MGADI_PLAYWRIGHT). Nothing was tested.'); process.exit(0); }

const app = createApp({ env: { MGADI_VOICE_MODE: 'mock' } });
app.listen(0, '127.0.0.1'); await once(app, 'listening');
const base = `http://127.0.0.1:${app.address().port}`;
const browser = await chromium.launch();
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`); };

const open = async ({ width = 390, height = 844, query = 'mockvoice=fast', reducedMotion = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage(); page.errors = []; page.requests = [];
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  page.on('pageerror', (e) => page.errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('request', (r) => page.requests.push({ url: r.url(), body: r.postData() }));
  await page.goto(`${base}/?${query}`); await page.waitForSelector('h1'); return page;
};
const begin = async (page) => { await page.locator('.incident-choices button:has-text("Money or a payment problem")').click(); await page.locator('.incident-choices button:has-text("I paid after")').click(); await page.waitForSelector('text=Step 1 of'); };
const launch = async (page) => { await page.click('.voice-launch'); await page.waitForSelector('.voice-panel:not([hidden])'); };
const talk = async (page) => { await page.check('#voice-consent-check'); await page.click('.vp-start'); await page.waitForSelector('.vp-status:has-text("Connected")'); };
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') }; }, sel);
const hit = (a, b) => a && b && a.visible && b.visible && !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
const label = (page) => page.locator('.avatar-dock [role="img"]').getAttribute('aria-label');
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const dockButtons = (page) => page.evaluate(() => [...document.querySelectorAll('.vp-controls button, .vp-btnrow button, #emergency-button')].filter((b) => !b.closest('[hidden]') && b.offsetWidth > 0).map((b) => { const r = b.getBoundingClientRect(); return { n: b.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height, visible: true }; }));

try {
  // 1. Entry points, consent and the simulation label.
  let page = await open();
  check('launch button on the home screen', (await page.locator('.voice-launch').count()) === 1);
  await begin(page);
  check('launch button on every guidance step', (await page.locator('.voice-launch').count()) === 1);
  await launch(page);
  check('panel says SIMULATED in simulation mode', await page.locator('.vp-sim').isVisible());
  check('start is disabled until the person agrees', await page.locator('.vp-start').isDisabled());
  await page.check('#voice-consent-check'); check('start enables after agreeing', !(await page.locator('.vp-start').isDisabled()));
  await page.uncheck('#voice-consent-check');

  // 1b. Keyboard and screen readers: focus moves into the panel, Escape closes it when idle, focus returns to the launcher.
  await page.keyboard.press('Escape'); await page.waitForSelector('.voice-panel', { state: 'hidden' });
  check('Escape closes an idle panel and returns focus to the launch button', await page.evaluate(() => document.activeElement?.classList.contains('voice-launch')));
  await page.focus('.voice-launch'); await page.keyboard.press('Enter'); await page.waitForSelector('.voice-panel:not([hidden])');
  check('opening the panel moves keyboard focus into it', await page.evaluate(() => document.activeElement?.closest('.voice-panel') !== null));
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
  check('tabbing stays reachable and never lands behind the panel', await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !top || document.activeElement.contains(top) || top.contains(document.activeElement); }));
  // 2. Live conversation: states, transcript, chat stays visible, distinct roles.
  await talk(page);
  await page.waitForSelector('.msg-assistant'); await page.waitForSelector('.msg-user', { timeout: 10_000 });
  check('chat shows distinct You and assistant messages', (await page.locator('.msg-user .who').innerText()) === 'You' && (await page.locator('.msg-assistant .who').first().innerText()).includes('Mgadi assistant (AI)'));
  await page.waitForFunction(() => /said:/.test(document.querySelector('.vp-body .sr-only')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  check('finished messages are announced to screen readers, unfinished ones are not', /(Mgadi assistant|You) said: /.test(await page.locator('.vp-body .sr-only').innerText()));
  check('chat is a labelled log region and stays visible', (await page.locator('.vp-chat').getAttribute('role')) === 'log' && await page.locator('.vp-chat').isVisible());
  await page.waitForFunction(() => document.querySelector('.avatar-dock [role="img"]')?.getAttribute('aria-label')?.includes('speaking'), null, { timeout: 8000 }).catch(() => {});
  check('avatar shows the speaking state', (await label(page)).includes('speaking'), await label(page));
  await page.waitForFunction(() => document.querySelector('.avatar-dock [role="img"]')?.getAttribute('aria-label')?.includes('listening'), null, { timeout: 8000 }).catch(() => {});
  check('avatar shows the listening state', (await label(page)).includes('listening'), await label(page));
  check('avatar says it is not a sign language translator', (await label(page)).includes('not a sign language translation'));
  check('privacy summary is visible while connected and its details say Mgadi saves nothing', /Simulation/.test(await page.locator('.vp-privacyline summary').innerText()) && (await page.locator('.vp-chips').textContent()).includes('saves no audio or transcript') && (await page.locator('.vp-chips').textContent()).includes('No microphone · simulation'));
  check('the current action is always visible in the header', (await page.locator('.vp-now').innerText()).includes("Call your bank's fraud line now"));

  // 3. Nothing covers the bank button or the call controls (Playwright refuses to click covered elements).
  for (const [name, sel] of [['site header bank button', '#emergency-button'], ['panel bank button', '.vp-bank']]) {
    let ok = true;
    try {
      await page.click(sel, { timeout: 3000 }); await page.waitForSelector('h1:has-text("Call your bank now")');
      await page.click('a[href^="tel:"]', { trial: true, timeout: 3000 }); // the official numbers are tappable, not covered
      await page.click('button:has-text("Back")', { timeout: 3000 });
    } catch (e) { ok = false; }
    check(`${name}: opens the bank numbers, which are tappable, during the call`, ok);
    await page.click('.vp-btnrow button[aria-expanded]').catch(() => {}); // expand the panel again if it was minimised
  }
  await page.click('.vp-controls button:has-text("Mute")', { timeout: 3000 }); await page.click('.vp-controls button:has-text("Unmute")', { timeout: 3000 }); check('mute is clickable during the call', true);
  const avatar = await rect(page, '.avatar-dock'); const all = await dockButtons(page);
  check('avatar overlaps no control or bank button (390px)', all.every((b) => !hit(avatar, b)), JSON.stringify({ avatar, all }));
  check('call survived opening the bank list', (await page.locator('.vp-status').innerText()) !== '' && (await page.locator('.vp-end, .vp-controls button:has-text("End call")').count()) > 0);

  // 4. Mute, end, history, privacy.
  await page.click('.vp-controls button:has-text("Mute")');
  check('muting shows the muted status and the avatar\'s mic-muted badge', (await page.locator('.vp-status').innerText()).includes('Muted') && (await page.locator('.avatar-badge').innerText()) === 'Mic muted' && (await label(page)).includes('muted, so Mgadi cannot hear you'));
  await page.click('.vp-controls button:has-text("Unmute")');
  const chatBefore = await page.locator('.msg-assistant .said').allInnerTexts();
  await page.click('.vp-controls button:has-text("End call")'); await page.waitForSelector('.vp-status:has-text("ended")');
  check('history stays after the call ends', (await page.locator('.msg-assistant .said').allInnerTexts()).join() === chatBefore.join());
  check('avatar disappears when the conversation ends', await page.locator('.avatar-dock').isHidden());
  const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
  check('nothing is stored in the browser', stored === '{"l":{},"s":{}}', stored);
  const external = page.requests.filter((r) => !r.url.startsWith(base) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  check('simulation sends nothing to any other host', external.length === 0, JSON.stringify(external.map((r) => r.url)));
  check('no transcript text is ever sent in a request', !page.requests.some((r) => r.body && /supplier into a new account|Mgadi assistant/.test(r.body)));
  await page.evaluate(() => { document.querySelector('.vp-progress').open = true; });
  const tl = await page.locator('.vp-timeline').innerText();
  check('timeline records voice events without any transcript content', /Voice conversation started/.test(tl) && /Voice conversation ended/.test(tl) && !/worried|supplier into/.test(tl), tl);
  check('no CSP violations and no page errors', (await page.evaluate(() => window.__csp)).length === 0 && page.errors.length === 0, JSON.stringify([await page.evaluate(() => window.__csp), page.errors]));

  // 5. Connected actions: only the person confirms steps; progress is shared with the text screens.
  check('the scripted assistant confirmed nothing by itself', (await page.locator('.vp-task.confirmed').count()) === 0);
  await page.click('.vp-controls button:has-text("Use text guidance")').catch(() => {});
  page = await open(); await begin(page); await launch(page);
  await page.locator('.vp-action > summary').click(); await page.click('.vp-action button:has-text("I\'ve called the bank")');
  check('confirming in the panel advances the main journey', /step 2 of/i.test(await page.locator('.step-count').innerText()));
  check('the panel shows the new current action', (await page.locator('.vp-now').innerText()).includes('Confirm with your supplier'));
  await page.evaluate(() => { document.querySelector('.vp-progress').open = true; });
  check('tasks show Done and Now', (await page.locator('.vp-task.confirmed .mark').innerText()) === 'Done' && (await page.locator('.vp-task.now .mark').count()) === 1);
  check('timeline shows the confirmation', (await page.locator('.vp-timeline').innerText()).includes("I've called the bank"));
  await page.click('.vp-controls button:has-text("Use text guidance")');
  check('switching to text keeps progress and closes the panel', await page.locator('.voice-panel').isHidden() && /step 2 of/i.test(await page.locator('.step-count').innerText()));
  await page.click('.voice-launch'); check('reopening the panel shows the same progress', (await page.locator('.vp-task.confirmed').count()) === 1);

  // 6. Failure and recovery states.
  page = await open({ query: 'mockvoice=fast,fail-mic' }); await begin(page); await launch(page);
  await page.check('#voice-consent-check'); await page.click('.vp-start'); await page.waitForSelector('.vp-status:has-text("connect")');
  const failText = await page.locator('.vp-avail').innerText();
  check('microphone denied: clear message that mentions the bank fraud line', /Microphone permission was blocked/.test(failText) && /bank fraud line/i.test(failText), failText);
  check('failed state offers "Try again" and text guidance', (await page.locator('.vp-start').innerText()) === 'Try again' && await page.locator('.vp-controls button:has-text("Use text guidance")').isVisible());
  page = await open({ query: 'mockvoice=fast,fail-provider' }); await begin(page); await launch(page); await page.check('#voice-consent-check'); await page.click('.vp-start');
  await page.waitForSelector('.vp-avail:has-text("not available")'); check('provider failure is explained plainly', true);
  page = await open({ query: 'mockvoice=drop' }); await begin(page); await launch(page); await talk(page);
  await page.waitForSelector('.vp-status:has-text("Reconnecting")', { timeout: 12_000 });
  check('a dropped connection shows Reconnecting', true);
  await page.waitForSelector('.vp-status:has-text("Connected")', { timeout: 12_000 });
  check('it reconnects and the earlier messages are still there', (await page.locator('.msg-assistant').count()) >= 1 && (await page.locator('.msg-system:has-text("Reconnected")').count()) === 1);
  page = await open({ query: 'mockvoice=nocaptions' }); await begin(page); await launch(page); await talk(page);
  await page.waitForSelector('.vp-avail:has-text("captions are not available")', { timeout: 25_000 });
  check('missing live captions are reported honestly', true);

  // 7. Languages: capability messages, history kept, strings follow the language.
  page = await open(); await begin(page); await launch(page); await talk(page); await page.waitForSelector('.msg-assistant');
  const before = await page.locator('.msg').count();
  await page.evaluate(() => { document.querySelector('#accessibility details').open = true; });
  await page.selectOption('#language', 'zu');
  await page.waitForSelector('.vp-status:has-text("ended")');
  check('switching to isiZulu ends voice, keeps the whole conversation and explains why', (await page.locator('.msg').count()) >= before && (await page.locator('.msg-system').last().innerText()).includes('not available in this language'));
  check('isiZulu: capability stated, voice start disabled, text guidance kept', (await page.locator('.vp-avail').innerText()).includes('Retell does not list this language') && await page.locator('.vp-start').isDisabled());
  check('the interface follows the language while the progress card stays', (await page.locator('.step-count').count()) === 1);
  await page.selectOption('#language', 'af');
  check('Afrikaans: the simulation says it covers English only', (await page.locator('.vp-avail').innerText()).includes('covers English only'));
  await page.selectOption('#language', 'xh'); check('isiXhosa: voice unavailable', await page.locator('.vp-start').isDisabled());
  await page.selectOption('#language', 'en'); check('English: voice can start again', !(await page.locator('.vp-start').isDisabled()));

  // 8. Floating avatar: size, hide, reduced motion, low-data, keyboard.
  page = await open(); await begin(page); await launch(page); await talk(page);
  check('avatar starts minimised', (await page.evaluate(() => document.documentElement.dataset.avatar)) === 'min');
  await page.click('.avatar-btn[aria-label*="larger"]'); check('expand makes the avatar larger', (await page.evaluate(() => document.documentElement.dataset.avatar)) === 'max');
  let a2 = await rect(page, '.avatar-dock'); let c2 = await dockButtons(page);
  check('expanded avatar still overlaps no control', c2.every((b) => !hit(a2, b)), JSON.stringify({ a2, c2 }));
  await page.focus('.avatar-btn[aria-expanded="true"]'); await page.keyboard.press('Escape');
  check('Escape minimises the expanded avatar', (await page.evaluate(() => document.documentElement.dataset.avatar)) === 'min');
  check('avatar buttons are keyboard focusable with names', (await page.locator('.avatar-btn').evaluateAll((b) => b.every((x) => x.tabIndex >= 0 && x.getAttribute('aria-label')))));
  await page.click('.avatar-btn[aria-label*="Hide"]');
  check('hiding removes the avatar and offers Show avatar', await page.locator('.avatar-dock').isHidden() && await page.locator('.vp-controls button:has-text("Show avatar")').isVisible());
  await page.click('.vp-controls button:has-text("Show avatar")'); check('Show avatar brings it back', await page.locator('.avatar-dock').isVisible());
  await page.evaluate(() => { document.querySelector('#accessibility details').open = true; });
  await page.check('#text-only'); check('low-data mode hides the avatar', await page.locator('.avatar-dock').isHidden()); await page.uncheck('#text-only');
  // A WebGL canvas cannot be read back with toDataURL outside its own draw call, so compare what is actually on screen.
  const snap = async () => (await page.locator('.avatar-figure').screenshot()).toString('base64');
  // Sample only once the scripted conversation has finished and the state is steady, so any difference is animation, not a state change.
  const steady = async () => { await page.waitForSelector('.msg-assistant:nth-of-type(2), .vp-chat .msg-assistant >> nth=1', { timeout: 15_000 }).catch(() => {}); let last = ''; let since = Date.now(); for (let i = 0; i < 80; i += 1) { const now = await page.locator('.vp-activity').innerText(); if (now !== last) { last = now; since = Date.now(); } if (now === 'Listening' && Date.now() - since > 1200) return; await page.waitForTimeout(100); } };
  const samples = async (n, gap) => { await snap(); await page.waitForTimeout(gap); /* the first capture re-composites the element: discard it */ const out = new Set(); for (let i = 0; i < n; i += 1) { out.add(await snap()); await page.waitForTimeout(gap); } return out.size; };
  await steady();
  check('with motion allowed the avatar animates while the state is steady', (await samples(8, 300)) > 1);
  await page.check('#reduced-motion'); await page.waitForTimeout(200);
  check('with reduce-movement on, the avatar is completely still while the state is steady', (await samples(8, 300)) === 1);
  page = await open({ reducedMotion: true }); await begin(page); await launch(page); await talk(page); await steady();
  check('the operating-system reduced-motion preference is honoured (completely still)', (await samples(8, 300)) === 1);

  // 9. Layout at several sizes: no overlaps, no sideways scroll, bank button reachable.
  for (const [w, h] of [[320, 568], [360, 740], [768, 1024], [1280, 800]]) {
    page = await open({ width: w, height: h }); await begin(page); await launch(page); await talk(page);
    const av = await rect(page, '.avatar-dock'); const btns = await dockButtons(page); const panel = await rect(page, '.voice-panel'); const header = await rect(page, '.site-header');
    check(`${w}x${h}: avatar overlaps no control or bank button`, btns.every((b) => !hit(av, b)), JSON.stringify({ av, btns }));
    check(`${w}x${h}: panel stays below the site header and inside the screen`, panel.y >= header.y + header.h - 1 && panel.y + panel.h <= h + 1 && panel.x >= -1 && panel.x + panel.w <= w + 1, JSON.stringify({ panel, header }));
    check(`${w}x${h}: no sideways scroll`, !(await overflowX(page)));
    let ok = true; try { await page.click('#emergency-button', { timeout: 3000 }); await page.waitForSelector('h1:has-text("Call your bank now")'); } catch { ok = false; }
    check(`${w}x${h}: the site bank button works during the call`, ok);
  }
  page = await open({ width: 320, height: 640 }); await page.click('#accessibility > details > summary'); await page.selectOption('#text-size', 'largest'); await page.click('#accessibility > details > summary'); await begin(page); await launch(page); await talk(page);
  check('320px at 200% text: no sideways scroll with the panel open', !(await overflowX(page)));
  const big = await dockButtons(page); const bigAvatar = await rect(page, '.avatar-dock');
  check('320px at 200% text: the avatar steps aside rather than cover anything', await page.locator('.avatar-dock').isHidden() && big.every((b) => !hit(bigAvatar, b)), JSON.stringify({ bigAvatar, big }));
  await page.evaluate(() => document.querySelector('.vp-chat').scrollIntoView());
  check('320px at 200% text: the conversation is reachable by scrolling the panel', (await rect(page, '.vp-chat')).visible);
  // 11. Connection lost in the middle of a live conversation (airplane mode): clean end, nothing lost, offline guide offered.
  page = await open({ query: 'mockvoice=fast' }); await begin(page); await page.click('button:has-text("I\'ve called the bank")'); await page.waitForSelector('text=Step 2 of'); await launch(page); await talk(page);
  await page.waitForSelector('.msg-assistant'); await page.waitForSelector('.msg-user');
  const heard = await page.locator('.vp-chat .msg:not(.msg-system) .said').allInnerTexts();
  const requestsBefore = page.requests.length;
  await page.context().setOffline(true);
  await page.waitForSelector('.vp-avail:has-text("internet connection")');
  check('losing the internet mid-call ends it with an honest message (live AI voice needs internet)', (await page.locator('.vp-status').innerText()).includes("Couldn't connect") && /needs an internet connection/.test(await page.locator('.vp-avail').innerText()));
  const kept = await page.locator('.vp-chat .msg:not(.msg-system) .said').allInnerTexts();
  check('the conversation already shown is kept (nothing disappears or is rewritten; a message still being spoken may have grown)', kept.length >= heard.length && heard.length >= 2 && heard.every((text, i) => kept[i].startsWith(text)), JSON.stringify({ heard, kept }));
  check('the message points to the guide on this phone', /guide on this phone/.test(await page.locator('.vp-avail').innerText()));
  check('the call controls reset: no mute or end buttons, and no microphone indicator left on', (await page.locator('.vp-controls button:has-text("End call")').isHidden()) && (await page.locator('.vp-mic').isHidden()) && (await page.locator('.vp-privacyline summary').innerText()).startsWith('Simulation'));
  check('the current action and the progress are unchanged', (await page.locator('.vp-now').innerText()).startsWith('Now:') && (await page.locator('.vp-count').textContent()).includes('step 2 of 4'));
  check('the Bank fraud line button in the panel still works', await page.locator('.vp-bank').isEnabled());
  await page.waitForTimeout(6000);
  check('nothing retries or restarts while offline', (await page.locator('.vp-status').innerText()).includes("Couldn't connect") && page.requests.slice(requestsBefore).filter((r) => r.url.includes('/api/voice/session')).length === 0);
  await page.context().setOffline(false);
  await page.waitForTimeout(800);
  check('coming back online does not silently restart the call; the person chooses "Try again"', (await page.locator('.vp-status').innerText()).includes("Couldn't connect") && (await page.locator('.vp-start').innerText()) === 'Try again');
  await page.click('.vp-controls button:has-text("Use text guidance")');
  check('"Use text guidance" returns to the same step, with progress kept', /step 2 of/i.test(await page.locator('.step-count').innerText()));
  check('no page errors during the connection loss', page.errors.length === 0, JSON.stringify(page.errors));

} finally { await browser.close(); app.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} voice browser checks passed.`);
process.exit(failed.length ? 1 : 0);
