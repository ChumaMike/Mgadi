import { bindText, installAccessibility, guidanceControls, callWalkthrough, stopSpeech } from './accessibility/accessibility.js';
import { redactIncident } from './shared/redact.js';
import { routeTriage } from './shared/labels.js';
import { sha256Hex } from './shared/sha256.js';
import { makePack, verifyPack } from './shared/pack.js';
import { triageWithFallback } from './shared/triage-client.js';
import { initVoice } from './voice/panel.js';
import { initOffline } from './offline/register.js';
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
  return element('p', text, { className: 'notice review-status print-keep' });
}
function plain(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }

// Only https links to hosts listed in resources.json are ever rendered. Link text is set as text, never parsed as HTML.
function resourceLinks(route) {
  const items = (resources?.routes?.[route] ?? []).filter((item) => {
    try { const url = new URL(item.url); return url.protocol === 'https:' && resources.allowedHosts.includes(url.hostname); } catch { return false; }
  });
  if (!items.length) return null;
  const box = element('details', '', { className: 'resources' });
  box.append(element('summary', 'Trusted resources (open outside Mgadi)'), element('p', resources.note, { className: 'notice' }), plain('p', `Links last checked on ${resources.checkedOn}. They need an internet connection.`, 'privacy'));
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

function showBankLines() {
  const previous = [...app.childNodes];
  inBank = true;
  clear(); const card = element('section', '', { className: 'card' });
  card.append(element('h1', 'Call your bank now'), element('p', fraudLines.notice, { className: 'notice' }), plain('p', `Bank numbers last checked on ${fraudLines.checkedOn}. Check each one against the back of your bank card or your banking app.`, 'privacy'));
  for (const bank of fraudLines.banks) {
    const row = element('div', '', { className: 'bank' }); row.append(element('strong', bank.name), document.createElement('br'));
    const link = element('a', bank.number, { href: `tel:${bank.tel}` }); row.append(link); card.append(row);
  }
  card.append(button('Back', () => {
    stopSpeech(); inBank = false;
    if (afterBank) { const next = afterBank; afterBank = null; next(); return; }
    app.replaceChildren(...previous); const heading = app.querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus(); }
  }, 'button secondary')); app.append(card);
}

function showHome() {
  clear(); const card = element('section', '', { className: 'card' });
  card.append(element('h1', 'What happened?'), element('p', 'Describe the incident in your own words. Mgadi will guide you to one safe next step.'));
  const choices=element('div', '', {className:'incident-choices'});
  choices.append(element('p', playbook.entry.intro));
  for (const option of playbook.entry.options) choices.append(button(option.text, () => chooseEntry(option), 'button secondary'));
  card.append(choices);
  const description = element('textarea', '', { id: 'incident-description', placeholder: 'Example: We paid a supplier after an email said their banking details changed. They say they never got the money.' });
  const names = element('input', '', { id: 'names-to-hide', placeholder: 'Optional: names to hide, separated by commas' });
  description.lang='en';
  card.append(element('p', 'Free-text classification is not verified for isiZulu, isiXhosa or Afrikaans. Use the choices above for these languages, or type in English.', {className:'notice'}));
  card.append(element('label', 'What happened?', { for: 'incident-description' }), description, element('label', 'Names to hide', { for: 'names-to-hide' }), names, element('p', 'Before anything leaves this phone, Mgadi hides names, emails, phone numbers, bank-like numbers, amounts and links.', { className: 'privacy' }));
  card.append(button('Get safe next step', async () => {
    const hiddenNames = names.value.split(',').map((item) => item.trim()).filter(Boolean);
    const redacted = redactIncident(description.value, hiddenNames);
    incident = { description: description.value, redacted, timeline: [{ at: new Date().toISOString(), text: 'Incident started' }], evidence: [], outcomes: {} };
    await triage(redacted.text);
  }));
  const intro=card.querySelector('p');
  card.append(guidanceControls([intro], 'welcome'), button('Call experience — prototype',()=>callWalkthrough([intro]),'button secondary'), voice.launchButton());
  app.append(card);
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
  if (option.route) { startFromChoice(option.route); showIncident(option.route); }
  else if (option.next === 'payment') showPaymentChoice();
  else { startFromChoice('clarify'); showClarify(); }
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
  else { emitJourney(); showEvidencePack(journey.flow); }
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

function renderStep() {
  const { label, flow, position } = journey;
  clear(); const step = flow.steps[position]; const card = element('section', '', { className: 'card' });
  card.append(element('p', `${flow.title} · Step ${position + 1} of ${flow.steps.length}`, { className: 'step-count' }), reviewBadge(flow), element('h1', step.title), element('p', flow.summary), ...(flow.orgNote ? [element('p', flow.orgNote, { className: 'notice org-note' })] : []), element('h2', 'Why this matters'), element('p', step.why), element('h2', 'Do this now'));
  const list = element('ul'); step.do.forEach((item) => list.append(element('li', item))); card.append(list);
  const guidance=[...card.querySelectorAll('h1, p:not(.step-count):not(.review-status), li')];
  const links = resourceLinks(label); if (links) card.append(links);
  card.append(guidanceControls(guidance, `${label}.${step.id}`), button('Call experience — prototype',()=>callWalkthrough(guidance),'button secondary'), voice.launchButton());
  if (step.id === 'bank') card.append(button('Choose a bank fraud line', showBankLines, 'button danger'));
  // A button press is the owner's own report. It is never proof that the bank answered or acted.
  card.append(button(step.done, confirmCurrentStep));
  if (step.skip) card.append(button(step.skip, skipCurrentStep, 'button secondary'));
  card.append(button('Start again', showHome, 'button secondary')); app.append(card);
}

function showEvidencePack(flow) {
  clear(); const card = element('section', '', { className: 'card' });
  const files = element('input', '', { id: 'evidence-files', type: 'file', multiple: 'multiple', accept: 'image/*,.pdf,.eml,.msg,.txt' });
  const list = element('ul');
  const addRow = (item) => list.append(plain('li', `${item.name} — SHA-256 ${item.sha256}`));
  incident.evidence.forEach(addRow);
  const feedback = element('p', '', { className: 'privacy', role: 'status' });
  files.addEventListener('change', async () => {
    feedback.textContent = '';
    for (const file of files.files) {
      try {
        const sha256 = await sha256Hex(await file.arrayBuffer());
        if (incident.evidence.some((item) => item.sha256 === sha256 && item.name === file.name)) continue;
        const item = { name: file.name, size: file.size, type: file.type || 'unknown', sha256, addedAt: new Date().toISOString() };
        incident.evidence.push(item); addRow(item); log(`Fingerprinted evidence: ${file.name}`);
      } catch (error) { feedback.textContent = error.message; }
    }
    files.value = '';
  });
  const business = element('input', '', { id:'business-name', placeholder: 'Business name (optional)' });
  const amount = element('input', '', { id:'amount-paid', placeholder: 'Amount paid, e.g. R 70 000,00 (optional)' });
  business.value = incident.business ?? ''; amount.value = incident.amount ?? '';
  business.addEventListener('input', () => { incident.business = business.value; });
  amount.addEventListener('input', () => { incident.amount = amount.value; });
  card.append(element('h1', 'Keep evidence and make your incident pack'), element('p', 'Choose screenshots, emails or proof of payment. Files stay on this device; only their fingerprints go into the pack.'), element('label', 'Evidence files', {for:'evidence-files'}), files, feedback, list, element('label', 'Business', {for:'business-name'}), business, element('label', 'Amount paid', {for:'amount-paid'}), amount, handoffForm(), button('Review what goes in the pack', () => showPackReview(flow)), button('Start a new incident', showHome, 'button secondary'));
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
  clear(); const card = element('section', '', { className: 'card' });
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
  card.append(element('h1', 'Check what goes in your pack'), element('p', 'The pack may be shared with your bank, SAPS or insurer. By default it holds a version of your description with personal details hidden. Choose anything extra yourself.'));
  check('include-original', 'Also include my own words exactly as I typed them. They may contain names or numbers.', 'includeOriginal', Boolean(String(state.description ?? '').trim()));
  check('include-business', 'Include the business name', 'includeBusiness', Boolean(String(state.business ?? '').trim()));
  check('include-amount', 'Include the amount paid', 'includeAmount', Boolean(String(state.amount ?? '').trim()));
  check('include-handoff', 'Include handoff details: the steps you reported, what is still open and anything you typed for a bank or specialist', 'includeHandoff', true);
  card.append(element('h2', 'What will be in the pack'), preview, element('p', 'Hiding is pattern based: names are only hidden if you listed them, so read the text above before sharing.', { className: 'privacy' }));
  render();
  card.append(button('Make incident pack', async () => {
    log('Generated incident pack');
    const pack = await makePack(buildPackData(packState(), options));
    showPack(pack);
  }), button('Back', () => showEvidencePack(flow), 'button secondary'));
  app.append(card);
}

function showPack(pack) {
  clear(); const card = element('section', '', { className: 'card' });
  const summary = element('section', '', { className: 'pack-summary' });
  summary.append(element('h1', 'Incident summary'), plain('p', `Prepared ${formatTime(pack.generatedAt)}`, 'privacy'), reviewBadge());
  for (const section of summarySections(pack)) {
    summary.append(element('h2', section.heading));
    if (section.heading === 'Timeline' || section.heading === 'Evidence fingerprints') { const ul = document.createElement('ul'); section.lines.forEach((line) => ul.append(plain('li', line))); summary.append(ul); }
    else section.lines.forEach((line) => summary.append(plain('p', line)));
  }
  summary.append(element('h2', 'Pack fingerprint'), plain('p', pack.fingerprint, 'hash'));
  const details = element('pre', JSON.stringify(pack, null, 2));
  details.className = 'pack-json';
  const download = button('Download incident pack (.json)', () => { const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }); const link = element('a', '', { href: URL.createObjectURL(blob), download: 'mgadi-incident-pack.json' }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); });
  const checkFile = element('input', '', { type: 'file', accept: '.json,application/json', 'aria-label':'Incident pack to verify' }); const result = element('p', '', { role: 'status' });
  checkFile.addEventListener('change', async () => { try { const candidate = JSON.parse(await checkFile.files[0].text()); const ok = await verifyPack(candidate); result.textContent = ok ? 'Pack unchanged: its fingerprint matches.' : 'Pack has been changed: use the original file.'; result.className = ok ? 'notice good' : 'notice bad'; } catch { result.textContent = 'That is not a valid Mgadi incident pack.'; result.className = 'notice bad'; } });
  const technical = element('details', '', { className: 'pack-technical' });
  technical.append(element('summary', 'Technical data and tamper check'), element('h2', 'Verify a downloaded pack'), element('p', 'Load a pack after changing a value to see the tamper check.'), checkFile, result, details);
  const actions = element('div', '', { className: 'pack-actions' });
  actions.append(download, button('Print or save as PDF', () => window.print(), 'button secondary'), button('Start a new incident', showHome, 'button secondary'));
  card.append(summary, actions, technical);
  app.append(card);
}

installAccessibility();
emergencyButton.addEventListener('click', showBankLines);
// The offline copy is saved in the background. It must never delay or break the emergency screens, so failures are swallowed.
initOffline({ statusEl: document.querySelector('#offline-status') }).catch(() => {});
// What the voice panel may see and do. It can read progress and show the bank list; only the person's own taps confirm steps.
const voiceBridge = {
  getJourney: () => (journey ? {
    label: journey.label, title: journey.flow.title, position: journey.position,
    steps: journey.flow.steps.map((step) => ({ id: step.id, title: step.title, why: step.why, do: step.do, done: step.done, skip: step.skip, state: journey.status[step.id]?.state ?? 'pending', at: journey.status[step.id]?.at ?? null })),
  } : null),
  getTimeline: () => incident.timeline,
  subscribe: (fn) => { journeyListeners.add(fn); return () => journeyListeners.delete(fn); },
  confirmCurrent: confirmCurrentStep, skipCurrent: skipCurrentStep,
  showBank: showBankLines, log,
  showText: () => { const heading = app.querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus(); } },
};
const voiceReady = initVoice({ bridge: voiceBridge }).catch(() => ({ launchButton: () => document.createDocumentFragment() }));
Promise.all([fetch('/data/playbook.json').then((response) => response.json()), fetch('/data/fraud-lines.json').then((response) => response.json()), fetch('/data/resources.json').then((response) => response.json()).catch(() => null)])
  .then(async ([loadedPlaybook, loadedLines, loadedResources]) => { playbook = loadedPlaybook; fraudLines = loadedLines; resources = loadedResources; voice = await voiceReady; showHome(); })
  .catch(() => { clear(); app.append(element('p', 'Mgadi could not load its local safety guide. Please call the fraud number on the back of your bank card.')); });
