/**
 * Minimal database abstraction. Production uses node-postgres against the
 * Supabase connection string (server-only). Tests inject another executor that
 * talks to a real PostgreSQL via psql, so the SAME SQL is exercised.
 *
 * Convention: every statement either is a SELECT or ends with RETURNING,
 * and numeric columns are cast to float8 in SELECT lists.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

let pool: Db | null = null;

export async function getDb(): Promise<Db> {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new ConfigError('DATABASE_URL belum diatur. Lihat README → Supabase.');
  const pg = await import('pg');
  const p = new pg.default.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    ssl: url.includes('localhost') || url.includes('127.0.0.1') ? undefined : { rejectUnauthorized: false },
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  pool = {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await p.query(sql, params as unknown[]);
      return r.rows as T[];
    },
  };
  return pool;
}

/** For tests only. */
export function setDb(db: Db | null) { pool = db; }

export class ConfigError extends Error {}
export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

// ---- value normalizers (pg returns Date/strings; JSON executors return ISO/numbers) ----
export function toMs(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function iso(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}
