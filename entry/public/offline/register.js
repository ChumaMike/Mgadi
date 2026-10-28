// Registers the offline service worker and shows an honest status line. All text is set with textContent.
// States (also written to data-state so tests and assistive tools can read them):
//   unsupported  this browser has no service workers        insecure   not HTTPS or localhost, so none can run
//   saving       the offline copy is being saved            ready      every file is saved and verified
//   incomplete   the copy is missing or partial (the browser may have cleared it); it is saved again when online
//   failed       the last attempt could not finish          update     a newer version is waiting for the next visit
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
      const update = state === 'update' ? ' A newer version is ready and will be used the next time you open Mgadi.' : '';
      return `${lead}${bank}${tail}${update}${evict}`;
    }
    default: return `${offlineLead}Not saved for offline use yet. Open Mgadi once with internet and wait for "Ready offline".`;
  }
}

export async function initOffline({ statusEl, win = globalThis.window, nav = globalThis.navigator, storage = globalThis.caches } = {}) {
  if (!statusEl) return null;
  let state = 'saving'; let copy = null; let persisted = null; let registration = null; let repairing = false;
  const button = win.document.createElement('button'); button.type = 'button'; button.className = 'button secondary offline-update'; button.textContent = 'Use the newer version now'; button.hidden = true;
  const text = win.document.createElement('span'); text.className = 'offline-text';
  statusEl.replaceChildren(text, button);
  const render = () => {
    statusEl.dataset.state = state; statusEl.dataset.online = String(nav.onLine !== false);
    text.textContent = describe({ state, copy, online: nav.onLine !== false, persisted });
    button.hidden = state !== 'update';
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

  const register = async () => {
    // The version comes from the manifest. Offline, the saved copy's version is used, which is the one already registered.
    let version = null;
    try { const response = await win.fetch('/precache-manifest.json', { cache: 'no-store' }); if (response.ok) version = (await response.json()).version; } catch { /* offline */ }
    version ??= (await readSavedCopy({ caches: storage })).version;
    if (!version) { state = 'failed'; return; }
    registration = await nav.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: '/', updateViaCache: 'none' });
    const watch = (worker) => worker?.addEventListener('statechange', async () => {
      if (worker.state === 'installed' && nav.serviceWorker.controller && registration.waiting) { state = 'update'; }
      if (worker.state === 'redundant' && state === 'saving') state = 'failed';
      await verify();
    });
    watch(registration.installing); registration.addEventListener('updatefound', () => watch(registration.installing));
  };

  button.addEventListener('click', () => {
    if (!win.confirm('Using the newer version closes what is on this screen, including your current incident. Your bank fraud line is always at the top. Continue?')) return;
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    nav.serviceWorker.addEventListener('controllerchange', () => win.location.reload(), { once: true });
  });
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
  const recheck = async () => { await verify(); if (state === 'incomplete' && nav.onLine !== false) await repair(); };
  win.addEventListener('online', recheck); win.addEventListener('offline', render);
  win.document.addEventListener('visibilitychange', () => { if (win.document.visibilityState === 'visible') recheck(); });

  render();
  // `ready` never settles if the install fails (there is then no active worker), so do not wait for it forever.
  try { await register(); await Promise.race([nav.serviceWorker.ready.catch(() => {}), new Promise((resolve) => win.setTimeout(resolve, 15_000))]); } catch { state = 'failed'; }
  if (state === 'saving' && (await readSavedCopy({ caches: storage })).state === 'none') state = 'failed';
  await verify();
  if (state === 'ready') { try { persisted = (await nav.storage?.persist?.()) ?? null; } catch { persisted = null; } render(); }
  return { getState: () => state, verify, repair };
}
