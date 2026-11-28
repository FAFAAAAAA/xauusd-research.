import { ROOM_ALPHABET, ROOM_ID_LENGTH } from '../../shared/protocol';

/** Uniform pick from an alphabet (rejection sampling, no modulo bias). */
function randomFrom(alphabet: string, length: number): string {
  const out: string[] = [];
  const limit = 256 - (256 % alphabet.length);
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit) out.push(alphabet[b % alphabet.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

export const newRoomId = () => randomFrom(ROOM_ALPHABET, ROOM_ID_LENGTH);
export const newPin = () => randomFrom('0123456789', 6);

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare two equal-length hex strings without an early exit. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
