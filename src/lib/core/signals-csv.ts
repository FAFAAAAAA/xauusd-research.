/** CSV: time, side, stop_loss (header optional). time = open time of the M15 signal candle (UTC). */
export function parseSignalsCsv(text: string): { signals: Array<[number, number, number]>; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  if (!lines.length) return { signals: [], errors: ['File kosong'] };
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const first = lines[0].split(delim).map((x) => x.trim().toLowerCase());
  const header = first.some((x) => /[a-z]/.test(x) && !/^(buy|sell|long|short)$/.test(x) && !/^\d{4}/.test(x));
  const col = (names: RegExp, fallback: number) => { const i = header ? first.findIndex((h) => names.test(h)) : -1; return i >= 0 ? i : fallback; };
  const ti = col(/time|date|waktu|tanggal/, 0), si = col(/side|type|direction|signal|arah|action/, 1), li = col(/^sl$|stop|stop_loss|stoploss/, 2);
  const signals: Array<[number, number, number]> = [];
  lines.slice(header ? 1 : 0).forEach((ln, k) => {
    const c = ln.split(delim).map((x) => x.trim().replace(/^"|"$/g, ''));
    const raw = c[ti] ?? '';
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw.replace(' ', 'T') : `${raw.replace(' ', 'T').replace(/\//g, '-')}${raw.length <= 16 ? ':00' : ''}Z`;
    const t = /^\d{10,13}$/.test(raw) ? Number(raw) * (raw.length === 10 ? 1000 : 1) : Date.parse(iso);
    const sideRaw = (c[si] ?? '').toLowerCase();
    const side = /^(buy|long|1|\+1)$/.test(sideRaw) ? 1 : /^(sell|short|-1)$/.test(sideRaw) ? -1 : 0;
    const sl = Number((c[li] ?? '').replace(',', '.'));
    if (!Number.isFinite(t) || !side || !(sl > 0)) { if (errors.length < 8) errors.push(`Baris ${k + (header ? 2 : 1)}: "${ln.slice(0, 60)}"`); return; }
    signals.push([Math.floor(t / 900_000) * 900_000, side, sl]);
  });
  return { signals, errors };
}

