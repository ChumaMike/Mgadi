// Export a spreadsheet for a native-speaker translator or reviewer.
//   node scripts/translation-export.mjs <code> [--out file.csv]      e.g. node scripts/translation-export.mjs st --out mgadi-sesotho.csv
// One row per English string in Mgadi, with the part of the app it belongs to, how much it matters, the draft that exists today (if any)
// and empty columns for the reviewer's decision. Rows built at run time are marked "pattern": the reviewer needs to see the
// placeholder (${...}) and translate around it. This tool changes nothing in Mgadi: approved text is added to catalog.js by a person,
// in a reviewed pull request, together with the reviewer's name, date and scope in translations/REVIEW-STATUS.json.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catalog, languages } from '../public/accessibility/catalog.js';
import { surfaces, isTranslated, LANGS } from './translation-coverage.mjs';

// How much a wrong translation could hurt. Money and safety instructions come first.
export const PRIORITY = {
  'Payment-diversion guide': 'critical: money and safety',
  'Bank directory and step screens': 'critical: money and safety',
  'Emergency entry screens (choices, money question, one quick question)': 'critical: money and safety',
  'Supplier check, responder handoff and POPIA draft (screens and the texts they build)': 'critical: money, consent and privacy',
  'Voice panel: controls, consent and conversation states': 'high: consent',
  'Hacked-mailbox guide': 'high: safety',
  'Suspicious-message guide': 'high: safety',
  'Ransomware guide (steps, organisation note, trusted resources)': 'high: safety',
};
const csv = (value) => `"${String(value ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

export function exportRows(code) {
  if (!LANGS.includes(code)) throw new Error(`Unknown language code "${code}". Use one of: ${LANGS.join(', ')}.`);
  const rows = []; let id = 0;
  for (const [part, { strings, dynamic }] of surfaces) {
    const priority = PRIORITY[part] ?? 'normal';
    for (const english of strings) {
      const draft = isTranslated(english, code) ? catalog[code][english] : '';
      rows.push({ id: (id += 1), part, priority, kind: 'text', english, draft, status: draft ? 'unreviewed draft' : 'not translated' });
    }
    for (const english of dynamic) rows.push({ id: (id += 1), part, priority, kind: 'pattern (built at run time)', english, draft: '', status: 'not translated' });
  }
  const order = (r) => (r.priority.startsWith('critical') ? 0 : r.priority.startsWith('high') ? 1 : 2);
  return rows.sort((a, b) => order(a) - order(b) || a.id - b.id);
}

export function renderCsv(code) {
  const header = ['id', 'part of Mgadi', 'priority', 'kind', 'English (source)', `${languages[code]}: current draft`, 'status', 'reviewer: approve / change / reject', 'reviewer: corrected text', 'reviewer: notes'];
  const lines = exportRows(code).map((r) => [r.id, r.part, r.priority, r.kind, r.english, r.draft, r.status, '', '', ''].map(csv).join(','));
  return `\uFEFF${[header.map(csv).join(','), ...lines].join('\r\n')}\r\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const code = process.argv[2];
  try {
    const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
    const text = renderCsv(code);
    if (out) { fs.writeFileSync(out, text); console.log(`Wrote ${out}: ${exportRows(code).length} rows for ${languages[code]}.`); } else process.stdout.write(text);
  } catch (error) { console.error(error.message); process.exit(1); }
}
