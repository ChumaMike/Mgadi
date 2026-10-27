import { redactIncident } from './shared/redact.js';
import { classifyRules } from './shared/rules.js';
import { routeTriage } from './shared/labels.js';
import { sha256Hex } from './shared/sha256.js';
import { makePack, verifyPack } from './shared/pack.js';

const app = document.querySelector('#app');
const emergencyButton = document.querySelector('#emergency-button');
let playbook;
let fraudLines;
let incident = { timeline: [], evidence: [], outcomes: {} };

function element(tag, text, attributes = {}) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'className') node.className = value;
    else node.setAttribute(name, value);
  }
  return node;
}
function button(text, onClick, className = 'button') { const node = element('button', text, { className, type: 'button' }); node.addEventListener('click', onClick); return node; }
function clear() { app.replaceChildren(); }
function log(text) { incident.timeline.push({ at: new Date().toISOString(), text }); }

function showBankLines() {
  clear(); const card = element('section', '', { className: 'card' });
  card.append(element('h1', 'Call your bank now'), element('p', fraudLines.notice, { className: 'notice' }));
  for (const bank of fraudLines.banks) {
    const row = element('div', '', { className: 'bank' }); row.append(element('strong', bank.name), document.createElement('br'));
    const link = element('a', bank.number, { href: `tel:${bank.tel}` }); row.append(link); card.append(row);
  }
  card.append(button('Back', showHome, 'button secondary')); app.append(card);
}

function showHome() {
  clear(); const card = element('section', '', { className: 'card' });
  card.append(element('h1', 'What happened?'), element('p', 'Describe the incident in your own words. Mgadi will guide you to one safe next step.'));
  const description = element('textarea', '', { id: 'incident-description', placeholder: 'Example: We paid a supplier after an email said their banking details changed. They say they never got the money.' });
  const names = element('input', '', { id: 'names-to-hide', placeholder: 'Optional: names to hide, separated by commas' });
  card.append(element('label', 'What happened?', { for: 'incident-description' }), description, element('label', 'Names to hide', { for: 'names-to-hide' }), names, element('p', 'Before anything leaves this phone, Mgadi hides names, emails, phone numbers, bank-like numbers, amounts and links.', { className: 'privacy' }));
  card.append(button('Get safe next step', async () => {
    const hiddenNames = names.value.split(',').map((item) => item.trim()).filter(Boolean);
    const redacted = redactIncident(description.value, hiddenNames);
    incident = { description: description.value, redacted, timeline: [{ at: new Date().toISOString(), text: 'Incident started' }], evidence: [], outcomes: {} };
    await triage(redacted.text);
  }));
  app.append(card);
}

async function triage(redactedText) {
  clear(); const card = element('section', '', { className: 'card' }); card.append(element('h1', 'Checking safely…'), element('p', 'Your bank fraud line is available at the top of every screen.'));
  app.append(card);
  let result; let source = 'offline rules';
  try {
    const response = await fetch('/api/triage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: redactedText }) });
    if (!response.ok) throw new Error('triage unavailable');
    result = await response.json(); source = result.source;
  } catch { result = classifyRules(redactedText); }
  incident.triage = result; incident.source = source;
  const route = routeTriage(result);
  showIncident(route === 'clarify' ? 'unsure' : route);
}

function showIncident(label) {
  const flow = playbook.incidents[label] ?? playbook.incidents.unsure;
  let position = 0;
  const renderStep = () => {
    clear(); const step = flow.steps[position]; const card = element('section', '', { className: 'card' });
    card.append(element('p', `${flow.title} · Step ${position + 1} of ${flow.steps.length}`, { className: 'step-count' }), element('h1', step.title), element('p', flow.summary), element('h2', 'Why this matters'), element('p', step.why), element('h2', 'Do this now'));
    const list = element('ul'); step.do.forEach((item) => list.append(element('li', item))); card.append(list);
    if (step.id === 'bank') card.append(button('Choose a bank fraud line', showBankLines, 'button danger'));
    card.append(button(step.done, () => { log(step.title); if (step.id === 'bank') incident.firstActionAt = new Date().toISOString(); if (position < flow.steps.length - 1) { position += 1; renderStep(); } else showEvidencePack(flow); }));
    card.append(button('Start again', showHome, 'button secondary')); app.append(card);
  }; renderStep();
}

function showEvidencePack(flow) {
  clear(); const card = element('section', '', { className: 'card' });
  const files = element('input', '', { type: 'file', multiple: 'multiple', accept: 'image/*,.pdf,.eml,.msg,.txt' });
  const list = element('ul');
  const feedback = element('p', '', { className: 'privacy' });
  files.addEventListener('change', async () => {
    for (const file of files.files) {
      try {
        const sha256 = await sha256Hex(await file.arrayBuffer());
        incident.evidence.push({ name: file.name, size: file.size, type: file.type || 'unknown', sha256, addedAt: new Date().toISOString() });
        const row = element('li', `${file.name} — SHA-256 ${sha256}`); list.append(row); log(`Fingerprinted evidence: ${file.name}`);
      } catch (error) { feedback.textContent = error.message; }
    }
    files.value = '';
  });
  const business = element('input', '', { placeholder: 'Business name (optional)' });
  const amount = element('input', '', { placeholder: 'Amount paid, e.g. R70 000 (optional)' });
  const make = button('Make incident pack', async () => {
    log('Generated incident pack');
    const pack = await makePack({ format: 'mgadi-incident-pack/1', generatedAt: new Date().toISOString(), business: business.value, amount: amount.value, incident: { label: incident.triage?.label, confidence: incident.triage?.confidence, source: incident.source, title: flow.title }, ownerDescription: incident.description, firstSafeActionAt: incident.firstActionAt || null, timeline: incident.timeline, evidence: incident.evidence, warning: 'A matching fingerprint detects changes after capture. It does not prove a file is genuine.' });
    showPack(pack);
  });
  card.append(element('h1', 'Keep evidence and make your incident pack'), element('p', 'Choose screenshots, emails or proof of payment. Files stay on this device; only their fingerprints go into the pack.'), element('label', 'Evidence files'), files, feedback, list, element('label', 'Business'), business, element('label', 'Amount paid'), amount, make, button('Start a new incident', showHome, 'button secondary'));
  app.append(card);
}

function showPack(pack) {
  clear(); const card = element('section', '', { className: 'card' });
  const details = element('pre', JSON.stringify(pack, null, 2));
  details.className = 'pack-json';
  const download = button('Download incident pack (.json)', () => { const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }); const link = element('a', '', { href: URL.createObjectURL(blob), download: 'mgadi-incident-pack.json' }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); });
  const checkFile = element('input', '', { type: 'file', accept: '.json,application/json' }); const result = element('p');
  checkFile.addEventListener('change', async () => { try { const candidate = JSON.parse(await checkFile.files[0].text()); result.textContent = await verifyPack(candidate) ? 'Pack unchanged: its fingerprint matches.' : 'Pack has been changed: use the original file.'; result.className = await verifyPack(candidate) ? 'notice good' : 'notice bad'; } catch { result.textContent = 'That is not a valid Mgadi incident pack.'; result.className = 'notice bad'; } });
  card.append(element('h1', 'Incident pack ready'), element('p', 'Share this with your bank, SAPS or insurer if needed. It contains your timeline and evidence fingerprints, not the evidence files.'), download, button('Print or save as PDF', () => window.print(), 'button secondary'), element('h2', 'Verify a downloaded pack'), element('p', 'Load a pack after changing a value to see the tamper check.'), checkFile, result, element('h2', 'Pack fingerprint'), element('code', pack.fingerprint), details, button('Start a new incident', showHome, 'button secondary'));
  app.append(card);
}

emergencyButton.addEventListener('click', showBankLines);
Promise.all([fetch('/data/playbook.json').then((response) => response.json()), fetch('/data/fraud-lines.json').then((response) => response.json())])
  .then(([loadedPlaybook, loadedLines]) => { playbook = loadedPlaybook; fraudLines = loadedLines; showHome(); })
  .catch(() => { clear(); app.append(element('p', 'Mgadi could not load its local safety guide. Please call the fraud number on the back of your bank card.')); });
