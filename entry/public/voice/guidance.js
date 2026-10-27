// Builds the reviewed guidance that the voice assistant is allowed to talk about. It only ever uses the text in
// playbook.json (and its draft translations from the catalog). Nothing a user typed or said goes in here, and no phone
// number can come out: bank numbers live in fraud-lines.json and are only shown by the app.
export const VOICE_LANGUAGES = Object.freeze({ en: 'English', af: 'Afrikaans' });

export function stepTexts(step) { return [step.title, step.why, ...step.do, step.done]; }

// `translate(text, lang)` returns the catalog translation or the English source.
export function buildGuidance({ playbook, route, stepId = null, confirmed = [], lang = 'en', catalog = {} }) {
  const flow = playbook?.incidents?.[route];
  if (!flow) return null;
  const table = catalog[lang] ?? {};
  const t = (text) => (lang === 'en' ? text : table[text] ?? text);
  const translated = (text) => lang === 'en' || Boolean(table[text]);
  const steps = flow.steps.map((step) => ({
    id: step.id, title: t(step.title), why: t(step.why), do: step.do.map(t),
    status: confirmed.includes(step.id) ? 'confirmed' : 'pending',
    complete: stepTexts(step).every(translated),
  }));
  const current = steps.find((step) => step.id === stepId) ?? steps.find((step) => step.status === 'pending') ?? steps[0];
  return {
    route, title: t(flow.title), summary: t(flow.summary), steps, current,
    complete: translated(flow.title) && translated(flow.summary) && steps.every((step) => step.complete),
    reviewed: Boolean(playbook.reviewed),
  };
}

export function guidanceToText(guidance) {
  return guidance.steps.map((step, index) => `${index + 1}. ${step.title} (${step.status}). Why: ${step.why} Do: ${step.do.join(' ')}`).join('\n');
}
