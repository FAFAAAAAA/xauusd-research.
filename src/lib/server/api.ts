import { NextResponse } from 'next/server';
import { ConfigError, HttpError, getDb, type Db } from './db';
import { logSystemError } from './repo';

export type Handler = (db: Db) => Promise<unknown>;

/** Uniform JSON responses + error handling for route handlers. */
export async function api(fn: Handler) {
  let db: Db | null = null;
  try {
    db = await getDb();
    const data = await fn(db);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ ok: false, error: e.message, details: e.details }, { status: e.status });
    if (e instanceof ConfigError) return NextResponse.json({ ok: false, error: e.message, config: true }, { status: 503 });
    const msg = (e as Error).message ?? 'Unknown error';
    if (db) await logSystemError(db, 'api', msg, { stack: (e as Error).stack?.slice(0, 2000) });
    const offline = /ECONNREFUSED|ENOTFOUND|timeout|terminated/i.test(msg);
    return NextResponse.json({ ok: false, error: offline ? 'Database tidak dapat dihubungi' : 'Internal error' }, { status: offline ? 503 : 500 });
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, 'Body JSON tidak valid'); }
}

export function reqStr(v: unknown, name: string, max = 500): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(422, `${name} wajib diisi`);
  if (v.length > max) throw new HttpError(422, `${name} terlalu panjang`);
  return v.trim();
}
export function optStr(v: unknown, max = 2000): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > max) throw new HttpError(422, 'Nilai teks tidak valid');
  return v.trim();
}
export function reqNum(v: unknown, name: string): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(422, `${name} harus angka`);
  return n;
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function reqUuid(v: unknown, name: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(422, `${name} tidak valid`);
  return v;
}
