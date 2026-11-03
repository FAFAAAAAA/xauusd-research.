'use client';
// Browser-side helpers. Never import server modules here.
import { formatInTz } from '@/lib/core/time';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

const cache = new Map<string, unknown>();
let cacheEpoch = 0;
const pending = new Map<string, { epoch: number; request: Promise<unknown> }>();
/** Last successful GET response for `url` (shown instantly while fresh data loads). */
export function peek<T>(url: string): T | null {
  return (cache.get(url) as T) ?? null;
}

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
  if (isGet) { if (epoch === cacheEpoch) cache.set(url, body.data); }
  else { cacheEpoch++; cache.clear(); } // a write may change any view
  return body.data as T;
}

export function fmt(ms: number | null | undefined, tz: string, seconds = false) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return formatInTz(ms, tz, seconds);
}
export function tzShort(tz: string) {
  return tz === 'America/New_York' ? 'New York' : tz === 'Asia/Seoul' ? 'Seoul' : 'UTC';
}
export const px = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : n == null ? '—' : String(n));
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
