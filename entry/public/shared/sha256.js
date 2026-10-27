// Evidence is fingerprinted in the browser. File bytes are never sent to Mgadi.
export async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot fingerprint files here. Open Mgadi on HTTPS or localhost.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
