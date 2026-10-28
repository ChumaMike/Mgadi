// The "Talk to Mgadi" panel: live transcript, status, privacy indicators, the current reviewed action, tasks, a timeline
// and the call controls. It is one persistent panel outside the screens, so the conversation and the text guidance
// share a single incident state. All text is inserted as text nodes, never parsed as HTML.
import { bindText, getLocale } from '../accessibility/accessibility.js';
import { createAvatar } from '../accessibility/avatar.js';
import { findReviewedSign } from '../accessibility/signs.js';
import { createVoiceController, timelineTextFor } from './controller.js';
import { createRetellAdapter } from './retell-adapter.js';
import { createMockAdapter } from './mock-adapter.js';
import { createAvatarDock } from './avatar-dock.js';

const make = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
const tr = (tag, className, source) => { const n = make(tag, className); bindText(n, source); return n; };
const timeOf = (iso) => { try { return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' }); } catch { return ''; } };

const STATUS = {
  idle: 'Ready', connecting: 'Connecting…', reconnecting: 'Reconnecting…', ended: 'Conversation ended', failed: "Couldn't connect",
};
const ACTIVITY = { listening: 'Listening', speaking: 'Mgadi is speaking', 'you-speaking': 'Hearing you' };

export async function initVoice({ bridge }) {
  let config;
  try { const response = await fetch('/api/voice/config', { cache: 'no-store' }); config = await response.json(); }
  catch { config = { mode: 'off', configFailed: true, languages: {}, captions: false, maxCallMs: 600000, consentVersion: '' }; }
  const params = new URLSearchParams(location.search);
  // Operator test token: typed by the person testing, kept in memory only (never stored, never in the URL), and sent only as a header.
  let operatorToken = '';
  // The adapter follows the CURRENT mode, so voice that was unreachable at page load (for example offline) can start once the
  // configuration is fetched again. One adapter per mode, so a scripted simulation keeps its state across a reconnect.
  const adapters = {};
  const makeAdapter = () => {
    const mode = config.mode === 'mock' || config.mode === 'retell' ? config.mode : 'off';
    adapters[mode] ??= mode === 'mock' ? createMockAdapter({ scenario: params.get('mockvoice') || '' })
      : mode === 'retell' ? createRetellAdapter({ config, getOperatorToken: () => operatorToken })
        : { captionsExpected: false, start: async () => { throw new Error('voice_unavailable'); } };
    return adapters[mode];
  };

  const getContext = () => {
    const journey = bridge.getJourney();
    return { language: getLocale(), route: journey?.label ?? 'unsure', stepId: journey ? journey.steps[journey.position]?.id ?? null : null, confirmed: journey ? journey.steps.filter((s) => s.state === 'confirmed').map((s) => s.id) : [] };
  };
  const live = { announce: null };
  const controller = createVoiceController({
    adapterFactory: makeAdapter, getContext, config,
    isOnline: () => navigator.onLine,
    onEvent: (event) => {
      const text = timelineTextFor(event); if (text) bridge.log(text);
      if (event.type === 'message-final' && live.announce) live.announce.textContent = `${event.message.role === 'user' ? 'You said' : 'Mgadi assistant said'}: ${event.message.text}`;
    },
  });
  const availability = () => config.languages?.[getLocale()] ?? { available: false, label: getLocale(), reason: config.configFailed ? 'Live AI voice could not be reached. It needs an internet connection. The guide on this phone still works.' : 'Voice is not set up on this server.' };

  // ---- structure
  const panel = make('section', 'voice-panel'); panel.hidden = true; panel.setAttribute('aria-label', 'Talk to Mgadi');
  const head = make('div', 'vp-head');
  const title = tr('h2', 'vp-title', 'Talk to Mgadi'); title.tabIndex = -1;
  const sim = make('span', 'vp-sim', 'SIMULATED'); sim.hidden = config.mode !== 'mock';
  const status = make('p', 'vp-status'); status.setAttribute('role', 'status');
  const activity = make('p', 'vp-activity'); activity.setAttribute('aria-hidden', 'true');
  const bankBtn = tr('button', 'button danger vp-bank', 'Bank fraud line'); bankBtn.type = 'button';
  const minBtn = tr('button', 'button secondary vp-small', 'Minimise'); minBtn.type = 'button'; minBtn.setAttribute('aria-expanded', 'true');
  const closeBtn = tr('button', 'button secondary vp-small', 'Close'); closeBtn.type = 'button';
  const statusRow = make('div', 'vp-statusrow'); statusRow.append(status, activity);
  const btnRow = make('div', 'vp-btnrow'); btnRow.append(bankBtn, minBtn, closeBtn);
  const now = make('p', 'vp-now'); now.setAttribute('aria-label', 'Current action');
  head.append(title, sim, statusRow, now, btnRow);
  const body = make('div', 'vp-body');
  const chips = make('ul', 'vp-chips'); chips.setAttribute('aria-label', 'Privacy and connection');
  const notice = make('p', 'notice vp-avail');
  const consentBox = make('div', 'vp-consent');
  const consentCheck = make('input'); consentCheck.type = 'checkbox'; consentCheck.id = 'voice-consent-check';
  const consentLabel = make('label', 'check'); consentLabel.setAttribute('for', 'voice-consent-check');
  const consentText = tr('span', null, config.mode === 'mock' ? 'I understand this is a simulation with no microphone.' : 'I understand and agree that my voice is processed by Retell AI for this conversation.');
  consentLabel.append(consentCheck, consentText);
  const privacyDetails = make('details', 'vp-privacy');
  privacyDetails.append(tr('summary', null, 'How this conversation works'), tr('p', null, "The assistant is AI, not a person. It explains Mgadi’s draft guidance; it cannot call your bank, mark steps done or give legal advice. Mgadi does not save recordings or transcripts. The Retell agent must also be configured not to retain them. Retell processes audio during the call, possibly outside South Africa. Never say passwords, PINs, one-time codes or card numbers."));
  consentBox.append(tr('p', null, config.mode === 'mock' ? 'This is a simulated conversation. No microphone is used and nothing leaves this device.' : 'Your microphone audio goes to Retell AI to generate replies and captions, possibly outside South Africa. This is an AI assistant. Do not share passwords, PINs or one-time codes.'), ...(config.mode === 'mock' ? [] : [privacyDetails]), consentLabel);

  // Operator test access: shown only when the server has an operator token configured. It never makes a language public.
  const operatorBox = make('details', 'vp-operator'); operatorBox.hidden = !config.operatorAvailable;
  const opLabel = make('label', null, 'Operator test token'); opLabel.setAttribute('for', 'voice-operator-token');
  const opInput = make('input'); opInput.type = 'password'; opInput.id = 'voice-operator-token'; opInput.autocomplete = 'off'; opInput.spellcheck = false; opInput.setAttribute('autocapitalize', 'off');
  const opCheck = make('button', 'button secondary vp-small', 'Check test access'); opCheck.type = 'button';
  const opForget = make('button', 'button secondary vp-small', 'Forget token'); opForget.type = 'button'; opForget.hidden = true;
  const opStatus = make('p', 'vp-note'); opStatus.setAttribute('role', 'status');
  operatorBox.append(make('summary', null, 'Operator test access'), make('p', 'vp-note', 'For the person testing this deployment only. It needs the operator token from the server settings. Test calls are short and limited, and they do not make a language available to the public.'), opLabel, opInput, opCheck, opForget, opStatus);
  // A token typed on a page that is not a secure context (plain http on a network address) could be read on the way, and the server
  // ignores it there anyway. So the field is switched off and the token is never sent.
  if (config.operatorAvailable && globalThis.isSecureContext === false) {
    opInput.disabled = true; opCheck.disabled = true;
    opStatus.textContent = 'Operator test access needs a secure connection: https, or localhost on this computer. This page is not secure, so the token field is switched off and no token is sent.';
  }
  const reloadConfig = async (headers = {}) => { const response = await fetch('/api/voice/config', { cache: 'no-store', headers }); return { response, next: response.ok ? await response.json() : null }; };
  const applyConfig = (next) => { for (const key of Object.keys(config)) delete config[key]; Object.assign(config, next); };
  opCheck.addEventListener('click', async () => {
    const value = opInput.value.trim(); opInput.value = '';
    if (!value) { opStatus.textContent = 'Enter the token first.'; return; }
    opStatus.textContent = 'Checking…';
    try {
      const { response, next } = await reloadConfig({ 'x-mgadi-operator-token': value });
      if (response.status === 429) opStatus.textContent = 'Too many attempts. Wait a few minutes and try again.';
      else if (next?.access === 'operator') { operatorToken = value; applyConfig(next); opForget.hidden = false; opStatus.textContent = `Test access is on. Calls are limited to ${Math.round(next.maxCallMs / 60000)} minutes and are not public.`; }
      else opStatus.textContent = 'That token was not accepted.';
    } catch { opStatus.textContent = 'Could not check the token. Is the connection working?'; }
    render(controller.getState());
  });
  opForget.addEventListener('click', async () => {
    operatorToken = ''; opForget.hidden = true; opStatus.textContent = 'Token forgotten.';
    try { const { next } = await reloadConfig(); if (next) applyConfig(next); } catch { /* keep the old view until the next load */ }
    render(controller.getState());
  });
  const action = make('details', 'vp-action'); action.setAttribute('aria-label', 'Current action');
  // A plain container with role=log: an <ol> with role=log would lose its list semantics and orphan its items.
  const chat = make('div', 'vp-chat'); chat.setAttribute('role', 'log'); chat.setAttribute('aria-label', 'Conversation'); chat.tabIndex = 0;
  const empty = tr('p', 'vp-empty', 'Your conversation will appear here as captions, kept on this screen only.');
  chat.append(empty);
  const jump = tr('button', 'button secondary vp-small vp-jump', 'Latest messages'); jump.type = 'button'; jump.hidden = true;
  const progress = make('details', 'vp-progress'); progress.open = true; progress.append(tr('summary', null, 'Steps and timeline'));
  const tasks = make('ul', 'vp-tasks'); const timeline = make('ol', 'vp-timeline'); progress.append(tr('h3', null, 'Steps'), tasks, tr('h3', null, 'Timeline'), timeline);
  const announce = make('p', 'sr-only'); announce.setAttribute('role', 'status'); live.announce = announce;
  body.append(chips, notice, consentBox, operatorBox, chat, jump, action, progress, announce);
  const controls = make('div', 'vp-controls');
  const startBtn = tr('button', 'button vp-start', 'Start voice conversation'); startBtn.type = 'button';
  const muteBtn = tr('button', 'button secondary', 'Mute microphone'); muteBtn.type = 'button';
  const endBtn = tr('button', 'button danger', 'End call'); endBtn.type = 'button';
  const textBtn = tr('button', 'button secondary', 'Use text guidance'); textBtn.type = 'button';
  const avatarBtn = tr('button', 'button secondary', 'Show avatar'); avatarBtn.type = 'button';
  const clearBtn = tr('button', 'button secondary', 'Clear conversation'); clearBtn.type = 'button';
  const sound = tr('button', 'button secondary', 'No sound? Tap to enable'); sound.type = 'button'; sound.hidden = true;
  controls.append(startBtn, muteBtn, endBtn, sound, textBtn, avatarBtn, clearBtn);
  panel.append(head, body, controls);
  document.body.append(panel);

  const dock = createAvatarDock({ createAvatar });
  const stage = make('div', 'vp-stage'); stage.hidden = true;
  stage.append(dock.root, tr('p', 'vp-note', 'Visual companion · not SASL translation'));
  body.insertBefore(stage, chat);
  let opener = null;

  let showBank = () => bridge.showBank();
  // ---- rendering
  const chip = (text, tone) => { const li = make('li', `vp-chip${tone ? ` ${tone}` : ''}`, text); chips.append(li); };
  function renderChips(s) {
    chips.replaceChildren();
    const inCall = ['connecting', 'live', 'reconnecting'].includes(s.phase);
    chip(config.mode === 'mock' ? 'No microphone · simulation' : !inCall ? 'Microphone off' : s.muted ? 'Microphone muted' : 'Microphone on', inCall && !s.muted ? 'on' : '');
    if (config.mode === 'mock') chip('Simulation: nothing is sent anywhere', 'on');
    else chip(inCall ? 'Your voice is being processed by Retell AI' : 'Not connected to Retell AI', inCall ? 'on' : '');
    if (config.access === 'operator') chip('Operator test call: short, limited, not public', 'warn');
    chip('Mgadi saves no audio or transcript');
    chip(s.captions === 'unavailable' ? 'Live captions unavailable' : 'Captions stay on this screen only', s.captions === 'unavailable' ? 'warn' : '');
  }
  function renderMessages(s) {
    const keys = new Set(s.messages.map((m) => m.key));
    for (const item of [...chat.querySelectorAll('[data-key]')]) if (!keys.has(item.dataset.key)) item.remove();
    empty.hidden = s.messages.length > 0;
    const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 48;
    for (const m of s.messages) {
      let li = chat.querySelector(`[data-key="${CSS.escape(m.key)}"]`);
      if (!li) {
        li = make('div', `msg msg-${m.role}`); li.dataset.key = m.key;
        if (m.role !== 'system') { li.append(make('span', 'who', m.role === 'user' ? 'You' : 'Mgadi assistant (AI)')); li.append(make('span', 'said')); li.append(make('time', 'at', timeOf(m.at))); }
        else li.append(make('span', 'said'));
        chat.append(li);
      }
      li.querySelector('.said').textContent = m.text;
    }
    if (nearBottom) { chat.scrollTop = chat.scrollHeight; jump.hidden = true; } else if (s.messages.length) jump.hidden = false;
  }
  function renderAction() {
    action.replaceChildren();
    const journey = bridge.getJourney();
    action.append(tr('summary', null, 'Your next action'));
    if (!journey) { now.textContent = 'Now: choose what happened, or tell the assistant.'; action.append(tr('p', null, 'No steps yet. Choose what happened on the main screen, or tell the assistant. Your bank fraud line is always available above.')); return; }
    const step = journey.steps[journey.position];
    const pending = !journey.finished;
    if (!pending) { now.textContent = 'Now: review your incident pack.'; action.append(tr('p', null, 'You have recorded a response for each step. Review your incident pack on the main screen, including anything you still need help with.')); return; }
    const title = make('p', 'vp-step'); bindText(title, step.title);
    now.textContent = ''; now.append(make('strong', null, 'Now: '), (() => { const t = make('span'); bindText(t, step.title); return t; })());
    action.append(make('p', 'vp-count', `${journey.title} · step ${journey.position + 1} of ${journey.steps.length}`), title);
    const buttons = make('div', 'vp-actions');
    if (step.id === 'bank') { const b = tr('button', 'button danger', 'Choose a bank fraud line'); b.type = 'button'; b.addEventListener('click', () => showBank()); buttons.append(b); }
    const done = make('button', 'button'); done.type = 'button'; bindText(done, step.done); done.addEventListener('click', () => bridge.confirmCurrent());
    buttons.append(done);
    for (const [state, label] of [['needs_help', 'Need help'], ['not_applicable', 'Not applicable']]) {
      const other = tr('button', 'button secondary', label); other.type = 'button'; other.addEventListener('click', () => bridge.reportOther(state)); buttons.append(other);
    }
    action.append(buttons, tr('p', 'vp-note', 'Only you can mark a step done. The assistant cannot.'));
    // Why it matters, and signing guidance. Signing appears only from reviewed SASL clips; the avatar is never presented as signing.
    const more = make('details', 'vp-more'); more.append(tr('summary', null, 'Why this matters and signing'));
    const why = make('p', 'vp-why'); bindText(why, step.why); more.append(why);
    const clip = findReviewedSign(`${journey.label}.${step.id}`);
    if (clip) {
      const video = make('video'); video.controls = true; video.preload = 'none'; video.src = clip.src; video.setAttribute('aria-label', 'Reviewed SASL guidance for this step');
      const track = make('track'); track.kind = 'captions'; track.src = clip.captions; track.srclang = 'en'; track.label = 'Captions'; track.default = true; video.append(track);
      more.append(tr('h4', null, 'Reviewed SASL video'), video, make('p', 'vp-note', `Reviewed by ${clip.reviewer} on ${clip.reviewedOn}.`));
    } else more.append(tr('p', 'vp-note', 'No reviewed SASL video exists for this step yet. The avatar is a visual companion, not a sign language translator.'));
    const sources = bridge.getSources?.(journey.label, step.id) ?? [];
    if (sources.length) {
      const refs = make('details', 'vp-sources'); refs.append(make('summary', null, 'Sources for this step'));
      for (const source of sources) { const p = make('p', 'vp-note'); const a = make('a', null, source.title); a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.append(a, document.createTextNode(' · ' + source.publisher)); refs.append(p); }
      more.append(refs);
    }
    action.append(more);
  }
  function renderProgress() {
    const journey = bridge.getJourney();
    tasks.replaceChildren();
    if (!journey) tasks.append(tr('li', null, 'Steps appear once you choose what happened.'));
    else journey.steps.forEach((step, index) => {
      const li = make('li', `vp-task ${step.state}${index === journey.position && step.state === 'pending' ? ' now' : ''}`);
      li.append(make('span', 'mark', step.state === 'confirmed' ? 'Done' : step.state === 'skipped' ? 'Skipped' : step.state === 'needs_help' ? 'Need help' : step.state === 'not_applicable' ? 'Not applicable' : index === journey.position ? 'Now' : 'Not yet'));
      const text = make('span', 'label'); bindText(text, step.title); li.append(text);
      if (step.at) li.append(make('time', null, timeOf(step.at)));
      tasks.append(li);
    });
    timeline.replaceChildren();
    for (const entry of bridge.getTimeline().slice(-12)) { const li = make('li'); li.append(make('time', null, timeOf(entry.at)), make('span', null, entry.text)); timeline.append(li); }
  }
  function renderControls(s) {
    const inCall = ['connecting', 'live', 'reconnecting'].includes(s.phase);
    const a = availability();
    consentBox.hidden = inCall || s.consented || !a.available;
    operatorBox.hidden = !config.operatorAvailable || inCall;
    const testNote = a.available && a.testOnly && !inCall && s.phase !== 'failed';
    notice.hidden = a.available && !(s.phase === 'failed') && s.captions !== 'unavailable' && !testNote;
    notice.textContent = testNote ? 'Operator test: this language is not yet verified for the public. Use only synthetic information and keep the call short.' : !a.available ? `Voice in ${a.label ?? getLocale()}: ${a.reason} You can use the text guidance, which keeps all your progress.` : s.phase === 'failed' ? s.error.message : s.captions === 'unavailable' ? 'Live captions are not available for this call, so the conversation will not appear as text. You can still talk, and the text guidance is below.' : '';
    startBtn.hidden = inCall; startBtn.disabled = !a.available || (!s.consented && !consentCheck.checked);
    startBtn.textContent = s.phase === 'failed' ? 'Try again' : s.phase === 'ended' ? 'Talk again' : 'Start voice conversation';
    muteBtn.hidden = s.phase !== 'live'; muteBtn.textContent = s.muted ? 'Unmute microphone' : 'Mute microphone'; muteBtn.setAttribute('aria-pressed', String(s.muted));
    endBtn.hidden = !inCall; endBtn.textContent = s.phase === 'connecting' ? 'Cancel' : 'End call';
    sound.hidden = !(s.phase === 'live' && s.captions === 'on' && !s.audioHeard);
    avatarBtn.hidden = !(inCall && dock.isHidden());
    clearBtn.hidden = s.messages.length === 0 || inCall;
  }
  function render(s) {
    panel.dataset.phase = s.phase;
    const label = s.muted && s.phase === 'live' ? "Muted. Mgadi can't hear you" : STATUS[s.phase] ?? (s.phase === 'live' ? 'Connected' : '');
    if (status.textContent !== label) status.textContent = label;
    activity.textContent = s.phase === 'live' && !s.muted ? ACTIVITY[s.activity] ?? '' : '';
    renderChips(s); renderMessages(s); renderControls(s); if (progress.open) renderProgress();
    stage.hidden = !['connecting', 'live', 'reconnecting'].includes(s.phase);
    dock.setActive(!stage.hidden);
    dock.setMood(s.phase === 'live' ? (s.activity === 'speaking' ? 'speaking' : s.muted ? 'muted' : 'listening') : ['connecting', 'reconnecting'].includes(s.phase) ? 'connecting' : 'idle');
  }

  // ---- behaviour
  controller.subscribe(render);
  bridge.subscribe(() => { renderAction(); renderProgress(); });
  const refresh = () => { renderAction(); renderProgress(); render(controller.getState()); };
  progress.addEventListener('toggle', () => { if (progress.open) renderProgress(); });
  consentCheck.addEventListener('change', () => render(controller.getState()));
  startBtn.addEventListener('click', () => { if (consentCheck.checked) controller.giveConsent(); controller.start(); });
  endBtn.addEventListener('click', () => controller.end());
  muteBtn.addEventListener('click', () => (controller.getState().muted ? controller.unmute() : controller.mute()));
  sound.addEventListener('click', () => controller.startAudioPlayback());
  clearBtn.addEventListener('click', () => controller.clearMessages());
  const collapse = () => { panel.dataset.collapsed = 'true'; minBtn.setAttribute('aria-expanded', 'false'); minBtn.textContent = 'Expand'; };
  // Opening the bank numbers minimises the panel so they are fully visible. A running call carries on.
  showBank = () => { if (!panel.hidden) collapse(); bridge.showBank(); };
  bankBtn.addEventListener('click', showBank);
  document.querySelector('#emergency-button')?.addEventListener('click', () => { if (!panel.hidden) collapse(); });
  textBtn.addEventListener('click', () => { controller.end('You switched to text guidance. Your progress is kept.'); close({ keepFocus: true }); bridge.showText(); });
  avatarBtn.addEventListener('click', () => { dock.show(); render(controller.getState()); });
  dock.onHidden = () => render(controller.getState());
  jump.addEventListener('click', () => { chat.scrollTop = chat.scrollHeight; jump.hidden = true; });
  chat.addEventListener('scroll', () => { if (chat.scrollHeight - chat.scrollTop - chat.clientHeight < 48) jump.hidden = true; });
  minBtn.addEventListener('click', () => { const collapsed = panel.dataset.collapsed !== 'true'; panel.dataset.collapsed = String(collapsed); minBtn.setAttribute('aria-expanded', String(!collapsed)); minBtn.textContent = collapsed ? 'Expand' : 'Minimise'; });
  closeBtn.addEventListener('click', () => { controller.end('You closed the voice panel.'); close({}); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !['connecting', 'live', 'reconnecting'].includes(controller.getState().phase)) close({}); });
  document.addEventListener('mgadi:language', (e) => { const lang = e.detail.locale; controller.languageChanged(lang, config.languages?.[lang]); refresh(); });
  // A live AI call cannot survive losing the internet. End it cleanly, keep everything shown, and point to the offline guide.
  window.addEventListener('offline', () => controller.networkChanged(false));
  // Voice settings that could not be fetched (offline at load) are fetched again when the connection returns.
  window.addEventListener('online', async () => { if (!config.configFailed) return; try { const { next } = await reloadConfig(); if (next) { applyConfig(next); operatorBox.hidden = !config.operatorAvailable; refresh(); } } catch { /* still unreachable */ } });
  new ResizeObserver(() => document.documentElement.style.setProperty('--voice-h', panel.hidden ? '0px' : `${Math.ceil(panel.getBoundingClientRect().height)}px`)).observe(panel);
  const header = document.querySelector('.site-header');
  if (header) new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${Math.ceil(header.getBoundingClientRect().height)}px`)).observe(header);

  function open() {
    opener = document.activeElement; panel.hidden = false; panel.dataset.collapsed = 'false'; minBtn.setAttribute('aria-expanded', 'true'); minBtn.textContent = 'Minimise';
    document.documentElement.dataset.voice = 'open'; refresh(); title.focus();
  }
  function close({ keepFocus = false }) {
    panel.hidden = true; document.documentElement.dataset.voice = 'closed'; dock.setActive(false);
    if (!keepFocus && opener?.isConnected) opener.focus();
  }
  refresh();
  return {
    open,
    launchButton() { const b = tr('button', 'button secondary voice-launch', 'Talk to Mgadi'); b.type = 'button'; b.addEventListener('click', open); return b; },
    controller, dock, config,
  };
}
