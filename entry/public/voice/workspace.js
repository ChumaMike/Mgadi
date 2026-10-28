// Compact voice layout built around a single viewport. The existing controller still owns
// transcripts, consent, call state, emergency action outcomes and provider connectivity.
const el = (tag, cls, label) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (label !== undefined) node.textContent = label;
  return node;
};
const allowedHosts = new Set([
  'www.fnb.co.za', 'cib.absa.africa', 'learn.microsoft.com', 'www.ic3.gov',
  'www.cisa.gov', 'www.nomoreransom.org', 'csrc.nist.gov',
]);
const clock = (ms) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
};

export function installVoiceWorkspace({ panel, head, title, statusRow, bankBtn, dock, body,
  chat, action, progress, gestureSection, controller, bridge, findReviewedSign,
  notice, consentBox, operatorBox, privacyLine, jump, sound, clearBtn }) {
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

  const more = el('button', 'vp-more-button', 'Options');
  more.type = 'button'; more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'vp-compact-tools');
  head.append(more);

  const setup = el('div', 'vp-compact-setup');
  setup.append(notice, consentBox);
  const shell = el('div', 'vp-compact-shell');

  const side = el('aside', 'vp-compact-side');
  side.setAttribute('aria-label', 'Visual companion and gestures');
  const stage = el('div', 'vp-compact-stage');
  const state = el('div', 'vp-compact-speaking');
  const spoken = el('span', 'vp-speaking-label', 'Ready to talk');
  const wave = el('span', 'vp-compact-wave');
  wave.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 5; i++) wave.append(el('i', 'vp-compact-wave-bar'));
  state.append(spoken, wave);
  const avatarArea = el('div', 'vp-compact-avatar');
  avatarArea.append(dock.root);
  const gesturePreview = el('div', 'vp-compact-gesture');
  gesturePreview.hidden = true;
  const gestureArea = gestureSection.querySelector('.vp-gesture-area');
  const gestureToggle = gestureSection.querySelector('.vp-gesture-heading button');
  const gestureCanvas = gestureArea?.querySelector('canvas');
  const gestureWord = gestureArea?.querySelector('.vp-gesture-word');
  if (gestureCanvas) gesturePreview.append(gestureCanvas);
  if (gestureWord) gesturePreview.append(gestureWord);
  stage.append(state, avatarArea, gesturePreview);
  const visualButtons = el('div', 'vp-compact-visual-buttons');
  const avatarToggle = el('button', 'vp-compact-toggle', 'Hide 3D');
  avatarToggle.type = 'button'; avatarToggle.setAttribute('aria-pressed', 'true');
  const visualToggle = el('button', 'vp-compact-toggle', 'Show gestures');
  visualToggle.type = 'button'; visualToggle.setAttribute('aria-pressed', 'false');
  visualButtons.append(avatarToggle, visualToggle);
  const stageNote = el('p', 'vp-compact-stage-note', 'Gestures are illustrative, not SASL');
  side.append(stage, visualButtons, stageNote);

  const main = el('section', 'vp-compact-main');
  main.setAttribute('aria-label', 'Call conversation and next action');
  const captionHead = el('div', 'vp-compact-caption-head');
  captionHead.append(el('h3', null, 'Conversation'));
  const captionToggle = el('button', 'vp-captions-button', 'Hide captions');
  captionToggle.type = 'button'; captionToggle.setAttribute('aria-pressed', 'true');
  captionHead.append(captionToggle);
  const captionWrap = el('div', 'vp-compact-caption-wrap');
  captionWrap.append(chat, jump);
  main.append(captionHead, captionWrap, action);
  shell.append(side, main);

  const drawer = el('aside', 'vp-compact-tools');
  drawer.id = 'vp-compact-tools'; drawer.hidden = true;
  drawer.setAttribute('aria-label', 'Call options, privacy and step history');
  const drawerHeader = el('div', 'vp-compact-tools-header');
  const drawerTitle = el('h3', null, 'Call options');
  drawerTitle.tabIndex = -1;
  const closeDrawer = el('button', 'vp-close-tools', 'Close');
  closeDrawer.type = 'button';
  drawerHeader.append(drawerTitle, closeDrawer);
  const settings = el('fieldset', 'vp-compact-settings');
  settings.append(el('legend', null, 'Display'));
  const bigText = el('label', 'vp-compact-check');
  const textCheck = el('input'); textCheck.type = 'checkbox';
  textCheck.checked = ['large', 'larger', 'largest'].includes(document.documentElement.dataset.textSize);
  bigText.append(textCheck, document.createTextNode('Larger text'));
  const lessMotion = el('label', 'vp-compact-check');
  const motionCheck = el('input'); motionCheck.type = 'checkbox';
  motionCheck.checked = document.documentElement.dataset.reducedMotion === 'true';
  lessMotion.append(motionCheck, document.createTextNode('Reduce movement'));
  settings.append(bigText, lessMotion);
  drawer.append(drawerHeader, settings, gestureSection, progress, privacyLine, operatorBox);
  if (clearBtn) drawer.append(clearBtn);
  body.append(setup, shell, drawer);
  // The sound-unlock control is used only if actual audio needs a user gesture; keep it accessible.
  if (sound) setup.append(sound);

  const setDrawer = (show) => {
    drawer.hidden = !show;
    more.setAttribute('aria-expanded', String(show));
    if (show) drawerTitle.focus();
    else more.focus();
  };
  more.addEventListener('click', () => setDrawer(drawer.hidden));
  closeDrawer.addEventListener('click', () => setDrawer(false));
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !drawer.hidden) {
      e.preventDefault(); e.stopPropagation(); setDrawer(false);
    }
  });
  textCheck.addEventListener('change', () => { document.documentElement.dataset.textSize = textCheck.checked ? 'large' : 'normal'; });
  motionCheck.addEventListener('change', () => { document.documentElement.dataset.reducedMotion = String(motionCheck.checked); });

  let gesturesOn = false;
  const setGestureMode = (on) => {
    gesturesOn = Boolean(on);
    if (gesturesOn && gestureArea?.hidden) gestureToggle?.click();
    if (!gesturesOn && gestureArea && !gestureArea.hidden) gestureToggle?.click();
    gesturePreview.hidden = !gesturesOn;
    stage.dataset.gestures = String(gesturesOn);
    visualToggle.textContent = gesturesOn ? 'Hide gestures' : 'Show gestures';
    visualToggle.setAttribute('aria-pressed', String(gesturesOn));
  };
  visualToggle.addEventListener('click', () => setGestureMode(!gesturesOn));
  const syncAvatarButton = () => {
    const visible = !dock.isHidden() && dock.root.hidden === false;
    avatarToggle.textContent = visible ? 'Hide 3D' : 'Show 3D';
    avatarToggle.setAttribute('aria-pressed', String(visible));
  };
  avatarToggle.addEventListener('click', () => {
    if (dock.isHidden()) dock.show();
    else dock.hide();
    syncAvatarButton();
  });
  captionToggle.addEventListener('click', () => {
    captionWrap.hidden = !captionWrap.hidden;
    captionToggle.textContent = captionWrap.hidden ? 'Show captions' : 'Hide captions';
    captionToggle.setAttribute('aria-pressed', String(!captionWrap.hidden));
  });

  function actionUpdated() {
    const j = bridge.getJourney();
    action.open = true;
    if (!j?.steps?.length || j.finished) return;
    const step = j.steps[j.position];
    const titleNode = action.querySelector('.vp-step');
    const actions = action.querySelector('.vp-actions');
    if (!titleNode || !actions) return;
    const count = el('div', 'vp-count-row');
    count.append(el('span', 'vp-count', 'Step ' + (j.position + 1) + ' / ' + j.steps.length));
    const dots = el('span', 'vp-dots');
    dots.setAttribute('role', 'img'); dots.setAttribute('aria-label', 'Step ' + (j.position + 1) + ' of ' + j.steps.length);
    j.steps.forEach((item, i) => {
      const dot = el('span', 'vp-dot');
      if (i <= j.position) dot.classList.add('reached');
      if (item.state === 'confirmed') dot.classList.add('completed');
      dots.append(dot);
    });
    count.append(dots);
    titleNode.before(count);
    const instructions = el('ol', 'vp-instructions');
    (step.do || []).forEach(line => instructions.append(el('li', '', line)));
    actions.before(instructions);
    const doneButton = Array.from(actions.querySelectorAll('button')).find(b => b.textContent.trim() === step.done);
    if (doneButton) {
      doneButton.textContent = 'Done'; doneButton.setAttribute('aria-label', 'Done: ' + step.done);
      doneButton.classList.add('vp-done');
    }
    const foot = el('details', 'vp-compact-references');
    foot.append(el('summary', null, 'Why this step · sources'));
    foot.append(el('p', '', step.why || 'Follow official advice for your situation.'));
    foot.append(el('p', 'vp-draft-note', 'Draft guidance · practitioner review pending'));
    const references = (bridge.getSources?.(j.label, step.id) || []).filter(source => {
      try { const url = new URL(source.url); return url.protocol === 'https:' && allowedHosts.has(url.hostname); }
      catch { return false; }
    });
    for (const reference of references) {
      const entry = el('p', 'vp-source-entry');
      const link = el('a', '', reference.title);
      link.href = reference.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      entry.append(link, document.createTextNode(' · ' + reference.publisher));
      foot.append(entry);
    }
    action.append(foot);
    // Detailed explanations and real reviewed SASL clips remain inside the original section.
    // This compact overview deliberately shows only the current action.
  }

  let interval = null;
  const tick = () => {
    const s = controller.getState();
    timer.textContent = s.startedAt && s.phase !== 'idle' ? clock(Date.now() - s.startedAt) : '00:00';
  };
  function render(s) {
    panel.dataset.activity = s.activity || 'idle';
    panel.dataset.callActive = String(['live', 'connecting', 'reconnecting'].includes(s.phase));
    spoken.textContent = s.phase === 'live'
      ? s.muted ? 'Muted' : s.activity === 'speaking' ? 'Mgadi speaking' : s.activity === 'you-speaking' ? 'You speaking' : 'Listening'
      : s.phase === 'connecting' ? 'Connecting' : s.phase === 'reconnecting' ? 'Reconnecting' : s.phase === 'ended' ? 'Call ended' : 'Ready to talk';
    tick();
    syncAvatarButton();
    const popup = document.querySelector('.bank-popover');
    bankBtn.setAttribute('aria-expanded', String(Boolean(popup?.open)));
  }
  function installPreview(button, box) {
    drawer.append(button, box);
    button.classList.add('vp-extra-preview');
  }
  function open() {
    document.querySelector('main')?.setAttribute('inert', '');
    document.querySelector('#accessibility')?.setAttribute('inert', '');
    if (interval) clearInterval(interval);
    interval = setInterval(tick, 1000);
    if (drawer.hidden === false) setDrawer(false);
  }
  function close() {
    document.querySelector('main')?.removeAttribute('inert');
    document.querySelector('#accessibility')?.removeAttribute('inert');
    if (interval) clearInterval(interval);
    interval = null;
    drawer.hidden = true; more.setAttribute('aria-expanded', 'false');
    if (gesturesOn) setGestureMode(false);
  }
  return { open, close, render, actionUpdated, installPreview };
}
