// Registers the offline service worker and shows an honest status line. All text is set with textContent.
// States (also written to data-state so tests and assistive tools can read them):
//   unsupported  this browser has no service workers        insecure   not HTTPS or localhost, so none can run
//   saving       the offline copy is being saved            ready      every file is saved and verified
//   incomplete   the copy is missing or partial (the browser may have cleared it); it is saved again when online
//   failed       the last attempt could not finish          update     a newer version is ready (see "Updates" below)
//
// Updates. A new version is found by comparing /precache-manifest.json with the worker that is running, now and every few minutes
// while the page is open. When one is ready:
//   - if the person has started nothing (isIdle() is true) it is applied at once, which reloads a page that holds nothing;
//   - otherwise NOTHING is reloaded. A visible banner says a newer version is ready and offers a button. It is applied when the
//     person presses it (after a warning that the screen will be cleared) or when they come back to an empty start screen.
// An update that was already waiting when the page opened is found too (it used to be forgotten after one reload).
export const STALE_AFTER_DAYS = 30;
const PREFIX = 'mgadi-shell-';
const DAY = 86_400_000;

export async function readSavedCopy({ caches: store = globalThis.caches } = {}) {
  if (!store) return { state: 'none' };
  const names = (await store.keys()).filter((name) => name.startsWith(PREFIX));
  if (!names.length) return { state: 'none' };
  // Newest cache that has a manifest. Every listed file must really be there, or the copy counts as incomplete.
  for (const name of names) {
    const cache = await store.open(name);
    const saved = await cache.match('/precache-manifest.json');
    if (!saved) continue;
    const manifest = await saved.json();
    const present = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    const missing = manifest.assets.filter((asset) => !present.has(asset.url));
    let fraudCheckedOn = null;
    try { const lines = await cache.match('/data/fraud-lines.json'); fraudCheckedOn = (await lines.json()).checkedOn; } catch { /* shown only if known */ }
    return { state: missing.length ? 'incomplete' : 'ready', version: manifest.version, builtAt: manifest.builtAt, fraudCheckedOn, missing: missing.length };
  }
  return { state: 'incomplete' };
}

export function describe({ state, copy, online, persisted, now = Date.now() }) {
  const age = copy?.builtAt ? Math.floor((now - Date.parse(copy.builtAt)) / DAY) : null;
  const when = copy?.builtAt ? new Date(copy.builtAt).toISOString().slice(0, 10) : 'unknown date';
  const bank = copy?.fraudCheckedOn ? ` Bank numbers were last checked on ${copy.fraudCheckedOn}.` : '';
  const offlineLead = online ? '' : 'You are offline. ';
  switch (state) {
    case 'unsupported': return `${offlineLead}This browser cannot save Mgadi for offline use. It works while you have internet.`;
    case 'insecure': return `${offlineLead}Offline saving needs a secure (HTTPS) address. It works while you have internet.`;
    case 'saving': return `${offlineLead}Saving Mgadi for offline use. Please stay online for a moment.`;
    case 'failed': return `${offlineLead}Mgadi could not be saved for offline use this time. It still works while you have internet, and it will try again next time.`;
    case 'incomplete': return `${offlineLead}The offline copy is missing or incomplete. ${online ? 'It is being saved again.' : 'Connect to the internet and it will be saved again.'}`;
    case 'update': case 'ready': {
      const old = age !== null && age >= STALE_AFTER_DAYS;
      const lead = online ? `Ready offline. Guide saved on ${when}.` : `You are offline. The guide, bank numbers and incident pack still work from the saved copy of ${when}. Live AI voice and outside links need internet.`;
      const tail = old ? ` This copy is ${age} days old, so guidance and bank numbers may be out of date. Connect to the internet to check for updates.` : '';
      const evict = persisted === false ? ' Your phone can still clear this copy if it runs low on space.' : '';
      const update = state === 'update' ? ' A newer version is ready.' : '';
      return `${lead}${bank}${tail}${update}${evict}`;
    }
    default: return `${offlineLead}Not saved for offline use yet. Open Mgadi once with internet and wait for "Ready offline".`;
  }
}

export const UPDATE_PROTOCOL = '2'; // the worker URL carries p=2, so the worker knows this page can manage updates
const WARNING = 'Switching to the newer version reloads Mgadi and clears what is on this screen, including your current incident. Download your incident pack first if you need it. Your bank fraud line is always at the top. Switch now?';

export async function initOffline({ statusEl, isIdle = () => false, win = globalThis.window, nav = globalThis.navigator, storage = globalThis.caches } = {}) {
  if (!statusEl) return null;
  let state = 'saving'; let copy = null; let persisted = null; let registration = null; let repairing = false; let applying = false;
  const doc = win.document;
  const hadController = { value: Boolean(nav.serviceWorker?.controller) };
  // The banner: the one place a person looks for "update". It is always in the page, empty and collapsed until an update is ready.
  const banner = doc.createElement('div'); banner.id = 'update-banner'; banner.className = 'update-banner'; banner.dataset.open = 'false'; banner.lang = 'en';
  const message = doc.createElement('p'); message.className = 'update-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const button = doc.createElement('button'); button.type = 'button'; button.className = 'button offline-update update-now'; button.textContent = 'Switch to newer version';
  banner.append(message, button); statusEl.before(banner);
  const text = doc.createElement('span'); text.className = 'offline-text'; statusEl.replaceChildren(text);

  // Sticky under the header so it is seen wherever the person has scrolled to; the header's height is measured, not assumed.
  const placeBanner = () => { const header = doc.querySelector('.site-header'); banner.style.top = `${header ? Math.ceil(header.getBoundingClientRect().height) : 0}px`; };
  const showBanner = (busy) => {
    placeBanner(); banner.dataset.open = 'true'; banner.dataset.busy = String(busy);
    const body = busy ? 'A newer version of Mgadi is ready. Your answers are kept until you switch.' : 'A newer version of Mgadi is ready.';
    win.setTimeout(() => { message.textContent = body; }, 80); // after the region is visible, so screen readers announce it
  };
  win.addEventListener('resize', () => { if (banner.dataset.open === 'true') placeBanner(); });
  const render = () => {
    statusEl.dataset.state = state; statusEl.dataset.online = String(nav.onLine !== false);
    text.textContent = describe({ state, copy, online: nav.onLine !== false, persisted });
  };
  const verify = async () => {
    try { copy = await readSavedCopy({ caches: storage }); } catch { copy = { state: 'none' }; }
    if (state === 'update') { render(); return; }
    if (copy.state === 'ready') state = 'ready';
    else if (state === 'ready' || copy.state === 'incomplete') state = 'incomplete';
    render();
  };
  if (!('serviceWorker' in nav)) { state = 'unsupported'; render(); return { getState: () => state }; }
  if (!win.isSecureContext) { state = 'insecure'; render(); return { getState: () => state }; }

  const reloadOnce = () => { if (applying) return; applying = true; win.location.reload(); };
  // Make the newer version the running one. If its worker is waiting, tell it to take over and reload when it has; if it has
  // already taken over, a reload is all that is needed.
  const applyUpdate = () => {
    if (applying) return;
    const waiting = registration?.waiting;
    if (waiting) { nav.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true }); waiting.postMessage({ type: 'SKIP_WAITING' }); }
    else reloadOnce();
  };
  const offerUpdate = () => {
    if (applying) return;
    state = 'update'; render();
    if (isIdle()) { applyUpdate(); return; }
    showBanner(true);
  };
  const applyIfIdle = () => { if (state === 'update' && !applying && isIdle()) applyUpdate(); };

  const known = (reg) => [reg?.active, reg?.waiting, reg?.installing].filter(Boolean).map((worker) => new URL(worker.scriptURL).searchParams.get('v'));
  const watch = (worker) => worker?.addEventListener('statechange', async () => {
    if (worker.state === 'installed' && nav.serviceWorker.controller && registration.waiting) offerUpdate();
    if (worker.state === 'redundant' && state === 'saving') state = 'failed';
    await verify();
  });
  const register = async () => {
    // The version comes from the manifest. Offline, the saved copy's version is used, which is the one already registered.
    let version = null;
    try { const response = await win.fetch('/precache-manifest.json', { cache: 'no-store' }); if (response.ok) version = (await response.json()).version; } catch { /* offline */ }
    version ??= (await readSavedCopy({ caches: storage })).version;
    if (!version || !/^[a-f0-9]{12}$/.test(version)) { state = 'failed'; return; }
    const existing = await nav.serviceWorker.getRegistration();
    if (existing && known(existing).includes(version)) {
      // This version is already installed, active or waiting. Do not register it again: that would rebuild its files while it runs.
      registration = existing;
      if (existing.waiting && nav.serviceWorker.controller) offerUpdate(); // an update that was waiting when this page opened
      watch(existing.installing); existing.addEventListener('updatefound', () => watch(existing.installing));
      return;
    }
    registration = await nav.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}&p=${UPDATE_PROTOCOL}`, { scope: '/', updateViaCache: 'none' });
    watch(registration.installing); registration.addEventListener('updatefound', () => watch(registration.installing));
  };
  // A newer deployment while this page stays open: look again now and then, and whenever the person comes back to it.
  const checkForNewVersion = async () => { if (nav.onLine === false || applying || repairing) return; try { await register(); } catch { /* try again later */ } };

  button.addEventListener('click', () => { if (win.confirm(WARNING)) applyUpdate(); });
  // The worker took over (an update that did not wait, or the button above). A page that was already controlled is now running
  // older files than the worker serves, so it is offered the same choice.
  nav.serviceWorker.addEventListener('controllerchange', () => { if (!hadController.value) { hadController.value = true; return; } if (!applying) offerUpdate(); });
  doc.addEventListener('mgadi:idle', applyIfIdle);
  win.setInterval(() => { applyIfIdle(); }, 15_000);
  win.setInterval(() => { checkForNewVersion(); }, 10 * 60_000);

  // The browser can clear the saved files while the worker stays registered. Registering the same script again would do nothing,
  // so the live worker is asked to save them again (same hash-checked install). If the server has moved to a newer version,
  // that fails on purpose and the newer version is registered instead.
  const askWorkerToRepair = (worker) => new Promise((resolve, reject) => {
    const timer = win.setTimeout(() => { nav.serviceWorker.removeEventListener('message', onMessage); reject(new Error('timeout')); }, 20_000);
    function onMessage(event) {
      if (event.data?.type !== 'REPAIRED' && event.data?.type !== 'REPAIR_FAILED') return;
      win.clearTimeout(timer); nav.serviceWorker.removeEventListener('message', onMessage);
      if (event.data.type === 'REPAIRED') resolve(); else reject(new Error('repair refused'));
    }
    nav.serviceWorker.addEventListener('message', onMessage); worker.postMessage({ type: 'REPAIR' });
  });
  const repair = async () => {
    if (repairing || nav.onLine === false) return; repairing = true; state = 'saving'; render();
    try {
      const worker = registration?.active ?? (await nav.serviceWorker.getRegistration())?.active;
      if (!worker) await register();
      else { try { await askWorkerToRepair(worker); } catch { await register(); } }
    } catch { state = 'failed'; } finally { repairing = false; await verify(); }
  };
  const recheck = async () => { await verify(); if (state === 'incomplete' && nav.onLine !== false) await repair(); else await checkForNewVersion(); };
  win.addEventListener('online', recheck); win.addEventListener('offline', render);
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') recheck(); });

  render();
  // `ready` never settles if the install fails (there is then no active worker), so do not wait for it forever.
  try { await register(); await Promise.race([nav.serviceWorker.ready.catch(() => {}), new Promise((resolve) => win.setTimeout(resolve, 15_000))]); } catch { state = 'failed'; }
  if (state === 'saving' && (await readSavedCopy({ caches: storage })).state === 'none') state = 'failed';
  await verify();
  if (state === 'ready') { try { persisted = (await nav.storage?.persist?.()) ?? null; } catch { persisted = null; } render(); }
  return { getState: () => state, verify, repair, applyIfIdle };
}
