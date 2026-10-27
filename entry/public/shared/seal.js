// Sealed links. Used by the supplier payment-change check and the responder handoff.
//
// The browser encrypts what it wants to share (AES-GCM, a fresh 256-bit key) and puts that key ONLY in the link's #fragment,
// which a browser never sends to any server. Mgadi's server stores the ciphertext, a status, timestamps and HASHES of two random
// tokens. It cannot read the content, and it never sees a raw token until the person using the link presents it.
//
// What this does NOT give: it cannot tell who is holding a link (no accounts), it cannot stop someone forwarding a link, and the
// server still delivers the page that does the encrypting, so a compromised server could serve a changed page.
import { sha256Hex } from './sha256.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
export const MAX_PLAINTEXT_BYTES = 4000;
export const ID_CHARS = 16; // 12 random bytes
export const TOKEN_CHARS = 22; // 16 random bytes
export const KEY_CHARS = 43; // 32 random bytes

export const b64u = {
  encode(bytes) {
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  },
};

const random = (bytes) => b64u.encode(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
export const randomId = () => random(12);
export const randomToken = () => random(16);
export const newKey = () => random(32);
export const tokenHash = (token) => sha256Hex(enc.encode(String(token)));

const BAD_LINK = 'This link is damaged or incomplete. Ask the sender for a new one.';
async function importKey(keyText, usage) {
  let raw; try { raw = b64u.decode(keyText); } catch { throw new Error(BAD_LINK); }
  if (raw.length !== 32) throw new Error(BAD_LINK);
  return globalThis.crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}
// The ciphertext is bound to its record: moving it to another id, kind or slot makes decryption fail.
const aad = ({ kind, id, part }) => enc.encode(`mgadi-link/1|${kind}|${id}|${part}`);

export async function seal(value, { key, kind, id, part = 'body' }) {
  const json = JSON.stringify(value);
  if (enc.encode(json).length > MAX_PLAINTEXT_BYTES) throw new Error('That is too long to share. Shorten it and try again.');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad({ kind, id, part }) }, await importKey(key, 'encrypt'), enc.encode(json));
  return { ct: b64u.encode(new Uint8Array(ciphertext)), iv: b64u.encode(iv) };
}

export async function open({ ct, iv }, { key, kind, id, part = 'body' }) {
  try {
    const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.decode(iv), additionalData: aad({ kind, id, part }) }, await importKey(key, 'decrypt'), b64u.decode(ct));
    return JSON.parse(dec.decode(plain));
  } catch { throw new Error(BAD_LINK); }
}

// #mgadi=1.<role>.<id>.<token>.<key>   role: o = the person who made it, c = the person it was made for.
const LINK = new RegExp(`^#mgadi=1\\.([oc])\\.([A-Za-z0-9_-]{${ID_CHARS}})\\.([A-Za-z0-9_-]{${TOKEN_CHARS}})\\.([A-Za-z0-9_-]{${KEY_CHARS}})$`);
export const buildLink = (origin, role, id, token, key) => `${origin}/#mgadi=1.${role}.${id}.${token}.${key}`;
export function parseLink(hash) {
  const match = LINK.exec(String(hash ?? ''));
  return match ? { role: match[1], id: match[2], token: match[3], key: match[4] } : null;
}
