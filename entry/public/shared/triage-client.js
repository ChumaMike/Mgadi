// Calls /api/triage with a hard time limit. Whatever goes wrong (timeout, network, bad status,
// malformed or non-schema JSON, caller pressing "skip"), the owner still gets an answer from the
// local rules. Only redacted text is ever passed in. The result is re-validated: the browser never
// trusts the server (or a provider) to return anything but {label, confidence}.
import { classifyRules } from './rules.js';
import { validateTriage } from './labels.js';

export const TRIAGE_TIMEOUT_MS = 5000;

function localAnswer(text, reason) {
  return { ...classifyRules(text), source: 'offline rules', fallbackReason: reason };
}

export async function triageWithFallback(redactedText, { fetchImpl = globalThis.fetch, timeoutMs = TRIAGE_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController();
  let timer;
  let onExternalAbort;
  const guard = new Promise((resolve) => {
    // A promise race is used as well as AbortController so a fetch that ignores the signal cannot hang the screen.
    timer = setTimeout(() => { controller.abort(); resolve(localAnswer(redactedText, 'timeout')); }, timeoutMs);
    if (signal) {
      onExternalAbort = () => { controller.abort(); resolve(localAnswer(redactedText, 'skipped')); };
      if (signal.aborted) onExternalAbort(); else signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  });
  const request = (async () => {
    try {
      const response = await fetchImpl('/api/triage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: redactedText }),
        signal: controller.signal,
      });
      if (!response.ok) return localAnswer(redactedText, 'unavailable');
      const { source, ...schema } = await response.json();
      const valid = validateTriage(schema);
      if (!valid) return localAnswer(redactedText, 'invalid-response');
      return { ...valid, source: source === 'ai' ? 'ai' : 'rules' };
    } catch {
      return localAnswer(redactedText, 'unavailable');
    }
  })();
  try { return await Promise.race([request, guard]); }
  finally { clearTimeout(timer); if (signal && onExternalAbort) signal.removeEventListener('abort', onExternalAbort); }
}
