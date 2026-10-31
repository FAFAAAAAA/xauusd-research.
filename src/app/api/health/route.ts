import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Classify a DB connection failure without revealing secrets. */
function reason(e: unknown): string {
  const err = e as { message?: string; code?: string };
  const m = `${err.code ?? ''} ${err.message ?? ''}`;
  if (/DATABASE_URL belum diatur/.test(m)) return 'DATABASE_URL tidak terbaca (belum diisi atau belum Redeploy)';
  if (/Invalid URL|invalid connection|URI malformed|ERR_INVALID_URL/i.test(m)) return 'Format DATABASE_URL tidak valid (cek tanda [ ], spasi, atau karakter khusus di password)';
  if (/28P01|password authentication failed/i.test(m)) return 'Password database salah';
  if (/Tenant or user not found|XX000/i.test(m)) return 'User/host tidak cocok (salin ulang URL Shared pooler)';
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return 'Host database tidak ditemukan (cek host di URL)';
  if (/ENETUNREACH|EHOSTUNREACH/i.test(m)) return 'Jaringan tidak terjangkau (kemungkinan alamat IPv6; gunakan Shared pooler)';
  if (/timeout|ETIMEDOUT/i.test(m)) return 'Koneksi timeout';
  if (/ECONNREFUSED/i.test(m)) return 'Koneksi ditolak (cek port 6543)';
  if (/certificate|SSL|self.signed/i.test(m)) return 'Masalah SSL';
  if (/Cannot find module|is not a constructor|Pool/i.test(m)) return 'Driver database gagal dimuat';
  return `Lainnya (${(err.code ?? 'unknown')})`;
}

/** Public liveness probe — reveals only up/down and a generic reason category. */
export async function GET() {
  try {
    const db = await getDb();
    await db.query('select 1 as ok');
    let schema = false;
    try { await db.query('select 1 from instruments limit 1'); schema = true; } catch { /* migration missing */ }
    return NextResponse.json({ ok: true, db: 'up', migrated: schema });
  } catch (e) {
    return NextResponse.json({ ok: false, db: 'down', reason: reason(e) }, { status: 503 });
  }
}
