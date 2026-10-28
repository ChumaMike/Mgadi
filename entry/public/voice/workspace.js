// Full-screen response workspace. Presentation only: Retell, gesture recognition, and
// incident progress stay owned by the existing panel/controller/bridge.
const el = (tag, cls, label) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (label !== undefined) node.textContent = label;
  return node;
};
const allowedHosts = new Set([
  'www.fnb.co.za', 'cib.absa.africa', 'learn.microsoft.com', 'www.ic3.gov',
  'www.cisa.gov', 'www.nomoreransom.org', 'csrc.nist.gov'
]);
const clock = (ms) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
};

export function installVoiceWorkspace({ panel, head, title, statusRow, bankBtn, dock, body,
  chat, action, progress, gestureSection, controller, bridge, findReviewedSign }) {
  const brand = el('div', 'vp-workspace-brand');
  const logo = el('img', 'vp-workspace-logo');
  logo.src = '/brand/mgadi-logo.png';
  logo.alt = '';
  brand.append(logo, title);
  head.insertBefore(brand, statusRow);
  const timer = el('time', 'vp-workspace-timer', '00:00');
  timer.setAttribute('aria-label', 'Call duration');
  head.insertBefore(timer, head.querySelector('.vp-btnrow'));
  bankBtn.setAttribute('aria-expanded', 'false');

  const stage = el('section', 'vp-stage');
  stage.setAttribute('aria-label', 'Mgadi visual companion');
  const scene = el('div', 'vp-scene');
  const waveform = el('div', 'vp-waveform');
  const spoken = el('strong', 'vp-speaking-label', 'Ready to talk');
  const bars = el('span', 'vp-bars');
  bars.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 7; i++) bars.append(el('i', 'vp-bar'));
  waveform.append(spoken, bars);
  const companionNote = el('p', 'vp-companion-note', '3D visual companion · not SASL translation');
  scene.append(waveform, dock.root, companionNote);
  const quick = el('div', 'vp-quick');
  const quickButton = (label, name) => {
    const b = el('button', 'vp-quick-btn', label);
    b.type = 'button';
    b.dataset.quick = name;
    return b;
  };
  const saslButton = quickButton('SASL', 'sasl');
  const captionsButton = quickButton('Hide captions', 'captions');
  captionsButton.setAttribute('aria-pressed', 'true');
  const settingsButton = quickButton('Settings', 'settings');
  settingsButton.setAttribute('aria-expanded', 'false');
  const gestureButton = quickButton('Gestures', 'gestures');
  quick.append(saslButton, captionsButton, settingsButton, gestureButton);
  stage.append(scene, quick);
  const message = el('p', 'vp-assist-notice');
  message.setAttribute('role', 'status'); message.hidden = true;
  const settings = el('div', 'vp-workspace-settings');
  settings.hidden = true;
  const textLabel = el('label', 'vp-setting-line');
  const textCheck = el('input'); textCheck.type = 'checkbox';
  textCheck.checked = ['large', 'larger', 'largest'].includes(document.documentElement.dataset.textSize);
  textLabel.append(textCheck, document.createTextNode('Larger text'));
  const motionLabel = el('label', 'vp-setting-line');
  const motionCheck = el('input'); motionCheck.type = 'checkbox';
  motionCheck.checked = document.documentElement.dataset.reducedMotion === 'true';
  motionLabel.append(motionCheck, document.createTextNode('Reduce movement'));
  settings.append(textLabel, motionLabel);
  const captionsTitle = el('div', 'vp-captions-title');
  captionsTitle.append(el('h3', null, 'Live captions'), el('span', 'vp-caption-state', 'Appear when voice is connected'));
  body.insertBefore(stage, chat);
  body.insertBefore(message, chat);
  body.insertBefore(settings, chat);
  body.insertBefore(captionsTitle, chat);
  body.insertBefore(gestureSection, progress);

  const toast = (copy) => { message.textContent = copy; message.hidden = false; };
  saslButton.addEventListener('click', () => {
    const j = bridge.getJourney(); const step = j?.steps?.[j.position];
    const clip = step ? findReviewedSign(j.label + '.' + step.id) : null;
    if (!clip) {
      toast('Reviewed SASL signing is not yet available for this action. The visual companion and illustrative gestures are not sign-language translation.');
      return;
    }
    action.open = true;
    const details = action.querySelector('.vp-more');
    if (details) details.open = true;
    const vid = details?.querySelector('video');
    if (vid) { toast('Reviewed SASL clip shown in the current action.'); vid.scrollIntoView({ block: 'nearest' }); }
  });
  captionsButton.addEventListener('click', () => {
    chat.hidden = !chat.hidden;
    captionsTitle.hidden = chat.hidden;
    captionsButton.textContent = chat.hidden ? 'Show captions' : 'Hide captions';
    captionsButton.setAttribute('aria-pressed', String(!chat.hidden));
  });
  settingsButton.addEventListener('click', () => {
    settings.hidden = !settings.hidden;
    settingsButton.setAttribute('aria-expanded', String(!settings.hidden));
  });
  textCheck.addEventListener('change', () => {
    document.documentElement.dataset.textSize = textCheck.checked ? 'large' : 'normal';
  });
  motionCheck.addEventListener('change', () => {
    document.documentElement.dataset.reducedMotion = String(motionCheck.checked);
  });
  gestureButton.addEventListener('click', () => {
    const toggle = gestureSection.querySelector('.vp-gesture-heading button');
    const area = gestureSection.querySelector('.vp-gesture-area');
    if (toggle && area?.hidden) toggle.click();
    gestureSection.scrollIntoView({ block: 'nearest' });
  });

  function actionUpdated() {
    const j = bridge.getJourney();
    action.open = true;
    message.hidden = true;
    if (!j?.steps?.length || j.finished) return;
    const step = j.steps[j.position];
    const titleNode = action.querySelector('.vp-step');
    const actions = action.querySelector('.vp-actions');
    if (!titleNode || !actions) return;
    const count = el('div', 'vp-count-row');
    count.append(el('span', 'vp-count', 'Step ' + (j.position + 1) + ' of ' + j.steps.length));
    const dots = el('span', 'vp-dots');
    dots.setAttribute('role', 'img');
    dots.setAttribute('aria-label', 'Step ' + (j.position + 1) + ' of ' + j.steps.length);
    j.steps.forEach((item, i) => {
      const dot = el('span', 'vp-dot');
      if (i <= j.position) dot.classList.add('reached');
      if (item.state === 'confirmed') dot.classList.add('completed');
      dots.append(dot);
    });
    count.append(dots);
    titleNode.before(count, el('p', 'vp-next-label', 'Your next step'));
    const instructions = el('ol', 'vp-instructions');
    (step.do || []).forEach((text) => instructions.append(el('li', '', text)));
    actions.before(instructions);
    const done = actions.querySelector('button');
    const doneActual = Array.from(actions.querySelectorAll('button')).find(b => b.textContent.trim() === step.done);
    if (doneActual) {
      doneActual.textContent = 'Done';
      doneActual.setAttribute('aria-label', 'Done: ' + step.done);
      doneActual.classList.add('vp-done');
    }
    action.append(el('p', 'vp-draft-note', 'Draft guidance · practitioner review pending'));
    const refs = (bridge.getSources?.(j.label, step.id) || []).filter(source => {
      try { const u = new URL(source.url); return u.protocol === 'https:' && allowedHosts.has(u.hostname); }
      catch { return false; }
    });
    if (refs.length) {
      const sources = el('details', 'vp-source-links');
      sources.append(el('summary', '', 'Sources for this step'));
      for (const entry of refs) {
        const item = el('p', 'vp-source-entry');
        const link = el('a', '', entry.title);
        link.href = entry.url; link.rel = 'noopener noreferrer'; link.target = '_blank';
        item.append(link, document.createTextNode(' · ' + entry.publisher));
        sources.append(item);
      }
      action.append(sources);
    }
  }

  let interval = null;
  const tick = () => {
    const s = controller.getState();
    timer.textContent = s.startedAt && s.phase !== 'idle'
      ? clock(Date.now() - s.startedAt) : '00:00';
  };
  function render(s) {
    panel.dataset.activity = s.activity || 'idle';
    panel.dataset.callActive = String(['live','connecting','reconnecting'].includes(s.phase));
    spoken.textContent = s.phase === 'live'
      ? s.muted ? 'Microphone muted' : (s.activity === 'speaking' ? 'Mgadi is speaking' : s.activity === 'you-speaking' ? "You're speaking" : 'Listening')
      : s.phase === 'connecting' ? 'Connecting…' : s.phase === 'reconnecting' ? 'Reconnecting…' : 'Ready to talk';
    tick();
    const popup = document.querySelector('.bank-popover');
    bankBtn.setAttribute('aria-expanded', String(Boolean(popup?.open)));
  }
  function open() {
    document.querySelector('main')?.setAttribute('inert','');
    document.querySelector('#accessibility')?.setAttribute('inert','');
    if (interval) clearInterval(interval);
    interval = setInterval(tick, 1000);
  }
  function close() {
    document.querySelector('main')?.removeAttribute('inert');
    document.querySelector('#accessibility')?.removeAttribute('inert');
    if (interval) clearInterval(interval);
    interval = null;
    message.hidden = true;
  }
  return { open, close, render, actionUpdated };
}