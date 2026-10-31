'use client';
// Browser-side helpers. Never import server modules here.
import { formatInTz } from '@/lib/core/time';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
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
