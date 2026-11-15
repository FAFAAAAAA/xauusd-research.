'use client';
import { RISK_STATS } from '@/lib/core/risk-stats';

/* Strategy sheet on the Trade page: the bot rules of one strategy and its research backtest (Binance Futures, RR 1:2, fee + slippage 0.12%).
 * Numbers come from the research of 9–15 Nov 2026 (1h Binance data Jul 2020 – Nov 2026). Not a promise: live results will differ. */
interface Info {
  name: string; side: 'SELL' | 'BUY'; coins: string; rules: string[];
  facts: Array<[string, string]>; years?: Array<[string, number]>; note: string;
}
const bz = RISK_STATS.bz;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const r1 = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString('id-ID', { maximumFractionDigits: 2 })}R`;
export const STRATEGY_INFO: Record<string, Info> = {
  snr: {
    name: 'ALT', side: 'SELL', coins: '26 alt pilihan',
    rules: ['Koin sedang turun: close D1 di bawah EMA50 D1', 'Volume 30 hari rata-rata ≥ $20 jt', 'Candle H4 tutup menembus support (low terendah 5 candle kiri-kanan)',
      'SL di atas support + 0,5 × ATR H4 · TP 2 × risiko', 'Keluar hanya di TP atau SL'],
    facts: [['Win', '41%'], ['Trade/bulan', '±27'], ['Rata-rata', '+0,21R'], ['Per tahun', '±+77R'], ['Turun terdalam', '36R'], ['Tahun rugi', '0']],
    note: 'Mesin utama. Koin dipilih dari backtest, jadi hasil nyata bisa sedikit lebih rendah.',
  },
  btc: {
    name: 'BIG', side: 'BUY', coins: 'BTC ETH SOL BNB XRP DOGE',
    rules: ['Tren naik: close H4 di atas EMA200 H4', 'Close H4 pertama di atas high 50 candle H4 sebelumnya', 'SL close − 1 × ATR14 D1 · TP 2 × risiko', 'Maks 2 posisi BUY'],
    facts: [['Win', '41%'], ['Trade/bulan', '±5,7'], ['Rata-rata', '+0,17R'], ['Per tahun', '±+14,5R'], ['Data lama', '+0,19R'], ['Data uji', '+0,21R']],
    note: 'Pengimbang saat pasar naik. Jarang ada sinyal saat BTC di bawah EMA200 H4.',
  },
  v2: {
    name: 'v1 XAU', side: 'BUY', coins: 'Emas (XAUUSD) · BUY & SELL',
    rules: ['Level harian: open hari ini ± 0,5 × range kemarin (Senin pakai range Jumat)', 'Close M15 menembus level, badan candle ≥ 0,5 × ATR M15',
      'Tren H4 & D1 searah (H4 close > EMA50 > EMA200 dan D1 close > EMA50; SELL kebalikannya + EMA50 D1 < EMA200)', 'Maks 1 entry per arah per blok 4 jam, sinyal ke-2 searah di hari yang sama dilewati',
      'SL level ∓ 0,35 × ATR D1 · TP 2 × risiko · SL digeser ke entry setelah +1R (BEP)'],
    facts: [['Win', '34%'], ['Impas (BEP)', '23%'], ['Trade/bulan', '±5'], ['Rata-rata', '+0,19R'], ['Per tahun', '±+11R'], ['Turun terdalam', '17R'], ['Tahun rugi', '2 dari 22']],
    note: 'Biaya Exness Raw Spread + swap, 2004–2026. Paling stabil di semua periode dan saat emas turun.',
  },
  v1: {
    name: 'v1 Level', side: 'BUY', coins: 'Emas (XAUUSD) · BUY & SELL',
    rules: ['Swing high/low H1 (3 candle kiri-kanan) maksimal 119 candle lalu', 'Level sudah disentuh 2–3× (dalam 0,25 × ATR H1) dan belum pernah ditembus close',
      'Close H1 pertama menembus level, badan candle ≥ 1 × ATR H1', 'Tren H4 & D1 searah (sama dengan v1 XAU)', 'Sinyal ke-2 searah di hari yang sama dilewati',
      'SL level ∓ 1,5 × ATR H1 · TP 2 × risiko · tanpa BEP'],
    facts: [['Win', '42%'], ['Trade/bulan', '±3'], ['Rata-rata', '+0,16R'], ['2018–2026', '+0,27R'], ['Turun terdalam', '15R'], ['Tahun rugi', '7 dari 22']],
    note: 'Biaya Exness Raw Spread + swap, 2004–2026. Kuat saat emas naik; bersama v1 XAU + v1 NAS turun terdalam gabungan malah lebih kecil.',
  },
  nas: {
    name: 'v1 NAS', side: 'BUY', coins: 'Nasdaq (US100) · BUY & SELL',
    rules: ['Close H1 menembus high / low 20 candle H1 sebelumnya', 'Breakout lanjutan: breakout searah sebelumnya ≤ 2 candle H1', 'Tren H4 & D1 searah (aturan 1)',
      'Entry hanya 10:00–16:00 waktu New York', 'SL close ∓ 0,2 × ATR D1 · TP 2 × risiko · tanpa BEP'],
    facts: [['Win', '43%'], ['Trade/bulan', '±6'], ['Rata-rata', '+0,21R'], ['Per tahun', '±+15R'], ['Turun terdalam', '16R'], ['Tahun rugi', '0 (2018–26)']],
    note: 'Biaya USTEC Exness + swap, 2018–2026. Kuat saat Nasdaq naik maupun turun, lemah saat sideways.',
  },
  bz: {
    name: 'BZ', side: 'SELL', coins: 'Semua koin likuid',
    rules: ['Volume 30 hari rata-rata ≥ $20 jt (semua koin USDT Binance)', 'Squeeze: lebar Bollinger H4 (20, 2) di 20% terendah dari 120 candle',
      'Candle H4 berikutnya tutup di bawah band bawah', 'Tanpa filter tren', 'SL close + 1,5 × ATR14 H4 · TP 2 × risiko', 'Maks 2 posisi BZ'],
    facts: [['Win', pct(bz.winRate)], ['Trade/bulan', `±${bz.perMonth.toLocaleString('id-ID', { maximumFractionDigits: 1 })}`], ['Rata-rata', r1(bz.avgR)],
      ['Per tahun', `±+${Math.round(bz.perMonthR * 12)}R`], ['Turun terdalam', `${String(bz.maxDdR).replace('.', ',')}R`], ['Kalah beruntun', `${bz.maxLossStreak}×`],
      ['Bulan rugi', pct(bz.negMonthsPct)], ['Bulan terburuk', r1(bz.worstMonthR)]],
    years: [['2021', 43.3], ['2022', 43.3], ['2023', 2.4], ['2024', 39.4], ['2025', 10.2], ['2026', 48.0]],
    note: 'Paling naik-turun: tanpa batas posisi tahun 2023 rugi. Turun terdalam sendirian ±27% saldo di risiko 1%, ±47% di risiko 2%. Bersama ALT + BIG: +114R/tahun, turun terdalam 42R.',
  },
};

export default function StrategyInfo({ k, live }: { k: string; live?: { win: number | null; closed: number } }) {
  const s = STRATEGY_INFO[k];
  if (!s) return null;
  const max = s.years ? Math.max(...s.years.map((y) => Math.abs(y[1]))) : 1;
  return (
    <div className="stack si">
      <div className="si-tags">
        <span className={`si-side ${s.coins.includes('BUY & SELL') ? 'b' : s.side === 'BUY' ? 'b' : 's'}`}>{s.coins.includes('BUY & SELL') ? 'BUY & SELL' : s.side}</span>
        <span className="si-coins">{s.coins.replace(' · BUY & SELL', '')}</span>
        <span className="si-tf">RR 1:2</span>
      </div>
      <div className="si-card">
        <p className="si-h">Aturan</p>
        <ol className="si-rules">{s.rules.map((r) => <li key={r}>{r}</li>)}</ol>
      </div>
      <div className="si-card">
        <p className="si-h">Backtest <span>{k === 'v2' || k === 'v1' ? '2004–2026 · Exness' : k === 'nas' ? '2018–2026 · Exness' : '2020–2026 · biaya Binance'}</span></p>
        <div className="si-facts">{s.facts.map(([a, b]) => <span key={a}><span className="k">{a}</span><strong>{b}</strong></span>)}</div>
        {s.years ? (
          <div className="si-years" aria-label="Hasil per tahun">
            {s.years.map(([y, v]) => (
              <span key={y} className="si-yr">
                <span className="si-bar"><i className={v < 0 ? 'neg' : ''} style={{ height: `${Math.max(4, (Math.abs(v) / max) * 100)}%` }} /></span>
                <strong>{v > 0 ? '+' : ''}{Math.round(v)}R</strong><small>{y}</small>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {live && live.closed > 0 ? (
        <div className="si-card si-live">
          <p className="si-h">Hasil nyata</p>
          <p className="small">{live.closed} trade selesai · win {live.win == null ? '—' : `${Math.round(live.win * 100)}%`} (backtest {s.facts[0][1]})</p>
        </div>
      ) : null}
      <p className="mute small">{s.note} Hasil backtest bukan janji.</p>
    </div>
  );
}
