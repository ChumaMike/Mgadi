import { canonicalJSON, sha256Hex } from './sha256.js';

export async function fingerprintPack(packWithoutFingerprint) {
  return sha256Hex(new TextEncoder().encode(canonicalJSON(packWithoutFingerprint)));
}

export async function makePack(data) {
  const fingerprint = await fingerprintPack(data);
  return { ...data, fingerprint };
}

export async function verifyPack(pack) {
  if (!pack || typeof pack !== 'object' || typeof pack.fingerprint !== 'string') return false;
  const { fingerprint, ...content } = pack;
  return (await fingerprintPack(content)) === fingerprint;
}
