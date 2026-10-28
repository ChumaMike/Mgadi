// Translation coverage report: how much of Mgadi really exists in each of the ten non-English interface languages, with reviewer status.
//   node scripts/translation-coverage.mjs           prints the report
//   node scripts/translation-coverage.mjs --write   regenerates TRANSLATION-COVERAGE.md (a test fails if it is stale)
// HOW IT COUNTS. The only translation mechanism is the catalog (public/accessibility/catalog.js), keyed by the exact English
// text. A string counts as translated only if the catalog has an entry for it AND the entry differs from the English.
// Guidance strings come straight from the data files, so they are exact. Interface strings come from a static scan of the
// literals passed to the translation-aware helpers, so those counts are close but not a proof: a string built at run time
// (a template with ${...}) is listed as DYNAMIC and counted as untranslated. It never counts a draft as reviewed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, languages, translationState } from '../public/accessibility/catalog.js';
import { languageCodes } from '../public/accessibility/languages.js';
import { PROVIDER_LANGUAGES } from '../server/voice.js';
import { FAILURE_COPY } from '../public/voice/controller.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const playbook = JSON.parse(read('public/data/playbook.json'));
const resources = JSON.parse(read('public/data/resources.json'));
export const LANGS = languageCodes.filter((code) => code !== 'en');
export const reviewStatus = JSON.parse(read('translations/REVIEW-STATUS.json'));

const SKIP_KEYS = new Set(['id', 'route', 'next', 'reviewed', 'url', 'audience', 'allowedHosts', 'checkedOn', 'reviewNote']);
function collect(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (!SKIP_KEYS.has(k)) collect(v, out);
  return out;
}
function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  if (start < 0) return '';
  const open = source.indexOf('{', source.indexOf(')', start)); let depth = 0;
  for (let i = open; i < source.length; i += 1) { if (source[i] === '{') depth += 1; else if (source[i] === '}') { depth -= 1; if (!depth) return source.slice(start, i + 1); } }
  return source.slice(start);
}
const STR = String.raw`((?:[^'\\]|\\.)+)`;
const PATTERNS = [
  new RegExp(String.raw`element\('[a-z0-9]+',\s*'${STR}'`, 'g'), new RegExp(String.raw`button\('${STR}'`, 'g'),
  new RegExp(String.raw`\btr\('[a-z0-9]+',\s*(?:null|'[^']*'),\s*'${STR}'`, 'g'), new RegExp(String.raw`bindText\([^,]+,\s*'${STR}'`, 'g'),
  new RegExp(String.raw`\bel\('[a-z0-9]+',\s*'${STR}'`, 'g'), new RegExp(String.raw`\btoggle\('[^']+',\s*'${STR}'`, 'g'),
  new RegExp(String.raw`(?:heading|label):\s*'${STR}'`, 'g'),
];
const TEMPLATE = /(?:element|plain|button|tr)\([^`\n]{0,60}`((?:[^`\\]|\\.)*\$\{(?:[^`\\]|\\.)*)`/g;
function scan(source) {
  const strings = new Set(); const dynamic = new Set();
  for (const pattern of PATTERNS) for (const m of source.matchAll(pattern)) { const text = m[1].replace(/\\'/g, "'"); if (text.length >= 3 && !text.includes('${')) strings.add(text); }
  for (const m of source.matchAll(TEMPLATE)) dynamic.add(m[1]);
  return { strings: [...strings], dynamic: [...dynamic] };
}
// The new tools build much of their text in shared modules and often use double quotes, which the screen patterns above do not see.
// For those files every sentence-like literal counts: three or more words, starting with a capital. A literal with ${...} is dynamic.
function scanSentences(source) {
  const strings = new Set(); const dynamic = new Set();
  for (const m of source.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){12,})\1/g)) {
    const text = m[2].replace(/\\'/g, "'");
    if (!/^[A-Z0-9"“]/.test(text) || (text.match(/ /g) ?? []).length < 2) continue;
    (text.includes('${') ? dynamic : strings).add(text);
  }
  return { strings: [...strings], dynamic: [...dynamic] };
}
const app = read('public/app.js'); const panel = read('public/voice/panel.js'); const controller = read('public/voice/controller.js');
const access = read('public/accessibility/accessibility.js'); const summary = read('public/shared/summary.js'); const offline = read('public/offline/register.js');
const tools = read('public/tools/tools.js');
const fromFunctions = (source, names) => names.reduce((acc, name) => { const s = scan(functionBody(source, name)); acc.strings.push(...s.strings); acc.dynamic.push(...s.dynamic); return acc; }, { strings: [], dynamic: [] });
const merge = (...parts) => ({ strings: [...new Set(parts.flatMap((p) => p.strings ?? p))], dynamic: [...new Set(parts.flatMap((p) => p.dynamic ?? []))] });
const fromData = (value) => ({ strings: [...new Set(collect(value))], dynamic: [] });

// Offline-status messages are built by describe(): fixed sentences with dates and counts, so they are DYNAMIC by nature.
const offlineSentences = [...offline.matchAll(/return `[^`]*`/g)].map((m) => m[0]);
const controllerNotes = [...controller.matchAll(/note\('([^']{6,})'\)/g)].map((m) => m[1]);
const inc = (id) => playbook.incidents[id];
export const surfaces = [
  ['Emergency entry screens (choices, money question, one quick question)', merge(fromData([playbook.entry, playbook.clarify]), fromFunctions(app, ['showHome', 'showPaymentChoice', 'showClarify']))],
  ['Payment-diversion guide', fromData(inc('payment_diversion'))],
  ['Hacked-mailbox guide', fromData(inc('mailbox_compromise'))],
  ['Suspicious-message guide', fromData(inc('suspicious_message'))],
  ['Not-a-cyber-incident and unsure guides', fromData([inc('not_cyber'), inc('unsure')])],
  ['Ransomware guide (steps, organisation note, trusted resources)', merge(fromData([inc('ransomware_suspected'), resources.note, resources.routes.ransomware_suspected]), fromFunctions(app, ['resourceLinks', 'reviewBadge']))],
  ['Bank directory and step screens', fromFunctions(app, ['showBankLines', 'renderStep', 'triage'])],
  ['Voice panel: controls, consent and conversation states', merge(scan(panel), fromData(controllerNotes))],
  ['Errors and connectivity notices', merge(fromData(Object.values(FAILURE_COPY)), { strings: [], dynamic: offlineSentences })],
  ['Evidence and incident packs', merge(fromFunctions(app, ['showEvidencePack', 'showPackReview', 'showPack']), scan(summary))],
  ['Accessibility settings and signing dialog', scan(access)],
  ['Supplier check, responder handoff and POPIA draft (screens and the texts they build)', merge(scan(tools), ...['public/tools/tools.js', 'public/shared/supplier-check.js', 'public/shared/responder.js', 'public/shared/popia.js'].map((f) => scanSentences(read(f))))],
];

export const isTranslated = (text, lang, table = catalog) => Boolean(table[lang]?.[text]) && table[lang][text] !== text;
export function computeCoverage() {
  return surfaces.map(([name, { strings, dynamic }]) => {
    const total = strings.length + dynamic.length;
    const row = { name, strings: strings.length, dynamic: dynamic.length, total };
    for (const lang of LANGS) row[lang] = strings.filter((s) => isTranslated(s, lang)).length;
    return row;
  });
}
const pct = (n, total) => (total ? `${Math.round((n / total) * 100)}%` : 'n/a');

const STATUS_LABEL = { 'not-started': 'No translation: English shown', 'unreviewed-draft': 'Unreviewed draft', 'in-review': 'In review (still a draft)', reviewed: 'Reviewed (see scope)' };
const reviewerText = (code) => { const r = reviewStatus.languages[code]; return r.reviewers.length ? `${r.reviewers.join(', ')} (${r.reviewedOn})` : 'None recorded'; };
const voiceText = (code) => (PROVIDER_LANGUAGES[code]?.retell ? 'Provider lists it; not verified here' : 'No provider voice');

export function renderReport(rows = computeCoverage()) {
  const totalStrings = rows.reduce((n, r) => n + r.total, 0);
  const drafted = LANGS.filter((code) => translationState(code) === 'draft');
  const empty = LANGS.filter((code) => translationState(code) !== 'draft');
  const lines = [
    '# Translation coverage (generated: do not edit by hand)',
    '',
    'Regenerate with `node scripts/translation-coverage.mjs --write`. A test fails if this file is out of date.',
    '',
    '**Every translation in Mgadi is an unreviewed draft.** No language is complete. Text that is not translated stays in English and is',
    'marked `lang="en"` so screen readers pronounce it correctly. Nothing here is a claim of reviewed or complete translation.',
    '',
    '## Coverage by language',
    '',
    `Mgadi's interface lists all eleven written official languages. Strings counted: ${totalStrings} (the exact total is in the table below; strings built at run time count as untranslated).`,
    '',
    '| Language | Code | Status | Translated | Share | Reviewer | Voice |',
    '|---|---|---|---:|---:|---|---|',
    ...LANGS.map((code) => { const n = rows.reduce((sum, r) => sum + r[code], 0); return `| ${languages[code]} | \`${code}\` | ${STATUS_LABEL[reviewStatus.languages[code].status]} | ${n} of ${totalStrings} | ${pct(n, totalStrings)} | ${reviewerText(code)} | ${voiceText(code)} |`; }),
    '',
    `**Drafts exist for:** ${drafted.map((c) => languages[c]).join(', ')}. **No translation yet (English is shown, and says so):** ${empty.map((c) => languages[c]).join(', ')}.`,
    'The review record is `translations/REVIEW-STATUS.json`. A language moves to "reviewed" only when named reviewers, a date and a scope are written there.',
    '',
    `## Coverage by part of Mgadi (languages that have drafts: ${drafted.map((c) => languages[c]).join(', ')})`,
    '',
    `| Part of Mgadi | Strings | Dynamic (built at run time) | ${drafted.map((c) => languages[c]).join(' | ')} |`,
    `|---|---:|---:|${drafted.map(() => '---:').join('|')}|`,
    ...rows.map((r) => `| ${r.name} | ${r.strings} | ${r.dynamic} | ${drafted.map((c) => `${r[c]} (${pct(r[c], r.total)})`).join(' | ')} |`),
    '',
    `Catalog size: ${Object.keys(catalog.en).length} entries per drafted language (English and ${drafted.map((c) => languages[c]).join(', ')}).`,
    'Percentages are translated strings divided by strings plus dynamic strings. Dynamic strings count as untranslated.',
    '',
    '## What this means for people',
    '',
    '- Only the payment-diversion path and a few core buttons have draft translations, and only in isiZulu, isiXhosa and Afrikaans. The ransomware guide, the one quick question, the',
    '  evidence and pack screens, the voice panel and every connectivity notice appear in English in every language.',
    '- Choosing one of the seven languages with no translation keeps everything in English, says so on every screen, and keeps text, bank and step guidance working.',
    '- Free-text triage is English-first and unverified in every other language. The choices on the entry screen work in every language.',
    '- Voice: no provider voice exists for any South African language except Afrikaans, and Afrikaans voice stays blocked because its guide is incomplete.',
    '  Choosing a written language never switches on a spoken one.',
    '- Sign language (SASL) is a separate language, not a translation. No reviewed clip exists, so no signing is shown.',
    '',
    '## How the count is made, and its limits',
    '',
    '- Guidance and data strings are read directly from the data files, so they are exact.',
    '- Interface strings come from a static scan of the literals passed to the translation helpers (`element`, `button`, `tr`, `bindText`, `el`).',
    '  A string assembled at run time is listed as dynamic and counted as untranslated. A literal the scan cannot see would be missed, so',
    '  treat counts as close, not exact. The catalog lookup itself is exact: the catalog entry must exist and differ from the English.',
    '- Nothing here measures translation QUALITY. Every draft needs review by speakers of that language before it is relied on.',
    '- Adding a language or reviewing one: see `docs/TRANSLATION-REVIEW.md`.',
    '',
  ];
  return `${lines.join('\n')}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = renderReport();
  if (process.argv.includes('--write')) { fs.writeFileSync(path.join(root, 'TRANSLATION-COVERAGE.md'), report); console.log('Wrote TRANSLATION-COVERAGE.md'); }
  else console.log(report);
}
