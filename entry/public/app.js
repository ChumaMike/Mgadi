import { bindText, installAccessibility, guidanceControls, stopSpeech } from './accessibility/accessibility.js';
import { redactIncident } from './shared/redact.js';
import { routeTriage } from './shared/labels.js';
import { sha256Hex } from './shared/sha256.js';
import { makePack, verifyPack } from './shared/pack.js';
import { triageWithFallback } from './shared/triage-client.js';
import { initVoice } from './voice/panel.js';
import { initOffline } from './offline/register.js';
import { initTools } from './tools/tools.js';
import { buildPackData, defaultPackOptions, previewItems, summarySections, formatTime, sanitizeHandoff, AFFECTED } from './shared/summary.js';

const app = document.querySelector('#app');
const emergencyButton = document.querySelector('#emergency-button');
let playbook;
let fraudLines;
let resources = null; // external links live apart from the guidance text, and only reviewed hosts may be linked
let incident = { timeline: [], evidence: [], outcomes: {} };
// Placeholder until the voice panel is ready; the launch button is created through it so every screen shares one panel.
let voice = { launchButton: () => document.createDocumentFragment() };

function element(tag, text, attributes = {}) {
  const node = document.createElement(tag);
  if (text) bindText(node, text);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'className') node.className = value;
    else node.setAttribute(name, value);
  }
  return node;
}
function button(text, onClick, className = 'button') { const node = element('button', text, { className, type: 'button' }); node.addEventListener('click', onClick); return node; }
// Focus moves to the new screen's heading so a screen reader says where you are, but NOT on the very first screen: stealing focus
// on load would leave the header (the bank button) behind a keyboard user.
let hasRendered = false;
function clear() { stopSpeech(); app.replaceChildren(); const moveFocus = hasRendered; hasRendered = true; if (moveFocus) requestAnimationFrame(() => { const heading = app.querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus(); } }); }
function log(text) { incident.timeline.push({ at: new Date().toISOString(), text }); }

// While the owner has the bank numbers open, a late triage result must not replace that screen.
let inBank = false;
let afterBank = null;

function reviewBadge(flow) {
  const base = playbook.reviewed ? (playbook.reviewNote || 'Guidance reviewed.') : 'Draft guidance: not yet reviewed by a qualified practitioner. Translations are unreviewed drafts too.';
  // A guide can carry its own, stricter note. The ransomware guide was written from public CISA and No More Ransom material.
  const text = flow?.reviewed === false && flow.title.toLowerCase().includes('ransomware')
    ? `${base} This ransomware guide was written from public CISA and No More Ransom guidance and has not been checked by a practitioner.`
    : base;
  const details = element('details', '', { className: 'review-status print-keep' });
  details.append(element('summary', playbook.reviewed ? 'About this guidance' : 'Draft guidance · review pending'), element('p', text));
  return details;
}
function plain(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }

// Only https links to hosts listed in resources.json are ever rendered. Link text is set as text, never parsed as HTML.
function resourceLinks(route, stepId = null) {
  const items = (resources?.routes?.[route] ?? []).filter((item) => {
    try { const url = new URL(item.url); return (!stepId || !item.steps || item.steps.includes(stepId)) && url.protocol === 'https:' && resources.allowedHosts.includes(url.hostname); } catch { return false; }
  });
  if (!items.length) return null;
  const box = element('details', '', { className: 'resources' });
  box.append(element('summary', 'Sources for this step (open outside Mgadi)'), element('p', resources.note, { className: 'notice' }), plain('p', `Links last checked on ${resources.checkedOn}. They need an internet connection.`, 'privacy'));
  const list = element('ul');
  for (const item of items) {
    const li = document.createElement('li');
    const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = item.title;
    li.append(link, plain('span', ` ${item.publisher}. ${item.purpose}`));
    list.append(li);
  }
  box.append(list);
  return box;
}

let bankDialog = null;
function showBankLines() {
  if (bankDialog?.open) { bankDialog.close(); return; }
  if (!bankDialog) {
    bankDialog = document.createElement('dialog');
    bankDialog.className = 'bank-popover';
    bankDialog.setAttribute('aria-label', 'Bank fraud contact numbers');
    const card = element('section', '', { className: 'bank-popover-content' });
    card.append(element('h2', 'Call your bank now'), element('p', fraudLines.notice, { className: 'notice' }),
      element('p', 'Verify the number against the back of your bank card or the official banking app.', { className: 'privacy' }));
    for (const bank of fraudLines.banks) {
      const row = element('div', '', { className: 'bank' });
      row.append(element('strong', bank.name), element('a', bank.number, { href: 'tel:' + bank.tel }));
      card.append(row);
    }
    card.append(element('p', 'Numbers last checked ' + fraudLines.checkedOn, { className: 'privacy' }),
      button('Close bank numbers', () => bankDialog.close(), 'button secondary'));
    bankDialog.append(card);
    document.body.append(bankDialog);
    bankDialog.addEventListener('close', () => {
      inBank = false;
      emergencyButton.setAttribute('aria-expanded', 'false');
      if (afterBank) { const next = afterBank; afterBank = null; next(); }
    });
  }
  inBank = true;
  emergencyButton.setAttribute('aria-expanded', 'true');
  bankDialog.show();
  bankDialog.querySelector('.bank-popover-content h2')?.focus();
}

let preferredMode = 'text';
function showHome() {
  preferredMode = 'text';
  clear();

  const page = element('section', '', { className: 'landing-page welcome-card simple-home' });
  const hero = element('section', '', { className: 'landing-hero', 'aria-label': 'Welcome to Mgadi' });
  const intro = element('div', '', { className: 'landing-hero-copy' });
  intro.append(
    element('p', 'MGADI  /  FIRST-HOUR CYBER HELP', { className: 'landing-eyebrow' }),
    element('h1', 'Something feels wrong?'),
    element('p', 'Tell us what happened. We’ll help you take the next safe step.', { className: 'landing-intro' })
  );
  const heroMark = element('div', '', { className: 'landing-hero-emblem', 'aria-hidden': 'true' });
  const emblem = element('div', '', { className: 'landing-emblem-image' });
  const heroLogo = document.createElement('img');
  heroLogo.src = '/brand/mgadi-logo.png';
  heroLogo.alt = '';
  heroLogo.width = 1254;
  heroLogo.height = 1254;
  heroLogo.decoding = 'async';
  emblem.append(heroLogo);
  heroMark.append(emblem);
  const ready = element('div', '', { className: 'landing-readiness', role: 'status', 'aria-live': 'polite' });
  const dot = element('span', '', { className: 'landing-ready-dot', 'aria-hidden': 'true' });
  const readyCopy = element('div', '', { className: 'landing-ready-copy' });
  readyCopy.append(element('strong', 'Checking the guide…'), element('small', 'Browser readiness, not a malware scan'));
  ready.append(dot, readyCopy);
  const showReadiness = () => {
    if (!ready.isConnected) return;
    const isOnline = navigator.onLine;
    ready.dataset.state = isOnline ? 'ready' : 'offline';
    const headline = isOnline ? 'Mgadi guide ready' : 'Offline mode';
    const detail = navigator.serviceWorker?.controller
      ? 'Offline guide saved · Browser check only'
      : isOnline ? 'Connected · Not a device security scan' : 'Guide may be unavailable offline';
    readyCopy.replaceChildren(element('strong', headline), element('small', detail));
  };
  window.addEventListener('online', showReadiness, { once: true });
  window.addEventListener('offline', showReadiness, { once: true });
  hero.append(intro, heroMark, ready);
  page.append(hero);

  const issue = element('section', '', { className: 'landing-issues', 'aria-labelledby': 'landing-issues-title' });
  const issueHead = element('div', '', { className: 'landing-issues-heading' });
  issueHead.append(
    element('div', '', { className: 'landing-section-intro' }),
    element('span', '01 / CHOOSE YOUR SITUATION', { className: 'landing-section-id' })
  );
  issueHead.firstChild.append(
    element('h2', 'What happened?', { id: 'landing-issues-title' }),
    element('p', 'Choose the closest match.', { className: 'landing-section-hint' })
  );
  issue.append(issueHead);

  const iconPaths = [
    ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '3' }, 'path', { d: 'M3 10h18M7 15h3' }],
    ['rect', { x: '5', y: '10', width: '14', height: '11', rx: '2' }, 'path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' }],
    ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }, 'path', { d: 'm4 7 8 6 8-6' }],
    ['path', { d: 'M21 11a8 8 0 0 1-8 8H6l-4 3V11a9.5 9.5 0 0 1 19 0Z' }, 'path', { d: 'M7 11h10M7 15h6' }],
    ['circle', { cx: '12', cy: '12', r: '9' }, 'path', { d: 'M9.5 9a2.7 2.7 0 0 1 5 .9c0 1.7-2.5 2-2.5 3.8M12 17.2h.01' }],
  ];
  const iconFor = (index) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('landing-icon-svg');
    const parts = iconPaths[index] || iconPaths[4];
    for (let i = 0; i < parts.length; i += 2) {
      const child = document.createElementNS('http://www.w3.org/2000/svg', parts[i]);
      for (const [key, val] of Object.entries(parts[i + 1])) child.setAttribute(key, val);
      svg.append(child);
    }
    return svg;
  };

  const choices = element('div', '', { className: 'landing-choices welcome-choices incident-choices' });
  // Two entry modes are always available, whether or not the owner has picked a situation.
  // A selected situation is used for the guide, but free-text and voice can start without one.
  const modeBox = element('section', '', {
    className: 'landing-mode landing-entry-modes incident-mode-choice',
    'aria-label': 'Choose text or voice guidance'
  });
  const modeHeading = element('div', '', { className: 'landing-mode-heading' });
  modeHeading.append(element('span', '02 / CHOOSE HOW TO CONTINUE', { className: 'landing-selected-eyebrow' }),
    element('h3', 'How would you like to tell Mgadi?'));
  const modeSummary = element('p', 'You can start without choosing an incident above.', { className: 'landing-mode-summary', role: 'status' });
  const modeButtons = element('div', '', { className: 'landing-mode-buttons' });
  let selected = null;
  const beginText = () => {
    preferredMode = 'text';
    describe.open = true;
    description.focus();
    describe.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  };
  const beginCall = () => {
    preferredMode = 'voice';
    if (selected?.route) {
      chooseEntry(selected); // Exact selected route gives immediate step-by-step guidance.
      return;
    }
    // A payment or uncertain incident still needs a clarifying answer.
    // Do not guess the answer or display old progress in a new voice session.
    journey = null;
    emitJourney();
    incident = { timeline: [], evidence: [], outcomes: {}, source: 'voice-first' };
    if (typeof voice.open === 'function') voice.open();
    else {
      modeSummary.textContent = 'Voice guidance could not load. Please choose text guidance.';
      beginText();
    }
  };
  const voiceChoice = button('Call Mgadi', beginCall, 'button landing-voice-button');
  const textChoice = button('Tell Mgadi by text', beginText, 'button secondary landing-text-button');
  modeButtons.append(textChoice, voiceChoice);
  const modeNote = element('p',
    'Calling opens the 3D companion and captions. Reviewed SASL video guidance is not yet available.',
    { className: 'landing-mode-note' });
  modeBox.append(modeHeading, modeSummary, modeButtons, modeNote);

  for (const [index, option] of playbook.entry.options.entries()) {
    const choice = button('', () => {
      selected = option;
      choices.querySelectorAll('.landing-choice').forEach((item) =>
        item.setAttribute('aria-pressed', String(item === choice)));
      modeSummary.textContent = 'Selected: ' + option.text;
      straightToGuide.hidden = false;
      // Keep both text and voice equally available after the person picks a situation.
      modeBox.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }, 'landing-choice');
    choice.setAttribute('aria-pressed', 'false');
    const iconBox = element('span', '', { className: 'landing-choice-icon' });
    iconBox.append(iconFor(index));
    choice.append(
      iconBox,
      element('span', option.text, { className: 'landing-choice-text' }),
      element('span', '→', { className: 'landing-choice-arrow', 'aria-hidden': 'true' })
    );
    choices.append(choice);
  }
  issue.append(choices, modeBox);

  const describe = element('details', '', { className: 'landing-describe describe-incident' });
  describe.append(element('summary', 'Not sure what to choose? Describe it instead'));
  const description = element('textarea', '', {
    id: 'incident-description',
    placeholder: 'For example: A supplier emailed new banking details, then I made a payment.',
    maxlength: '2000'
  });
  description.lang = 'en';
  const names = element('input', '', { id: 'names-to-hide', placeholder: 'Optional names to hide, separated by commas' });
  describe.append(
    element('p', 'Please describe it in English for now. Never enter passwords, PINs or OTPs.', { className: 'privacy' }),
    element('label', 'What happened?', { for: 'incident-description' }), description,
    element('label', 'Names to hide from your description', { for: 'names-to-hide' }), names
  );
  const submit = button('Find my next safe step', async () => {
    if (!description.value.trim()) {
      description.setCustomValidity('Describe what happened, or choose a situation.');
      description.reportValidity();
      return;
    }
    const redacted = redactIncident(description.value, names.value.split(',').map((n) => n.trim()).filter(Boolean));
    incident = {
      description: description.value, redacted,
      timeline: [{ at: new Date().toISOString(), text: 'Incident started' }],
      evidence: [], outcomes: {}
    };
    await triage(redacted.text);
  }, 'button landing-describe-submit');
  description.addEventListener('input', () => description.setCustomValidity(''));
  describe.append(submit);
  const straightToGuide = button('Use my selected situation instead', () => {
    if (!selected) return;
    preferredMode = 'text';
    chooseEntry(selected);
  }, 'button secondary landing-straight-to-guide');
  straightToGuide.hidden = true;
  describe.append(straightToGuide);
  issue.append(describe);
  page.append(issue);

  const more = element('details', '', { className: 'landing-extra' });
  more.append(element('summary', 'Other tools and checks'));
  const grid = element('div', '', { className: 'landing-tools-grid' });
  for (const [toolAction, detail] of [
    [tools.homeButton(), 'Verify changed supplier details'],
    [button('Check a PDF or message', () => tools.showEvidenceScreen(showHome), 'button secondary'), 'Review evidence on your device'],
    [button('Build an incident pack', startRecord, 'button secondary'), 'Keep a record for a responder'],
  ]) {
    const item = element('div', '', { className: 'landing-tool' });
    item.append(toolAction, element('p', detail, { className: 'privacy' }));
    grid.append(item);
  }
  const capability = element('p',
    'Mgadi can check browser availability and guide response steps. It cannot scan your entire device, contact your bank or certify that a device is secure.',
    { className: 'landing-capability' }
  );
  more.append(grid, capability);
  page.append(more);
  app.append(page);
  showReadiness();
  document.dispatchEvent(new Event('mgadi:idle'));
}

function startRecord() {
  incident = { title: 'Incident record', source: 'manual-record', description: '', timeline: [], evidence: [], outcomes: {} };
  journey = null; emitJourney(); log('Owner started an incident record without selecting a situation');
  showEvidencePack(playbook.incidents.unsure);
}

async function triage(redactedText) {
  clear(); const card = element('section', '', { className: 'card' });
  const controller = new AbortController();
  card.append(element('h1', 'Checking safely…'), element('p', 'Your bank fraud line is available at the top of every screen.'),
    button('Use the guide on this phone now', () => controller.abort(), 'button secondary'));
  app.append(card);
  const slow = setTimeout(() => card.append(element('p', 'This is taking longer than usual. Mgadi will switch to the guide on this phone in a moment.', { role: 'status' })), 2000);
  const result = await triageWithFallback(redactedText, { signal: controller.signal });
  clearTimeout(slow);
  const { source, fallbackReason, ...schema } = result;
  incident.triage = schema; incident.source = source;
  if (fallbackReason) log('Used the guide on this phone because the server did not answer in time');
  const route = routeTriage(schema);
  const proceed = () => (route === 'clarify' ? showClarify() : showIncident(route));
  if (inBank) afterBank = proceed; else proceed();
}

// An entry choice either goes straight to a reviewed guide, asks a second plain question, or opens the one-question screen.
function startFromChoice(route) {
  incident = { timeline: [], evidence: [], outcomes: {}, description: '', triage: { label: route === 'clarify' ? 'unsure' : route, confidence: 0 }, source: 'user-selected route' };
  log('Owner chose a situation from the buttons');
}
function chooseEntry(option) {
  if (option.route) {
    startFromChoice(option.route); showIncident(option.route);
    if (preferredMode === 'voice') voice.open?.();
  } else if (option.next === 'payment') showPaymentChoice();
  else {
    startFromChoice('clarify'); showClarify();
  }
}
function showPaymentChoice() {
  const flow = playbook.entry.payment;
  clear(); const card = element('section', '', { className: 'card' });
  card.append(element('h1', flow.title), element('p', 'Your bank fraud line stays at the top of every screen.', { className: 'notice' }));
  const choices = element('div', '', { className: 'incident-choices' });
  for (const option of flow.options) choices.append(button(option.text, () => chooseEntry(option), 'button secondary'));
  card.append(choices, button('Back', showHome, 'button secondary'));
  app.append(card);
}

// Low confidence or "I am not sure": ask one plain question. The owner's answer picks a reviewed route.
// No label is invented here, and nothing waits on this screen: the bank button stays in the header.
function showClarify() {
  const flow = playbook.clarify;
  clear(); const card = element('section', '', { className: 'card' });
  const intro = element('p', flow.intro); const question = element('h2', flow.question);
  card.append(element('h1', flow.title), reviewBadge(), intro, question);
  const choices = element('div', '', { className: 'incident-choices' });
  for (const option of flow.options) {
    choices.append(button(option.text, () => {
      incident.ownerAnswer = option.text; log(`Owner answered: ${option.text}`);
      showIncident(option.route);
      if (preferredMode === 'voice') voice.open?.();
    }, 'button secondary'));
  }
  card.append(choices, guidanceControls([intro, question], 'clarify'), voice.launchButton(), button('Start again', showHome, 'button secondary'));
  app.append(card);
}

// The journey is shared state: the text screens and the voice panel both read and change it, so switching between them
// never loses progress. A step is "confirmed" only when the person taps it. Nothing the assistant says can do that.
let journey = null; // { label, flow, position, status: { [stepId]: { state: 'confirmed' | 'skipped', at } } }
const journeyListeners = new Set();
const emitJourney = () => journeyListeners.forEach((fn) => fn());

function showIncident(label) {
  const flow = playbook.incidents[label] ?? playbook.incidents.unsure;
  incident.title = flow.title;
  journey = { label, flow, position: 0, status: {} };
  emitJourney(); renderStep();
}

function advance() {
  if (journey.position < journey.flow.steps.length - 1) { journey.position += 1; emitJourney(); renderStep(); }
  else { journey.finished = true; emitJourney(); showEvidencePack(journey.flow); }
}
function confirmCurrentStep() {
  const step = journey?.flow.steps[journey.position]; if (!step) return;
  log(`Owner reported: ${step.done}`);
  if (step.id === 'bank') incident.bankReportedAt = new Date().toISOString();
  journey.status[step.id] = { state: 'confirmed', at: new Date().toISOString() };
  advance();
}
function skipCurrentStep() {
  const step = journey?.flow.steps[journey.position]; if (!step?.skip) return;
  log(`Owner continued without reporting this step: ${step.title}`);
  journey.status[step.id] = { state: 'skipped', at: new Date().toISOString() };
  advance();
}

function reportOther(state) {
  const step = journey?.flow.steps[journey.position]; if (!step) return;
  if (step.id === 'bank') delete incident.bankReportedAt;
  journey.status[step.id] = { state, at: new Date().toISOString() };
  log(`Owner marked ${state === 'needs_help' ? 'Need help' : 'Not applicable'}: ${step.title}`);
  advance();
}

// Evidence selection is explicit. Mgadi records metadata and a SHA-256 fingerprint
// only for files that the owner chooses in the browser's native file picker.
async function recordSelectedEvidence(selectedFiles, feedback, onAdded = () => {}) {
  const currentIncident = incident;
  let recorded = 0;
  for (const file of Array.from(selectedFiles ?? [])) {
    if (incident !== currentIncident) break;
    try {
      const sha256 = await sha256Hex(await file.arrayBuffer());
      if (incident !== currentIncident) break;
      if (currentIncident.evidence.some((item) => item.sha256 === sha256 && item.name === file.name)) continue;
      const item = {
        name: file.name, size: file.size, type: file.type || 'unknown',
        sha256, addedAt: new Date().toISOString()
      };
      currentIncident.evidence.push(item);
      currentIncident.timeline.push({ at: new Date().toISOString(), text: 'Fingerprinted evidence: ' + file.name });
      onAdded(item);
      recorded++;
    } catch (error) {
      feedback.textContent = error?.message || 'This file could not be recorded. Try selecting it again.';
    }
  }
  if (recorded && incident === currentIncident)
    feedback.textContent = recorded + ' file' + (recorded === 1 ? '' : 's') + ' recorded in your incident pack. The original files stay on your device.';
}

function attachEvidencePicker(input, feedback, onAdded) {
  input.addEventListener('change', async () => {
    feedback.textContent = '';
    await recordSelectedEvidence(input.files, feedback, onAdded);
    input.value = '';
  });
}

function makeEvidencePermissionPrompt(picker) {
  if (incident.evidencePromptSeen) return null;
  incident.evidencePromptSeen = true;
  const prompt = document.createElement('section');
  prompt.className = 'evidence-permission-prompt';
  prompt.setAttribute('role', 'dialog');
  prompt.setAttribute('aria-modal', 'false');
  prompt.setAttribute('aria-labelledby', 'evidence-permission-title');
  const content = element('div', '', { className: 'evidence-permission-content' });
  const close = button('×', () => prompt.remove(), 'evidence-permission-close');
  close.setAttribute('aria-label', 'Dismiss evidence prompt');
  content.append(close, element('p', 'OPTIONAL · EVIDENCE', { className: 'evidence-permission-eyebrow' }),
    element('h2', "Let's collect evidence", { id: 'evidence-permission-title' }),
    element('p', 'You can give Mgadi access to the files you choose, so it can record their fingerprints for your incident pack. Nothing is accessed automatically.'));
  const actions = element('div', '', { className: 'evidence-permission-actions' });
  actions.append(
    button('Deny', () => prompt.remove(), 'button secondary'),
    button('Accept & choose files', () => {
      prompt.remove();
      picker.click(); // User gesture: opens the native file picker; no broad device permission.
    }, 'button')
  );
  const details = document.createElement('a');
  details.className = 'evidence-permission-explain';
  details.href = '/evidence-access.html';
  details.target = '_blank';
  details.rel = 'noopener noreferrer';
  details.textContent = 'What access will Mgadi have?';
  content.append(actions, details);
  prompt.append(content);
  return prompt;
}

function renderStep() {
  const { label, flow, position } = journey;
  clear(); const step = flow.steps[position];
  const card = element('section', '', { className: 'card journey-card' });
  const progress = element('ol', '', { className: 'journey-progress', 'aria-label': 'Your steps' });
  flow.steps.forEach((item, index) => {
    const status = journey.status[item.id]?.state;
    const row = element('li', '', { className: index === position ? 'current' : status ? 'reported' : '' });
    if (index === position) row.setAttribute('aria-current', 'step');
    const revisit = button('', () => { journey.position = index; journey.finished = false; emitJourney(); renderStep(); }, 'step-link');
    const words = element('span', '', { className: 'step-words' });
    words.append(element('span', item.title), element('small', status === 'confirmed' ? 'Done' : status === 'needs_help' ? 'Need help' : status === 'not_applicable' ? 'Not applicable' : 'Not yet', { className: 'step-state' }));
    // The state is a symbol as well as words, so it never depends on colour: tick = done, ! = need help, dash = not applicable.
    const mark = status === 'confirmed' ? '✓' : status === 'needs_help' ? '!' : status === 'not_applicable' ? '–' : String(index + 1);
    revisit.append(element('span', mark, { className: 'step-number', 'aria-hidden': 'true' }), words);
    row.append(revisit); progress.append(row);
  });
  card.append(progress, element('p', `${flow.title} · Step ${position + 1} of ${flow.steps.length}`, { className: 'step-count' }), element('h1', step.title));
  if (flow.orgNote) card.append(element('p', flow.orgNote, { className: 'notice org-note' }));
  const list = element('ol', '', { className: 'action-list' });
  step.do.forEach((item) => list.append(element('li', item))); card.append(list);
  if (step.id === 'bank') card.append(button('Choose a bank fraud line', showBankLines, 'button danger primary-action'));
  const why = element('details', '', { className: 'step-context' });
  why.append(element('summary', 'Why this matters'), element('p', step.why), element('p', flow.summary));

  card.append(why);
  const formats = element('div', '', { className: 'step-formats' });
  formats.append(guidanceControls([card.querySelector('h1'), ...list.children, ...why.querySelectorAll('p')], `${label}.${step.id}`), voice.launchButton());
  card.append(formats);
  const outcomes = element('div', '', { className: 'step-outcomes', role: 'group', 'aria-label': 'Report this step' });
  const done = button('', confirmCurrentStep);
  const detail = element('span', '', { className: 'sr-only' }); detail.append(document.createTextNode(' — '), element('span', step.done));
  done.append(element('span', 'Done'), detail); done.dataset.report = step.done;
  outcomes.append(done, button('Need help', () => reportOther('needs_help'), 'button secondary'), button('Not applicable', () => reportOther('not_applicable'), 'button secondary'));
  card.append(element('h2', 'How did this step go?'), outcomes, element('p', 'Your choice is saved in your incident pack. You can revisit any step above.', { className: 'privacy' }), element('p', 'Need help only marks this step in your pack. Mgadi does not contact anyone for you.', { className: 'privacy need-help-note' }));
  const links = resourceLinks(label, step.id); if (links) card.append(links);
  if (step.id === 'evidence') {
    const input = element('input', '', { type: 'file', id: 'step-evidence-picker', multiple: 'multiple', accept: 'image/*,.pdf,.eml,.msg,.txt', className: 'evidence-step-picker' });
    const feedback = element('p', '', { className: 'evidence-feedback', role: 'status' });
    const recordedList = element('ul', '', { className: 'evidence-step-recorded' });
    incident.evidence.forEach((item) => recordedList.append(plain('li', item.name + ' · fingerprint recorded')));
    attachEvidencePicker(input, feedback, (item) => recordedList.append(plain('li', item.name + ' · fingerprint recorded')));
    const selectAgain = button('Choose evidence files', () => input.click(), 'button secondary');
    card.append(input, feedback, recordedList, selectAgain);
    const suggestion = makeEvidencePermissionPrompt(input);
    if (suggestion) card.append(suggestion);
  }
  card.append(reviewBadge(flow));
  const navigation = element('nav', '', { className: 'journey-navigation', 'aria-label': 'Step navigation' });
  if (position > 0) navigation.append(button('← Previous step', () => { journey.position -= 1; journey.finished = false; emitJourney(); renderStep(); }, 'button secondary'));
  navigation.append(button('Start a new incident', showHome, 'button secondary'));
  card.append(navigation); app.append(card);
}

function showEvidencePack(flow) {
  clear(); const card = element('section', '', { className: 'card pack-workspace' });
  const files = element('input', '', { id: 'evidence-files', type: 'file', multiple: 'multiple', accept: 'image/*,.pdf,.eml,.msg,.txt' });
  const list = element('ul');
  const addRow = (item) => list.append(plain('li', `${item.name} · Fingerprint saved on this device`));
  incident.evidence.forEach(addRow);
  const feedback = element('p', '', { className: 'privacy', role: 'status' });
  attachEvidencePicker(files, feedback, addRow);
  const business = element('input', '', { id:'business-name', placeholder: 'Business name (optional)' });
  const amount = element('input', '', { id:'amount-paid', placeholder: 'Amount paid, e.g. R 70 000,00 (optional)' });
  business.value = incident.business ?? ''; amount.value = incident.amount ?? '';
  business.addEventListener('input', () => { incident.business = business.value; });
  amount.addEventListener('input', () => { incident.amount = amount.value; });
  const details = element('details', '', { className: 'pack-optional-details' });
  details.append(element('summary', 'Add business and payment details (optional)'), element('label', 'Business name', { for: 'business-name' }), business, element('label', 'Amount paid', { for: 'amount-paid' }), amount);
  const actions = element('div', '', { className: 'pack-next-actions' });
  actions.append(button('Review my incident pack', () => showPackReview(flow)), button('Start a new incident', showHome, 'button secondary'));
  card.append(element('p', 'YOUR INCIDENT · SAVE EVIDENCE', { className: 'pack-stage' }), element('h1', 'Save evidence for your report'), element('p', 'Choose any files you want to record. Mgadi keeps the original files on your device.'), element('label', 'Choose evidence files (optional)', {for:'evidence-files'}), files, feedback, list, details, handoffForm(), actions);
  const suggestion = makeEvidencePermissionPrompt(files);
  if (suggestion) card.append(suggestion);
  app.append(card);
}

// Optional details for whoever helps next: a bank, an IT specialist or the police. Everything stays on this device until the owner
// chooses to share the pack. It is collapsed so it never lengthens the emergency path, and every field may be left empty.
function handoffForm() {
  const box = element('details', '', { className: 'handoff-form' });
  box.append(element('summary', 'Add details for your bank or a specialist (optional)'));
  box.append(element('p', 'Do not type passwords, PINs, one-time codes or full card or account numbers here. Anything you type is hidden the same way as your description, but only patterns are caught.', { className: 'notice' }));
  const saved = incident.handoff ?? (incident.handoff = {});
  const field = (id, label, node, key, help) => {
    const row = element('div', '', { className: 'field' });
    node.id = id; if (help) node.setAttribute('aria-describedby', `${id}-help`);
    const handler = () => { saved[key] = node.value; };
    node.addEventListener('input', handler); node.addEventListener('change', handler);
    row.append(element('label', label, { for: id }), node);
    if (help) row.append(element('p', help, { id: `${id}-help`, className: 'privacy' }));
    box.append(row);
  };
  const text = (max, extra = {}) => { const node = element('input', '', { type: 'text', maxlength: String(max), autocomplete: 'off', ...extra }); return node; };
  const choice = (entries, firstLabel) => {
    const node = element('select'); if (firstLabel) node.append(plain('option', firstLabel));
    for (const [value, label] of entries) { const option = plain('option', label); option.value = value; node.append(option); }
    return node;
  };
  const affected = choice(Object.entries(AFFECTED), 'Choose one'); affected.options[0].value = '';
  // First-person wording for the form. The pack itself carries the third-person wording in OUTCOMES.
  const outcome = choice([['unknown', 'Unknown: I have not heard back'], ['pending', 'Pending: I am waiting to hear back'], ['confirmed', 'I have been told the outcome']]);
  field('handoff-discovered', 'When did you first notice? (as you remember it)', text(60), 'discoveredAt');
  field('handoff-affected', 'What was affected?', affected, 'affected');
  field('handoff-affected-note', 'Short note about what was affected', text(120), 'affectedNote');
  field('handoff-reference', 'Reference number from a bank or specialist', text(40), 'reference', 'Only type a number you were actually given. Mgadi cannot check it, and it is not hidden in the pack.');
  field('handoff-outcome', 'How do things stand with the bank or specialist?', outcome, 'outcome', 'Unknown is not the same as a good result.');
  field('handoff-followup', 'Next follow-up you plan', text(120), 'followUp');
  for (const [id, key] of [['handoff-discovered', 'discoveredAt'], ['handoff-affected', 'affected'], ['handoff-affected-note', 'affectedNote'], ['handoff-reference', 'reference'], ['handoff-outcome', 'outcome'], ['handoff-followup', 'followUp']]) {
    const node = box.querySelector(`#${id}`); if (saved[key] != null) node.value = saved[key];
  }
  if (sanitizeHandoff(saved)) box.open = true;
  return box;
}

// What each step looked like when the pack was made: only the owner's taps, never anything an assistant said.
function journeySteps() {
  if (!journey) return [];
  return journey.flow.steps.map((step) => ({ id: step.id, title: step.title, state: journey.status[step.id]?.state ?? 'pending', at: journey.status[step.id]?.at ?? null }));
}
function packState() { return { ...incident, steps: journeySteps(), guideReviewed: playbook.reviewed }; }

// Privacy-first preview: the owner sees exactly what will be in the pack before it is made.
function showPackReview(flow) {
  clear(); const card = element('section', '', { className: 'card pack-workspace pack-review' });
  const state = packState();
  const options = incident.packOptions ?? defaultPackOptions(state);
  const preview = element('div', '', { className: 'preview-box', 'aria-live': 'polite' });
  const render = () => {
    incident.packOptions = options; preview.replaceChildren();
    for (const item of previewItems(packState(), options)) {
      const block = element('div'); block.append(element('strong', item.label)); block.append(plain('blockquote', item.value)); preview.append(block);
    }
  };
  const check = (id, text, key, available) => {
    if (!available) return;
    const label = element('label', '', { className: 'check', for: id }); const input = element('input', '', { id, type: 'checkbox' });
    input.checked = options[key]; input.addEventListener('change', () => { options[key] = input.checked; render(); });
    label.append(input, element('span', text)); card.append(label);
  };
  card.append(element('p', 'YOUR INCIDENT · PRIVACY REVIEW', { className: 'pack-stage' }), element('h1', 'Review before you download'), element('p', 'Nothing has been shared. Check exactly what your report will contain. Extra personal details are your choice.'));
  check('include-original', 'Also include my own words exactly as I typed them. They may contain names or numbers.', 'includeOriginal', Boolean(String(state.description ?? '').trim()));
  check('include-business', 'Include the business name', 'includeBusiness', Boolean(String(state.business ?? '').trim()));
  check('include-amount', 'Include the amount paid', 'includeAmount', Boolean(String(state.amount ?? '').trim()));
  check('include-handoff', 'Include handoff details: the steps you reported, what is still open and anything you typed for a bank or specialist', 'includeHandoff', true);
  card.append(element('h2', 'What will be in the pack'), preview, element('p', 'Hiding is pattern based: names are only hidden if you listed them, so read the text above before sharing.', { className: 'privacy' }));
  render();
  const feedback = element('p', '', { role: 'alert', className: 'pack-feedback' });
  const makeButton = button('Make incident pack', async () => {
    makeButton.disabled = true; makeButton.textContent = 'Preparing your pack…'; feedback.textContent = 'Creating your incident pack on this device…';
    try {
      const event = { at: new Date().toISOString(), text: 'Generated incident pack' };
      const state = packState(); state.timeline = [...state.timeline, event];
      const pack = await makePack(buildPackData(state, options));
      incident.timeline.push(event); showPack(pack);
    } catch (error) {
      feedback.textContent = error.message || 'The pack could not be created. Your entries are still here. Please try again.';
    } finally { makeButton.disabled = false; makeButton.textContent = 'Create my incident pack'; }
  });
  card.append(feedback, makeButton, button('Back to evidence', () => showEvidencePack(flow), 'button secondary'));
  app.append(card);
}

function showPack(pack) {
  clear(); const card = element('section', '', { className: 'card' });
  const summary = element('section', '', { className: 'pack-summary' });
  summary.append(element('h2', 'What your pack contains'), plain('p', `Prepared ${formatTime(pack.generatedAt)}`, 'privacy'), reviewBadge());
  for (const section of summarySections(pack)) {
    summary.append(element('h2', section.heading));
    if (section.heading === 'Timeline' || section.heading === 'Evidence fingerprints') { const ul = document.createElement('ul'); section.lines.forEach((line) => ul.append(plain('li', line))); summary.append(ul); }
    else section.lines.forEach((line) => summary.append(plain('p', line)));
  }
  summary.append(element('h2', 'Pack fingerprint'), plain('p', pack.fingerprint, 'hash'));
  const details = element('pre', JSON.stringify(pack, null, 2));
  details.className = 'pack-json';
  const download = button('Download incident pack', () => { const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }); const link = element('a', '', { href: URL.createObjectURL(blob), download: 'mgadi-incident-pack.json' }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); });
  const checkFile = element('input', '', { type: 'file', accept: '.json,application/json', 'aria-label':'Incident pack to verify' }); const result = element('p', '', { role: 'status' });
  checkFile.addEventListener('change', async () => { try { const candidate = JSON.parse(await checkFile.files[0].text()); const ok = await verifyPack(candidate); result.textContent = ok ? 'Pack unchanged: its fingerprint matches.' : 'Pack has been changed: use the original file.'; result.className = ok ? 'notice good' : 'notice bad'; } catch { result.textContent = 'That is not a valid Mgadi incident pack.'; result.className = 'notice bad'; } });
  const technical = element('details', '', { className: 'pack-technical' });
  technical.append(element('summary', 'Technical data and tamper check'), element('h2', 'Verify a downloaded pack'), element('p', 'Load a pack after changing a value to see the tamper check.'), checkFile, result, details);
  const actions = element('div', '', { className: 'pack-actions' });
  actions.append(download, button('Print or save as PDF', () => window.print(), 'button secondary'), tools.packButtons(pack, () => showPack(pack)), button('Start a new incident', showHome, 'button secondary'));
  card.classList.add('pack-workspace', 'pack-ready');
  card.append(element('p', 'YOUR INCIDENT · READY TO SAVE', { className: 'pack-stage' }), element('h1', 'Your incident pack is ready'), element('p', 'Download and keep this file safely. Nothing has been sent to a bank or anyone else.'), actions, summary, technical);
  app.append(card);
}

installAccessibility();
// What the person is reading right now: a draft translation, part draft and part English, or English only. It is worked out from the
// screen itself (text that fell back to English is tagged lang="en"), so it cannot claim more than is true. There is deliberately no
// "reviewed" state: no language has had a native speaker's review. When one has, add that state here together with the recorded review
// (and change test/translation-coverage.test.js on purpose), never before.
const LANGUAGE_NAMES = { zu: 'isiZulu', xh: 'isiXhosa', af: 'Afrikaans' };
const translationNote = document.querySelector('#translation-note');
function updateTranslationNote() {
  const name = LANGUAGE_NAMES[document.documentElement.lang];
  if (!name) { translationNote.hidden = true; translationNote.textContent = ''; delete translationNote.dataset.state; return; }
  const shown = [...app.querySelectorAll('[lang]')].filter((node) => !['TEXTAREA', 'INPUT', 'SELECT'].includes(node.tagName) && node.textContent.trim());
  const english = shown.filter((node) => node.lang === 'en').length;
  const state = !shown.length || english === 0 ? 'draft' : english === shown.length ? 'english' : 'partial';
  translationNote.dataset.state = state; translationNote.hidden = false;
  translationNote.textContent = {
    draft: `${name}: draft translation, not yet checked by a ${name} speaker.`,
    partial: `${name}: part of this screen is a draft translation. The rest is still in English.`,
    english: `This screen is in English: there is no ${name} translation for it yet.`,
  }[state];
}
let noteTimer = 0;
new MutationObserver(() => { clearTimeout(noteTimer); noteTimer = setTimeout(updateTranslationNote, 60); }).observe(app, { childList: true, subtree: true });
document.addEventListener('mgadi:language', () => { clearTimeout(noteTimer); noteTimer = setTimeout(updateTranslationNote, 60); });
// POPIA draft, supplier payment-change check and responder handoff (see public/tools/tools.js). "Already paid" always goes to the bank-first guide.
const tools = initTools({
  ui: { element, button, plain, clear, mount: (node) => app.append(node) },
  bridge: { showHome, alreadyPaid: () => { startFromChoice('payment_diversion'); showIncident('payment_diversion'); } },
});
window.addEventListener('hashchange', () => tools.openFromHash());
emergencyButton.setAttribute('aria-expanded', 'false');
emergencyButton.addEventListener('click', showBankLines);
// The offline copy is saved in the background. It must never delay or break the emergency screens, so failures are swallowed.
// "Idle" is the only moment a newer version may replace the page by itself: the start screen, nothing typed, no incident or evidence in
// progress, no voice panel or dialog open. Anything else keeps its screen, and the person chooses when to switch.
function isIdle() {
  if (!app.querySelector('.welcome-card')) return false;
  if ((journey && !journey.finished) || incident.evidence.length || Object.keys(incident.outcomes ?? {}).length) return false;
  if ([...app.querySelectorAll('input, textarea, select')].some((node) => (node.type === 'checkbox' || node.type === 'radio' ? node.checked : String(node.value ?? '') !== ''))) return false;
  if (document.documentElement.dataset.voice === 'open' || document.querySelector('dialog[open]')) return false;
  return true;
}
initOffline({ statusEl: document.querySelector('#offline-status'), isIdle }).catch(() => {});
// What the voice panel may see and do. It can read progress and show the bank list; only the person's own taps confirm steps.
const voiceBridge = {
  getJourney: () => (journey ? {
    label: journey.label, title: journey.flow.title, position: journey.position, finished: Boolean(journey.finished),
    steps: journey.flow.steps.map((step) => ({ id: step.id, title: step.title, why: step.why, do: step.do, done: step.done, skip: step.skip, state: journey.status[step.id]?.state ?? 'pending', at: journey.status[step.id]?.at ?? null })),
  } : null),
  getTimeline: () => incident.timeline,
  getSources: (label, stepId) => (resources?.routes?.[label] ?? []).filter((item) => !item.steps || item.steps.includes(stepId)),
  subscribe: (fn) => { journeyListeners.add(fn); return () => journeyListeners.delete(fn); },
  confirmCurrent: confirmCurrentStep, skipCurrent: skipCurrentStep, reportOther,
  showBank: showBankLines, log,
  showText: () => { const heading = app.querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus(); } },
};
const voiceReady = initVoice({ bridge: voiceBridge }).catch(() => ({ launchButton: () => document.createDocumentFragment() }));
Promise.all([fetch('/data/playbook.json').then((response) => response.json()), fetch('/data/fraud-lines.json').then((response) => response.json()), fetch('/data/resources.json').then((response) => response.json()).catch(() => null)])
  .then(async ([loadedPlaybook, loadedLines, loadedResources]) => { playbook = loadedPlaybook; fraudLines = loadedLines; resources = loadedResources; voice = await voiceReady; if (!tools.openFromHash()) showHome(); })
  .catch(() => { clear(); app.append(element('p', 'Mgadi could not load its local safety guide. Please call the fraud number on the back of your bank card.')); });
