'use client';
// Browser-side helpers. Never import server modules here.
import { formatInTz } from '@/lib/core/time';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

const cache = new Map<string, unknown>();
let cacheEpoch = 0;
const pending = new Map<string, { epoch: number; request: Promise<unknown> }>();
// The last GET answers are also kept in this browser (localStorage, guarded) so opening the site shows the last data at once
// while fresh data loads (9 Nov 2026: the server is in Stockholm, the owner in Korea — every request takes a while).
const LS = 'api:', LS_MAX = 400_000;
function lsGet(url: string): unknown {
  try { const v = localStorage.getItem(LS + url); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
}
// only page data is kept in the browser; trade charts / candles are large and would fill the storage (5 MB) and slow every save
const KEEP = /^\/api\/(journal|live|settings|analytics|dashboard|markets)(\?|$)/;
function lsSet(url: string, data: unknown) {
  if (!KEEP.test(url)) return;
  try { const v = JSON.stringify(data); if (v.length <= LS_MAX) localStorage.setItem(LS + url, v); } catch { /* full / blocked */ }
}
// one-time cleanup of chart answers saved by older versions
try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith(LS) && !KEEP.test(k.slice(LS.length))) localStorage.removeItem(k); } } catch { /* ignore */ }
function lsClear() {
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith(LS)) localStorage.removeItem(k); } } catch { /* ignore */ }
}
/** Last successful GET response for `url` (shown instantly while fresh data loads). */
export function peek<T>(url: string): T | null {
  if (!cache.has(url) && typeof window !== 'undefined') { const v = lsGet(url); if (v !== undefined) cache.set(url, v); }
  return (cache.get(url) as T) ?? null;
}
/** Warm the cache in the background (used after the first page shows). */
export function warm(urls: string[]) { for (const u of urls) call(u).catch(() => {}); }

/** Coalesce simultaneous reads; never reuse a read from before a write. */
export function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  if (init) return request<T>(url, init);
  const current = pending.get(url);
  if (current?.epoch === cacheEpoch) return current.request as Promise<T>;
  const entry = { epoch: cacheEpoch, request: request<T>(url) };
  pending.set(url, entry);
  const cleanup = () => { if (pending.get(url) === entry) pending.delete(url); };
  entry.request.then(cleanup, cleanup);
  return entry.request;
}

async function request<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const epoch = cacheEpoch;
  const isGet = !init?.method || init.method === 'GET';
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: 'no-store',
  }).catch(() => { throw new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi.'); });
  if (res.status === 401 && typeof window !== 'undefined' && !url.includes('/auth/')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || body.ok === false) {
    const detail = Array.isArray(body.errors) ? `: ${body.errors.join('; ')}` : '';
    throw new ApiError(res.status, (body.error ?? `HTTP ${res.status}`) + detail);
  }
  if (isGet) { if (epoch === cacheEpoch) { cache.set(url, body.data); lsSet(url, body.data); } }
  else { cacheEpoch++; cache.clear(); lsClear(); } // a write may change any view
  return body.data as T;
}

export function fmt(ms: number | null | undefined, tz: string, seconds = false) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return formatInTz(ms, tz, seconds);
}
export function tzShort(tz: string) {
  return tz === 'America/New_York' ? 'New York' : tz === 'Asia/Seoul' ? 'Seoul' : 'UTC';
}
// price: 2 decimals from 100 up (gold, indices), 4 from 1 (forex, mid coins), 5 significant digits below 1 (small coins)
export const px = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? (Math.abs(n) >= 100 ? n.toFixed(2) : Math.abs(n) >= 1 ? n.toFixed(4) : n.toPrecision(5)) : n == null ? '—' : String(n));
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
