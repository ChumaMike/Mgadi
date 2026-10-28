// Evidence Assist screen part: the owner picks a PDF or pastes message text, Mgadi suggests details it finds, the owner decides which
// to use, and the sources are compared. All of it runs on this device. Nothing is uploaded and nothing here contacts anyone.
// Text from a document is untrusted: it is searched with fixed patterns and shown as text only.
import { extractPdfText } from '../shared/pdf-text.js';
import { findCandidates, compareSources, reviewFacts, textWarnings, FIELDS, STATUS_TEXT, AGREEMENT_NOTE } from '../shared/evidence.js';
import { sha256Hex } from '../shared/sha256.js';
import { makePack } from '../shared/pack.js';
import { cleanLine } from '../shared/text.js';

const MAX_SOURCES = 3;
const PDF_MAX = 5 * 1024 * 1024;

// ctx.baseline / ctx.proposed (optional): { holder, bank, account, branch } held in memory only, for the comparison.
export function createEvidencePanel({ ui, ctx = {}, onChange = () => {} }) {
  const { element, button, plain } = ui;
  const sources = new Map(); let counter = 0;
  const box = element('details', '', { className: 'resources evidence-panel' });
  box.append(element('summary', 'Add evidence from your own files (optional)'));
  box.append(element('p', 'Choose a proof-of-payment or invoice PDF, or paste the text of an email or SMS you choose. It is read on this device: nothing is uploaded. Mgadi suggests details it finds and you decide which to use. Text inside a document is shown as text and never followed.', { className: 'privacy' }));

  const status = element('p', '', { role: 'status', className: 'privacy' });
  const fileInput = element('input', '', { type: 'file', accept: '.pdf,application/pdf', 'aria-label': 'Proof of payment or invoice (PDF)' });
  const pasteLabel = element('label', 'Or paste the text of an email or SMS', { for: 'ev-paste' });
  const paste = element('textarea', '', { id: 'ev-paste', maxlength: '8000', placeholder: 'Paste only the part you want to check' });
  const list = element('div', '', { className: 'evidence-sources' }); const result = element('div', '', { className: 'evidence-result' });

  const pickedFacts = (src) => Object.fromEntries(Object.entries(src.chosen).filter(([, v]) => v));
  function recompute() {
    const confirmed = {};
    if (ctx.baseline) confirmed.baseline = { label: 'Trusted details you entered', kind: 'baseline', facts: ctx.baseline };
    if (ctx.proposed) confirmed.request = { label: 'Details in the request', kind: 'request', facts: ctx.proposed };
    const docs = {};
    for (const [id, src] of sources) { const entry = { label: src.label, kind: src.kind, facts: pickedFacts(src), sha256: src.sha256 }; confirmed[id] = entry; docs[id] = entry; }
    const comparison = compareSources(confirmed);
    result.replaceChildren();
    if (!sources.size) { onChange(null); return; }
    result.append(element('h3', 'What the sources say'));
    const ul = element('ul', '', { className: 'compare' });
    for (const row of comparison.rows) {
      const li = document.createElement('li'); li.append(plain('strong', `${row.label}: ${STATUS_TEXT[row.status]}. `));
      li.append(plain('span', row.values.map((v) => `${v.shown} (${v.sources.map((s) => s.label).join(', ')})`).join('  versus  '))); ul.append(li);
    }
    if (!comparison.rows.length) ul.append(plain('li', 'Choose at least one detail above to compare.'));
    result.append(ul);
    if (comparison.missing.length) result.append(plain('p', `Not found in any source: ${comparison.missing.join(', ')}.`, 'privacy'));
    result.append(element('p', AGREEMENT_NOTE, { className: 'notice' }));
    const { summary } = reviewFacts(docs, comparison); onChange(summary);
    result.append(button('Download this evidence summary (.json)', async () => {
      const data = { format: 'mgadi-evidence-summary/1', createdAt: new Date().toISOString(), sources: [...sources.values()].map((s) => ({ label: s.label, kind: s.kind, sha256: s.sha256 || null, readBy: s.readBy })), reviewedFacts: summary?.facts ?? [], conflicts: summary?.conflicts ?? [], comparison: comparison.rows, statement: 'Details the owner reviewed, read by fixed patterns on the owner\'s device. Mgadi has not checked them, contacted anyone, or kept any file. A matching fingerprint shows only that a file is unchanged since it was chosen on this device.' };
      const pack = await makePack(data); const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
      const a = element('a', '', { href: url, download: 'mgadi-evidence-summary.json' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'button secondary'));
  }

  function renderSource(id) {
    const src = sources.get(id); const card = element('section', '', { className: 'evidence-source' });
    card.append(element('h3', src.label));
    if (src.note) card.append(element('p', src.note, { className: 'notice' }));
    for (const w of src.warnings) card.append(element('p', w, { className: 'notice bad' }));
    card.append(element('p', 'For each detail, choose what Mgadi found or type it yourself. Leave it as "Not used" to skip it.', { className: 'privacy' }));
    for (const field of Object.keys(FIELDS)) {
      const found = src.candidates.filter((c) => c.field === field);
      const sid = `ev-${id}-${field}`; const row = element('div', '', { className: 'field' });
      const select = element('select', '', { id: sid }); const none = plain('option', 'Not used'); none.value = ''; select.append(none);
      found.forEach((c, i) => { const o = plain('option', `${c.shown}  (found near: "${c.snippet}")`); o.value = String(i); select.append(o); });
      const typed = element('input', '', { type: 'text', maxlength: '60', autocomplete: 'off', 'aria-label': `${FIELDS[field]}: or type it yourself` });
      const apply = () => { src.chosen[field] = typed.value.trim() || (select.value !== '' ? found[Number(select.value)].value : ''); recompute(); };
      select.addEventListener('change', () => { typed.value = ''; apply(); }); typed.addEventListener('input', apply);
      row.append(element('label', FIELDS[field], { for: sid }), select, typed); card.append(row);
    }
    const remove = button('Remove this source', () => { sources.delete(id); card.remove(); recompute(); status.textContent = 'Removed.'; }, 'button secondary');
    card.append(remove); return card;
  }

  function addSource(src) {
    const id = `s${++counter}`; sources.set(id, { chosen: {}, ...src }); list.append(renderSource(id)); recompute();
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; fileInput.value = ''; if (!file) return;
    if (sources.size >= MAX_SOURCES) { status.textContent = `You can add up to ${MAX_SOURCES} sources. Remove one first.`; return; }
    if (file.size > PDF_MAX) { status.textContent = 'That file is too large to read on this device. Type the details instead.'; addSource({ label: cleanLine(file.name, 40), kind: 'pdf', candidates: [], warnings: [], note: 'Too large to read here. Type the details you need.', readBy: 'typed by the owner' }); return; }
    status.textContent = 'Reading the file on this device\u2026';
    try {
      const buffer = await file.arrayBuffer(); const sha256 = await sha256Hex(buffer); const read = await extractPdfText(new Uint8Array(buffer));
      const label = cleanLine(file.name, 40) || 'PDF';
      if (!read.ok) { addSource({ label, kind: 'pdf', sha256, candidates: [], warnings: [], note: read.message, readBy: 'typed by the owner' }); status.textContent = 'Could not read that file. You can type the details instead.'; return; }
      addSource({ label, kind: 'pdf', sha256, candidates: findCandidates(read.text, { id: label, label, kind: 'pdf' }), warnings: [...textWarnings(read.text), ...read.warnings], note: 'Read on this device by fixed patterns. A fingerprint of the file is kept; the file is not.', readBy: 'fixed patterns on this device' });
      status.textContent = 'Read. Review what was found.';
    } catch { status.textContent = 'That file could not be read. You can type the details instead.'; }
  });
  const addText = button('Add this text', () => {
    const text = paste.value.slice(0, 8000); if (!text.trim()) { status.textContent = 'Paste some text first.'; return; }
    if (sources.size >= MAX_SOURCES) { status.textContent = `You can add up to ${MAX_SOURCES} sources. Remove one first.`; return; }
    const label = `Pasted message ${counter + 1}`; paste.value = '';
    addSource({ label, kind: 'text', candidates: findCandidates(text, { id: label, label, kind: 'text' }), warnings: textWarnings(text), note: 'Read on this device by fixed patterns. The pasted text itself is not kept.', readBy: 'fixed patterns on this device' });
    status.textContent = 'Added. Review what was found.';
  }, 'button secondary');

  box.append(element('label', 'Proof of payment or invoice (PDF)', { for: 'ev-file' }));
  fileInput.id = 'ev-file'; box.append(fileInput, pasteLabel, paste, addText, status, list, result);
  return box;
}
