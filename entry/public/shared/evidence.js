// Evidence Assist, local part: find CANDIDATE facts in text the person selected (a PDF's extracted text, a pasted email or SMS),
// keep where each one came from, and compare what different sources say. Fixed patterns only: no AI, no network, nothing uploaded.
//
// Rules this module keeps:
//  - Everything read from a document is untrusted text. It is searched with fixed patterns and shown. Instructions inside it
//    ("ignore the above", "pay today") do nothing; pressure wording is only REPORTED as a warning sign.
//  - A candidate is a suggestion. Nothing enters a record until the person has looked at it (see reviewFacts).
//  - Agreement between documents does not prove they are genuine: a forger can make documents agree. The wording says so.
//  - Full account numbers are held in memory for comparison only; anything displayed or stored shows the last four digits.
import { cleanLine, isPlainObject } from './text.js';
import { maskAccount } from './baseline.js';

export const FIELDS = Object.freeze({ amount: 'Amount', account: 'Account number', branch: 'Branch code', holder: 'Account holder', bank: 'Bank', reference: 'Reference', invoice: 'Invoice number', date: 'Date' });
export const MAX_CANDIDATES_PER_FIELD = 4;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PRESSURE = /\b(urgent(ly)?|immediately|asap|today only|right now|final notice|don'?t (call|phone)|do not (call|phone)|keep (this|it) (confidential|secret|quiet)|ignore (all |the )?(previous|above|prior) (instructions|messages?)|new (bank )?account|only (email|reply|message))\b/i;

// "R 70 000,00", "R70,000.00", "ZAR 1500" -> "70000.00"
export function normalizeAmount(text) {
  const raw = String(text).replace(/[\s\u00a0]/g, '').replace(/^(ZAR|R)(?=\d)/i, '');
  const m = raw.match(/^(\d[\d.,]*)$/); if (!m) return '';
  const body = m[1]; const last = Math.max(body.lastIndexOf(','), body.lastIndexOf('.'));
  let whole = body; let cents = '00';
  if (last >= 0 && body.length - last - 1 === 2) { whole = body.slice(0, last); cents = body.slice(last + 1); }
  whole = whole.replace(/[.,]/g, '');
  if (!/^\d{1,12}$/.test(whole)) return '';
  return `${Number(whole)}.${cents}`;
}
export function normalizeDate(text) {
  const t = String(text).trim(); let y; let mo; let d; let m;
  if ((m = t.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})$/))) [d, mo, y] = [+m[1], +m[2], +m[3]];
  else if ((m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2})$/))) { d = +m[1]; mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; y = +m[3]; }
  else return '';
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCMonth() !== mo - 1) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const normalizeText = (v) => String(v).toLowerCase().replace(/\b(pty|ltd|limited|cc|inc|proprietary)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const FIELD_NORMALIZE = {
  amount: normalizeAmount, date: normalizeDate, account: (v) => String(v).replace(/[\s-]/g, ''), branch: (v) => String(v).replace(/[\s-]/g, ''),
  holder: normalizeText, bank: normalizeText, reference: (v) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, ''), invoice: (v) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, ''),
};
export const normalizeField = (field, value) => (FIELD_NORMALIZE[field] ? FIELD_NORMALIZE[field](value) : '');
const display = (field, value) => (field === 'account' ? maskAccount(value) : cleanLine(value, 60));

const PATTERNS = [
  ['amount', /(?:\bR|\bZAR)\s?(\d{1,3}(?:[ \u00a0,.]\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)/gi],
  ['account', /\b(?:account|acc|acct|a\/c)\b(?:\s*(?:number|no\.?|nr\.?|#))?\s*[:\-]?\s*((?:\d[ -]?){6,20})/gi],
  ['branch', /\b(?:branch(?:\s*code)?|universal\s*branch\s*code)\s*[:\-]?\s*(\d{4,8})\b/gi],
  ['holder', /\b(?:account\s*holder|account\s*name|beneficiary(?:\s*name)?|payee|name\s*of\s*account)\s*[:\-]\s*([^\n\r|;]{2,60})/gi],
  ['bank', /\bbank(?:\s*name)?\s*[:\-]\s*([A-Za-z][A-Za-z &.()]{1,40})/gi],
  ['reference', /\b(?:payment\s*reference|reference|ref\.?)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\/ ]{1,29})/gi],
  ['invoice', /\binvoice(?:\s*(?:no\.?|number|nr\.?|#))?\s*[:\-#]?\s*((?=[A-Za-z0-9\-\/]*\d)[A-Za-z0-9][A-Za-z0-9\-\/]{2,24})/gi],
  ['date', /\b(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+20\d{2})\b/gi],
];

// Long digit runs (account numbers) are masked even in the snippet, so a full number is never shown a second time or carried anywhere.
const snippetAround = (text, index, length) => cleanLine(text.slice(Math.max(0, index - 20), index + length + 20), 80).replace(/\d{8,}/g, (run) => `\u2022\u2022\u2022\u2022${run.slice(-4)}`);

// source: { id, label, kind }. Returns candidates with a source reference (offset and a short snippet). Nothing is chosen for the person.
export function findCandidates(text, source) {
  const body = typeof text === 'string' ? text.slice(0, 100_000) : '';
  const out = []; const seen = new Set();
  for (const [field, re] of PATTERNS) {
    let count = 0;
    for (const m of body.matchAll(re)) {
      const raw = cleanLine(m[1], 60).replace(/\s{2,}.*$/, '').trim(); const value = normalizeField(field, raw);
      if (!value || (field === 'invoice' && /^(date|no|number)$/i.test(raw))) continue;
      const key = `${field}:${value}`; if (seen.has(key)) continue; seen.add(key);
      out.push({ field, value: field === 'account' || field === 'branch' || field === 'amount' || field === 'date' ? value : raw, key: value, shown: display(field, field === 'account' ? value : raw), source: { id: source.id, label: cleanLine(source.label, 50), kind: source.kind }, at: m.index, snippet: snippetAround(body, m.index, m[0].length) });
      if (++count >= MAX_CANDIDATES_PER_FIELD) break;
    }
  }
  return out;
}

// Warning signs in the TEXT of a source. Reported, never obeyed.
export function textWarnings(text) {
  const found = []; const body = String(text ?? '');
  const m = body.match(PRESSURE); if (m) found.push(`The text contains pressure or instruction wording ("${cleanLine(m[0], 40)}"). Mgadi does not follow instructions found in documents.`);
  if (/\bchanged?\b[\s\S]{0,60}\b(bank|banking|account)\b|\b(bank|banking|account)\b[\s\S]{0,60}\bchanged?\b/i.test(body)) found.push('The text mentions changed banking details.');
  return found;
}

// factsBySource: { [sourceId]: { label, kind, facts: { field: value } } } where each value is what the PERSON confirmed.
// Result: per field, whether sources agree, conflict, or only one says something.
export function compareSources(factsBySource) {
  const ids = Object.keys(factsBySource); const rows = [];
  for (const field of Object.keys(FIELDS)) {
    const groups = new Map();
    for (const id of ids) {
      const raw = factsBySource[id]?.facts?.[field]; if (!raw) continue;
      const key = normalizeField(field, raw); if (!key) continue;
      const g = groups.get(key) ?? { shown: display(field, raw), sources: [] }; g.sources.push({ id, label: cleanLine(factsBySource[id].label, 50) }); groups.set(key, g);
    }
    if (!groups.size) continue;
    const values = [...groups.values()];
    const status = values.length > 1 ? 'conflict' : values[0].sources.length > 1 ? 'agree' : 'single';
    rows.push({ field, label: FIELDS[field], status, values: values.map((g) => ({ shown: g.shown, sources: g.sources })) });
  }
  const missing = ['account', 'amount', 'reference', 'date'].filter((f) => !rows.some((r) => r.field === f));
  return { rows, missing: missing.map((f) => FIELDS[f]) };
}
export const STATUS_TEXT = Object.freeze({ agree: 'Sources agree', conflict: 'Sources DISAGREE', single: 'Only one source says this' });
export const AGREEMENT_NOTE = 'Agreement between documents does not prove they are genuine, and a disagreement is a reason to stop and check, not a verdict. Mgadi has not contacted anyone.';

// What may be kept in a record or sent in a link: the facts the person reviewed, short, masked, with their source labels. No file bytes.
export function normalizeEvidenceSummary(input) {
  if (!isPlainObject(input) || !Array.isArray(input.facts)) return null;
  const facts = [];
  for (const f of input.facts.slice(0, 12)) {
    if (!isPlainObject(f) || typeof f.field !== 'string' || !Object.hasOwn(FIELDS, f.field)) continue;
    const value = f.field === 'account' ? maskAccount(cleanLine(f.value, 40)) : cleanLine(f.value, 50); if (!value) continue;
    facts.push({ field: f.field, label: FIELDS[f.field], value, source: cleanLine(f.source, 40) });
  }
  const files = Array.isArray(input.files) ? input.files.slice(0, 3).filter(isPlainObject).map((x) => ({ label: cleanLine(x.label, 40), sha256: typeof x.sha256 === 'string' && /^[0-9a-f]{64}$/.test(x.sha256) ? x.sha256 : '' })) : [];
  const conflicts = Array.isArray(input.conflicts) ? input.conflicts.slice(0, 8).map((c) => cleanLine(c, 40)).filter(Boolean) : [];
  if (!facts.length && !files.length) return null;
  return { facts, files, conflicts, note: 'Facts the owner reviewed. Extracted by fixed patterns on the owner\'s device; Mgadi has not checked any of them.' };
}

// Turn what the person reviewed into the summary above. confirmed: { [sourceId]: { label, kind, facts, sha256? } }
// fullComparison (optional): the comparison that also includes the trusted details and the request, so disagreements with them are recorded too.
export function reviewFacts(confirmed, fullComparison = null) {
  const comparison = fullComparison ?? compareSources(confirmed);
  const facts = []; const files = [];
  for (const id of Object.keys(confirmed)) {
    const s = confirmed[id];
    for (const [field, value] of Object.entries(s.facts ?? {})) if (value && Object.hasOwn(FIELDS, field)) facts.push({ field, value: field === 'account' ? maskAccount(value) : value, source: s.label });
    if (s.sha256) files.push({ label: s.label, sha256: s.sha256 });
  }
  return { summary: normalizeEvidenceSummary({ facts, files, conflicts: comparison.rows.filter((r) => r.status === 'conflict').map((r) => r.label) }), comparison };
}
