// Packs forexsb CSV exports (tab: "YYYY-MM-DD HH:MM  open high low close volume", UTC) into compact gz binaries.
// Layout (little endian): int32 n | int32 minutesSinceEpoch[n] | float32 ohlc[4n]. Writes data/market/<SYMBOL>_<TF>.bin.gz + manifest.json.
// Usage: node scripts/pack-market-data.mjs <dir-with-csv> ...
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, basename } from 'node:path';
const out = 'data/market';
const manifestPath = join(out, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
for (const dir of process.argv.slice(2)) {
  for (const f of readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.csv'))) {
    const m = /([A-Z0-9]+?)(15|30)\.csv$/i.exec(basename(f).replace(/^[0-9a-f]{8}-/, ''));
    if (!m) { console.log('skip', f); continue; }
    const symbol = m[1].toUpperCase(), tf = m[2] === '15' ? 'M15' : 'M30';
    const rows = readFileSync(join(dir, f), 'utf8').split(/\r?\n/).filter(Boolean);
    const t = [], p = [];
    let last = -Infinity, bad = 0;
    for (const ln of rows) {
      const [ts, o, h, l, c] = ln.split('\t');
      const ms = Date.parse(ts.replace(' ', 'T') + ':00Z');
      const v = [+o, +h, +l, +c];
      if (!Number.isFinite(ms) || v.some((x) => !Number.isFinite(x) || x <= 0) || ms <= last) { bad++; continue; }
      last = ms; t.push(ms / 60000); p.push(...v);
    }
    const n = t.length;
    const buf = Buffer.alloc(4 + 4 * n + 16 * n);
    buf.writeInt32LE(n, 0);
    for (let i = 0; i < n; i++) buf.writeInt32LE(t[i], 4 + 4 * i);
    for (let i = 0; i < 4 * n; i++) buf.writeFloatLE(p[i], 4 + 4 * n + 4 * i);
    const gz = gzipSync(buf, { level: 9 });
    writeFileSync(join(out, `${symbol}_${tf}.bin.gz`), gz);
    manifest[`${symbol}_${tf}`] = { symbol, tf, first: t[0] * 60000, last: t[n - 1] * 60000, candles: n };
    console.log(symbol, tf, n, 'bad', bad, (gz.length / 1e6).toFixed(2) + 'MB');
  }
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
