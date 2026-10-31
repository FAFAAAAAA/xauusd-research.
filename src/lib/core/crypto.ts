// Web Crypto only → works in Node 18+ and the Edge runtime (middleware).
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64url(bytes: Uint8Array) {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function aesKey(secretB64: string): Promise<CryptoKey> {
  const raw = unb64(secretB64);
  if (raw.length !== 32) throw new Error('APP_ENCRYPTION_KEY harus 32 byte (base64)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM; output "v1.<iv>.<ciphertext>" (base64). */
export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), enc.encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(blob: string, keyB64: string): Promise<string> {
  const [v, iv, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Format secret terenkripsi tidak dikenal');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(keyB64), unb64(ct));
  return dec.decode(pt);
}

/** "123456789:AAE…xyz9" → "1234…xyz9" (never reveals the full token). */
export function maskToken(token: string): string {
  if (token.length <= 10) return '••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Session cookie: "<expiresMs>.<hmac>" signed with SESSION_SECRET. */
export async function signSession(expiresAt: number, secret: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`admin.${expiresAt}`)));
  return `${expiresAt}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined | null, secret: string, now: number): Promise<boolean> {
  if (!token || !secret) return false;
  const [exp, sig] = token.split('.');
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < now || !sig) return false;
  const expected = await signSession(expiresAt, secret);
  const a = expected.split('.')[1];
  if (a.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}
