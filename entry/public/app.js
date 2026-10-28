import { bindText, installAccessibility, guidanceControls, stopSpeech, getLocale } from './accessibility/accessibility.js';
import { redactIncident } from './shared/redact.js';
import { routeTriage } from './shared/labels.js';
import { sha256Hex } from './shared/sha256.js';
import { makePack, verifyPack } from './shared/pack.js';
import { triageWithFallback } from './shared/triage-client.js';
import { initVoice } from './voice/panel.js';
import { initOffline } from './offline/register.js';
import { initTools } from './tools/tools.js';
import { icon } from './shared/icons.js';
import { languages } from './accessibility/catalog.js';
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

// One calm row for the secondary ways in: an icon, one control, and a line saying what it does.
function secondaryItem(iconName, control, description) {
  const item = document.createElement('li'); item.className = 'secondary-item';
  const mark = element('span', '', { className: 'secondary-icon', 'aria-hidden': 'true' }); mark.append(icon(iconName));
  const text = element('div', '', { className: 'secondary-text' }); text.append(control, element('p', description));
  item.append(mark, text); return item;
}
function openSettings() {
  const panel = document.querySelector('#accessibility details'); if (!panel) return;
  panel.open = true; panel.scrollIntoView?.({ block: 'start' });
  (panel.querySelector('#language') ?? panel.querySelector('summary'))?.focus();
}
// Shown only while an incident is open on this page. Nothing is saved in the browser, so a closed tab means a fresh start.
function continueCard() {
  if (!journey || !incident?.title) return null;
  const card = element('section', '', { className: 'continue-card', 'aria-label': 'Continue your incident' });
  const text = element('div', '', { className: 'continue-card__text' });
  const where = journey.finished ? 'Your incident pack is ready to review.' : `${journey.flow.title}: step ${journey.position + 1} of ${journey.flow.steps.length}.`;
  text.append(element('strong', 'Continue your incident'), element('p', where), element('p', 'Kept only while this page stays open. Mgadi does not save it in your browser. Choosing a new situation replaces it.'));
  card.append(icon('resume'), text, button(journey.finished ? 'Back to your pack' : 'Continue', () => { if (journey.finished) showEvidencePack(journey.flow); else renderStep(); }));
  return card;
}

function showHome() {
  clear();
  const card = element('section', '', { className: 'card welcome-card' });
  const resume = continueCard(); if (resume) card.append(resume);
  const hero = element('div', '', { className: 'welcome-intro' });
  const intro = element('p', 'Choose the closest option. We’ll guide you one step at a time.', { className: 'hero-intro' });
  hero.append(element('p', 'YOUR FIRST HOUR, MADE SIMPLER', { className: 'eyebrow' }), element('h1', 'Something feels wrong?'), intro);
  card.append(hero);
  const actions = element('div', '', { className: 'primary-actions' });

  // 1. The emergency door. The five situations are one tap each, so the next step is never more than two taps away.
  const urgent = element('section', '', { className: 'action-card action-card--urgent', 'aria-labelledby': 'urgent-title' });
  const urgentHead = element('div', '', { className: 'action-card__head' });
  const urgentMark = element('span', '', { className: 'action-card__icon', 'aria-hidden': 'true' }); urgentMark.append(icon('alert'));
  const urgentText = element('div'); const urgentTitle = element('h2', 'I think something has gone wrong', { id: 'urgent-title' });
  urgentText.append(urgentTitle, element('p', 'Pick what is closest. You do not need technical words.'));
  urgentHead.append(urgentMark, urgentText); urgent.append(urgentHead);
  const choices = element('div', '', { className: 'incident-choices welcome-choices' });
  const iconFor = ['money', 'lock', 'mail', 'link', 'help'];
  playbook.entry.options.forEach((option, index) => {
    const choice = button('', () => chooseEntry(option), 'button secondary situation-card');
    const mark = element('span', '', { className: 'choice-icon', 'aria-hidden': 'true' }); mark.append(icon(iconFor[index] || 'help'));
    const arrow = element('span', '', { className: 'choice-arrow', 'aria-hidden': 'true' }); arrow.append(icon('arrow'));
    choice.append(mark, element('span', option.text), arrow);
    choices.append(choice);
  });
  urgent.append(choices);
  const writing = element('details', '', { className: 'describe-incident' });
  writing.append(element('summary', 'Prefer to describe it in your own words?'));
  const description = element('textarea', '', { id: 'incident-description', placeholder: 'Example: We paid a supplier after an email said their banking details changed. They say they never got the money.' });
  description.lang = 'en';
  const names = element('input', '', { id: 'names-to-hide', placeholder: 'Optional: names to hide, separated by commas' });
  writing.append(element('p', 'Please type in English. For other languages, use the choices above.', { className: 'privacy' }), element('label', 'What happened?', { for: 'incident-description' }), description, element('label', 'Names to hide', { for: 'names-to-hide' }), names);
  const submit = button('Get safe next step', async () => {
    if (!description.value.trim()) { description.setCustomValidity('Describe what happened, or choose a situation above.'); description.reportValidity(); return; }
    const hiddenNames = names.value.split(',').map((item) => item.trim()).filter(Boolean);
    const redacted = redactIncident(description.value, hiddenNames);
    incident = { description: description.value, redacted, timeline: [{ at: new Date().toISOString(), text: 'Incident started' }], evidence: [], outcomes: {} };
    await triage(redacted.text);
  });
  description.addEventListener('input', () => description.setCustomValidity(''));
  writing.append(submit); urgent.append(writing);

  // 2. The prevention door: the supplier payment check.
  const calm = element('section', '', { className: 'action-card action-card--calm', 'aria-labelledby': 'check-title' });
  const calmHead = element('div', '', { className: 'action-card__head' });
  const calmMark = element('span', '', { className: 'action-card__icon', 'aria-hidden': 'true' }); calmMark.append(icon('check'));
  const calmText = element('div'); calmText.append(element('h2', 'Check before paying', { id: 'check-title' }), element('p', 'A supplier sent new bank details? Check them, and phone the supplier yourself, before any money moves.'));
  calmHead.append(calmMark, calmText); calm.append(calmHead, tools.homeButton());
  actions.append(urgent, calm); card.append(actions);

  // 3. Secondary access, in calm rows rather than more cards.
  const more = element('section', '', { className: 'secondary-actions', 'aria-labelledby': 'more-title' });
  more.append(element('h2', 'More ways to use Mgadi', { id: 'more-title' }));
  const list = element('ul', '', { className: 'secondary-list' });
  list.append(
    secondaryItem('mic', voice.launchButton(), 'Talk it through with Mgadi’s assistant. Captions show on screen, and every step also works in text.'),
    secondaryItem('file', button('Check a PDF or message', () => tools.showEvidenceScreen(showHome), 'button secondary'), 'Read an invoice or a pasted message on this device and compare what it says.'),
    secondaryItem('pack', button('Build an incident pack', startRecord, 'button secondary'), 'Keep evidence fingerprints and prepare what you would share with your bank or a helper.'),
    secondaryItem('settings', button('Language and accessibility', openSettings, 'button secondary'), 'Text size, contrast, less movement, read-aloud and language. No account needed.'),
  );
  more.append(list, guidanceControls([intro], 'welcome'));
  const limits = element('details', '', { className: 'capability-limits' });
  limits.append(element('summary', 'What still needs a person?'), element('p', 'You make bank calls, confirm supplier details and approve sharing. Mgadi does not freeze money or change accounts. Live voice needs a connection; SASL translation is not available yet.'));
  more.append(limits); card.append(more);
  app.append(card);
  document.dispatchEvent(new Event('mgadi:idle')); // lets a waiting update apply now that nothing is in progress
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
  const links = resourceLinks(label); if (links) card.append(links);
  card.append(reviewBadge(flow), button('Start again', showHome, 'button secondary')); app.append(card);
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
  const feedback = element('p', '', { role: 'alert', className: 'pack-feedback' });
  const makeButton = button('Make incident pack', async () => {
    makeButton.disabled = true; feedback.textContent = '';
    try {
      const event = { at: new Date().toISOString(), text: 'Generated incident pack' };
      const state = packState(); state.timeline = [...state.timeline, event];
      const pack = await makePack(buildPackData(state, options));
      incident.timeline.push(event); showPack(pack);
    } catch (error) {
      feedback.textContent = error.message || 'The pack could not be created. Your entries are still here. Please try again.';
    } finally { makeButton.disabled = false; }
  });
  card.append(feedback, makeButton, button('Back', () => showEvidencePack(flow), 'button secondary'));
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
  // What happens next, grouped by what each action does, so nobody shares something by accident or thinks a draft has been sent.
  const [popiaButton, helperButton, documentsButton] = [...tools.packButtons(pack, () => showPack(pack)).children];
  download.classList.add('row-primary');
  const actions = element('section', '', { className: 'pack-next', 'aria-labelledby': 'pack-next-title' });
  const state = element('div', '', { className: 'ds-status ds-status--info' }); const stateText = element('div');
  stateText.append(element('strong', 'Draft on this device: nothing has been shared'), element('p', 'Mgadi shares nothing unless you choose to. Making a link is not the same as someone receiving it: Mgadi says "link created", and shows "acknowledged" only if the other person confirms it themselves.'));
  state.append(icon('file'), stateText);
  const list = element('ul', '', { className: 'secondary-list pack-list' });
  list.append(
    secondaryItem('pack', download, 'Saves a file on this device. Nothing is sent. Keep it with the original messages and proof of payment.'),
    secondaryItem('file', button('Print or save as PDF', () => window.print(), 'button secondary'), 'Uses your browser’s print screen. Nothing is sent.'),
    secondaryItem('mail', helperButton, 'Makes a private link that you pass on yourself. Only someone holding the link can read it. Mgadi cannot tell whether it was opened.'),
    secondaryItem('file', documentsButton, 'Read an invoice, proof of payment or pasted message on this device and compare what it says. Nothing is uploaded.'),
    secondaryItem('alert', popiaButton, 'A template for your information officer to review. It is not legal advice and nothing is sent.'),
    secondaryItem('resume', button('Start a new incident', showHome, 'button secondary'), 'Clears this incident from the screen. Download first if you need a copy.'),
  );
  actions.append(element('h2', 'What would you like to do?', { id: 'pack-next-title' }), state, list);
  card.append(summary, actions, technical);
  app.append(card);
}

installAccessibility();
// What the person is reading right now: a draft translation, part draft and part English, or English only. It is worked out from the
// screen itself (text that fell back to English is tagged lang="en"), so it cannot claim more than is true. There is deliberately no
// "reviewed" state: no language has had a native speaker's review. When one has, add that state here together with the recorded review
// (and change test/translation-coverage.test.js on purpose), never before.
const translationNote = document.querySelector('#translation-note');
function updateTranslationNote() {
  const name = document.documentElement.lang === 'en' ? null : languages[document.documentElement.lang];
  if (!name) { translationNote.hidden = true; translationNote.textContent = ''; delete translationNote.dataset.state; return; }
  const shown = [...app.querySelectorAll('[lang]')].filter((node) => !['TEXTAREA', 'INPUT', 'SELECT'].includes(node.tagName) && node.textContent.trim());
  const english = shown.filter((node) => node.lang === 'en').length;
  const state = !shown.length || english === 0 ? 'draft' : english === shown.length ? 'english' : 'partial';
  translationNote.dataset.state = state; translationNote.hidden = false;
  translationNote.textContent = {
    draft: `${name}: draft translation, not yet checked by a ${name} speaker.`,
    partial: `${name}: part of this screen is a draft translation that no ${name} speaker has checked. The rest is still in English.`,
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
  subscribe: (fn) => { journeyListeners.add(fn); return () => journeyListeners.delete(fn); },
  confirmCurrent: confirmCurrentStep, skipCurrent: skipCurrentStep, reportOther,
  showBank: showBankLines, log,
  showText: () => { const heading = app.querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus(); } },
};
// Settings say, in plain words, whether live voice exists for the language that is chosen. It reads what the server reports; it never
// assumes. Text guidance is always named as the way that always works.
const voiceSetting = document.createElement('p'); voiceSetting.id = 'voice-availability'; voiceSetting.className = 'setting-note'; voiceSetting.lang = 'en'; voiceSetting.setAttribute('role', 'status');
function updateVoiceSetting() {
  const config = voice.config; const info = config?.languages?.[getLocale()];
  let text = 'Live voice: not available in this version. Text guidance always works.';
  if (config?.mode === 'mock' && info?.available) text = 'Live voice: a labelled SIMULATION only. There is no real AI and no microphone is used. Text guidance always works.';
  else if (info?.available) text = `Live voice: available in ${info.label}. You choose when to start it. Text guidance always works.`;
  else if (info) text = `Live voice: not available in ${info.label}. ${info.reason}${/text guidance/i.test(info.reason) ? '' : ' Text guidance always works.'}`;
  voiceSetting.textContent = text;
  const host = document.querySelector('#accessibility .access-panel');
  if (host && !voiceSetting.isConnected) (host.querySelector('#language-status') ?? host.firstChild).after(voiceSetting);
}
document.addEventListener('mgadi:language', updateVoiceSetting);
// If the voice panel cannot start, the text guidance still works, but the reason is written to the console so it is not lost.
const voiceReady = initVoice({ bridge: voiceBridge }).catch((error) => { console.error('Mgadi: the voice panel could not start. Text guidance is unaffected.', error); return { launchButton: () => document.createDocumentFragment() }; });
Promise.all([fetch('/data/playbook.json').then((response) => response.json()), fetch('/data/fraud-lines.json').then((response) => response.json()), fetch('/data/resources.json').then((response) => response.json()).catch(() => null)])
  .then(async ([loadedPlaybook, loadedLines, loadedResources]) => { playbook = loadedPlaybook; fraudLines = loadedLines; resources = loadedResources; voice = await voiceReady; updateVoiceSetting(); if (!tools.openFromHash()) showHome(); })
  .catch(() => { clear(); app.append(element('p', 'Mgadi could not load its local safety guide. Please call the fraud number on the back of your bank card.')); });
