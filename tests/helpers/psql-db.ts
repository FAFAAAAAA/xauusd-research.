// Test-only Db executor: runs the application's real SQL against a real PostgreSQL
// through the `psql` CLI (used where the `pg` npm driver is unavailable).
// Each query is PREPAREd so parameter types are inferred exactly like node-postgres does.
import { spawnSync } from 'node:child_process';
import type { Db } from '../../src/lib/server/db';

function lit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return lit(v.toISOString());
  if (Array.isArray(v)) {
    const inner = v.map((x) => (x === null || x === undefined ? 'NULL' : `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)).join(',');
    return lit(`{${inner}}`);
  }
  if (typeof v === 'object') return lit(JSON.stringify(v));
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function psqlDb(conn: { host: string; port: number; db: string; user: string }): Db & { exec(sql: string): string } {
  const run = (sql: string) => {
    const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', conn.host, '-p', String(conn.port), '-U', conn.user, '-d', conn.db],
      { input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`psql error: ${r.stderr.trim()}\nSQL: ${sql.slice(0, 600)}`);
    return r.stdout;
  };
  let n = 0;
  return {
    exec: run,
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const name = `q${++n}`;
      const body = `PREPARE ${name} AS WITH __t AS (${sql}) SELECT coalesce(json_agg(__t), '[]'::json) FROM __t;\n` +
        `EXECUTE ${name}${params.length ? `(${params.map(lit).join(', ')})` : ''};\nDEALLOCATE ${name};\n`;
      const out = run(body).trim();
      return JSON.parse(out || '[]') as T[];
    },
  };
}
