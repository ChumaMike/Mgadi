// Builds the incident pack and its human-readable summary.
// Privacy-first: by default the pack carries the MASKED description. The owner's original words,
// the business name and the amount are included only when the owner chooses, after seeing a preview.
// Evidence file bytes are never included, only name, size, type and SHA-256 fingerprint.
export const PACK_FORMAT = 'mgadi-incident-pack/2';
export const PACK_WARNING = 'A matching fingerprint detects changes after capture. It does not prove a file is genuine, and it is not a digital signature.';

const SOURCE_TEXT = {
  ai: 'automatic suggestion from the Mgadi server',
  rules: 'automatic suggestion from Mgadi\'s rules',
  'offline rules': 'automatic suggestion from the rules on this phone',
  'user-selected route': 'chosen by the owner',
};

export function defaultPackOptions(state) {
  return { includeOriginal: false, includeBusiness: Boolean(clean(state.business)), includeAmount: Boolean(clean(state.amount)) };
}

function clean(value) { return String(value ?? '').trim(); }

export function storyFor(state, options) {
  const original = clean(state.description);
  const masked = clean(state.redacted?.text);
  if (options.includeOriginal && original) return { version: 'original', text: original };
  if (masked) return { version: 'masked', text: masked };
  return { version: 'none', text: '' };
}

export function bankStatus(state) {
  return state.bankReportedAt
    ? { status: 'user-reported-called', reportedAt: state.bankReportedAt, note: 'Reported by the owner. Mgadi cannot confirm that the bank answered or acted.' }
    : { status: 'not-reported', reportedAt: null, note: 'The owner has not reported calling the bank in Mgadi.' };
}

export function buildPackData(state, options = defaultPackOptions(state), generatedAt = new Date().toISOString()) {
  const story = storyFor(state, options);
  const data = {
    format: PACK_FORMAT,
    generatedAt,
    story,
    maskedItemCounts: state.redacted?.counts ?? {},
    incident: {
      label: state.triage?.label ?? null,
      confidence: state.triage?.confidence ?? null,
      source: state.source ?? null,
      title: state.title ?? null,
      owner_answer: state.ownerAnswer ?? null,
    },
    bank: bankStatus(state),
    guide: { reviewedByPractitioner: Boolean(state.guideReviewed), note: state.guideReviewed ? 'Reviewed.' : 'Draft guidance; practitioner review pending.' },
    timeline: state.timeline ?? [],
    evidence: state.evidence ?? [],
    warning: PACK_WARNING,
  };
  if (options.includeBusiness && clean(state.business)) data.business = clean(state.business);
  if (options.includeAmount && clean(state.amount)) data.amount = clean(state.amount);
  return data;
}

// What the owner will be told is inside the pack, shown before it is made.
export function previewItems(state, options) {
  const story = storyFor(state, options);
  const items = [];
  items.push({ id: 'story', label: story.version === 'original' ? 'Your own words, exactly as typed' : story.version === 'masked' ? 'Your description with personal details hidden' : 'Description', value: story.text || 'Nothing typed: the situation was chosen from the buttons.' });
  items.push({ id: 'business', label: 'Business name', value: options.includeBusiness && clean(state.business) ? clean(state.business) : 'Not included' });
  items.push({ id: 'amount', label: 'Amount paid', value: options.includeAmount && clean(state.amount) ? clean(state.amount) : 'Not included' });
  items.push({ id: 'evidence', label: 'Evidence', value: `${(state.evidence ?? []).length} file fingerprint(s): name, size and SHA-256 only. The files themselves are not included.` });
  items.push({ id: 'timeline', label: 'Timeline', value: `${(state.timeline ?? []).length} entries with times` });
  return items;
}

export function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso ?? '');
  try { return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(date); }
  catch { return date.toISOString(); }
}

export function formatBytes(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n < 0) return 'unknown size';
  if (n < 1024) return `${n} bytes`;
  return n < 1048576 ? `${(n / 1024).toFixed(1).replace('.', ',')} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;
}

// Plain-language sections for the on-screen and printed summary. All values are plain strings:
// the UI must insert them with textContent.
export function summarySections(pack) {
  const sections = [];
  const sourceText = SOURCE_TEXT[pack.incident?.source] ?? 'automatic suggestion';
  sections.push({ heading: 'What happened', lines: [
    pack.story?.text ? pack.story.text : 'No description was typed. The situation was chosen from the buttons.',
    pack.story?.version === 'masked' ? 'Personal details such as numbers, links and listed names were hidden before this was written. Names that were not listed may still appear.' : pack.story?.version === 'original' ? 'These are the owner\'s own words and may contain names or numbers.' : '',
  ].filter(Boolean) });
  sections.push({ heading: 'Situation suggested by Mgadi', lines: [
    `${pack.incident?.title ?? 'Not set'} (${sourceText}). This is a first-step guide, not a finding.`,
    ...(pack.incident?.owner_answer ? [`The owner answered the clarifying question: ${pack.incident.owner_answer}`] : []),
  ] });
  sections.push({ heading: 'Bank', lines: [pack.bank?.status === 'user-reported-called' ? `The owner reported calling the bank at ${formatTime(pack.bank.reportedAt)}. ${pack.bank.note}` : pack.bank?.note ?? 'Not recorded.'] });
  if (pack.business || pack.amount) sections.push({ heading: 'Details chosen by the owner', lines: [pack.business ? `Business: ${pack.business}` : '', pack.amount ? `Amount paid: ${pack.amount}` : ''].filter(Boolean) });
  sections.push({ heading: 'Timeline', lines: (pack.timeline ?? []).map((entry) => `${formatTime(entry.at)}: ${entry.text}`) });
  sections.push({ heading: 'Evidence fingerprints', lines: (pack.evidence ?? []).length
    ? pack.evidence.map((file) => `${file.name} (${formatBytes(file.size)}, ${file.type}) SHA-256 ${file.sha256}`)
    : ['No evidence files were fingerprinted. Keep the original messages and proof of payment.'] });
  sections.push({ heading: 'Please note', lines: [pack.guide?.note ?? '', 'Evidence files are not part of this pack; only their fingerprints are.', PACK_WARNING].filter(Boolean) });
  return sections;
}
