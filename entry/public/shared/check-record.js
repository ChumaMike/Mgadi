// The supplier-check payload as it travels in a sealed link and sits in the audit record: the request, the owner's reported
// verification, and (optionally) the comparison with trusted details and the evidence the owner reviewed. Every part is re-cleaned
// on the way in, so a link someone else made cannot carry anything outside this shape. Full account numbers never appear here.
import { normalizeCheckPayload } from './supplier-check.js';
import { normalizeComparison } from './baseline.js';
import { normalizeEvidenceSummary } from './evidence.js';

export function normalizeFullPayload(input) {
  const base = normalizeCheckPayload(input);
  if (!base) return null;
  const comparison = normalizeComparison(input.comparison); const evidence = normalizeEvidenceSummary(input.evidence);
  return { ...base, ...(comparison ? { comparison } : {}), ...(evidence ? { evidence } : {}) };
}
