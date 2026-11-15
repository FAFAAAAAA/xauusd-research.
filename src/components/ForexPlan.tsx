'use client';
/* Combined forex plan on the Backtest page (Forex): v1 XAU (with BEP) + v1 Level (no BEP) + v1 NAS (no BEP).
 * Numbers from the research backtest of 15 Nov 2026: bundled M15 data 2018-01 → 2026-10, Exness Raw Spread costs + swap, RR 1:2,
 * every trade 1R (no position cap). Prop firm row = simulation of PROP EA v1.04 guard on FundingPips 2 Step Standard (8% / 5%, daily 5%, total 10%),
 * 96 monthly starts 2018–2025. Not a promise: live results will differ. */
const PARTS: Array<{ name: string; info: string; facts: Array<[string, string]> }> = [
  { name: 'v1 XAU', info: 'Emas · level harian · BEP di +1R', facts: [['Trade/bln', '5,2'], ['Win', '33%'], ['Impas', '21%'], ['Rata', '+0,18R'], ['PF', '1,37'], ['Per tahun', '+11,0R'], ['Turun terdalam', '17R']] },
  { name: 'v1 Level', info: 'Emas · level H1 2–3× · tanpa BEP', facts: [['Trade/bln', '3,0'], ['Win', '44%'], ['Rata', '+0,27R'], ['PF', '1,46'], ['Per tahun', '+9,7R'], ['Turun terdalam', '11R']] },
  { name: 'v1 NAS', info: 'Nasdaq · breakout H1 20 · tanpa BEP', facts: [['Trade/bln', '5,6'], ['Win', '43%'], ['Rata', '+0,21R'], ['PF', '1,34'], ['Per tahun', '+13,9R'], ['Turun terdalam', '16R']] },
];
const YEARS: Array<[string, number]> = [['2018', 23.2], ['2019', 7.7], ['2020', 58.9], ['2021', 23.7], ['2022', 30.8], ['2023', 26.7], ['2024', 34.4], ['2025', 69.2], ['2026*', 30.2]];
const FACTS: Array<[string, string]> = [['Trade/bulan', '13,8'], ['Per minggu', '±3,2'], ['Win', '40%'], ['Rata-rata', '+0,21R'], ['Profit factor', '1,38'], ['Per tahun', '+34,5R'],
  ['Turun terdalam', '23,7R'], ['Bulan rugi', '39%'], ['Bulan terburuk', '−12,8R'], ['Kalah beruntun', '17×'], ['Tahun rugi', '0 dari 9'], ['Rata / bulan', '+2,9R']];
const PROP: Array<[string, string]> = [['Risiko 0,5%', '82% lulus'], ['Risiko 0,75%', '68% lulus'], ['Risiko 1%', '64% lulus']];

export default function ForexPlan() {
  const max = Math.max(...YEARS.map((y) => Math.abs(y[1])));
  return (
    <section className="group stack si fxplan" aria-label="FX3 gabungan forex">
      <div className="si-tags">
        <span className="si-side b">BUY & SELL</span>
        <span className="si-coins">FX3 · v1 XAU + v1 Level + v1 NAS</span>
        <span className="si-tf">RR 1:2</span>
      </div>
      <div className="si-card">
        <p className="si-h">FX3 riset <span>2018–2026 · Exness + swap</span></p>
        <div className="si-facts">{FACTS.map(([a, b]) => <span key={a}><span className="k">{a}</span><strong>{b}</strong></span>)}</div>
        <div className="si-years fx9" aria-label="Hasil per tahun">
          {YEARS.map(([y, v]) => (
            <span key={y} className="si-yr">
              <span className="si-bar"><i className={v < 0 ? 'neg' : ''} style={{ height: `${Math.max(4, (Math.abs(v) / max) * 100)}%` }} /></span>
              <strong>{v > 0 ? '+' : ''}{Math.round(v)}R</strong><small>{y}</small>
            </span>
          ))}
        </div>
        <p className="mute small" style={{ marginTop: 8 }}>* 2026 sampai Oktober. 1R = risiko per trade (mis. 1% saldo).</p>
      </div>
      {PARTS.map((p) => (
        <div key={p.name} className="si-card">
          <p className="si-h">{p.name} <span>{p.info}</span></p>
          <div className="si-facts">{p.facts.map(([a, b]) => <span key={a}><span className="k">{a}</span><strong>{b}</strong></span>)}</div>
        </div>
      ))}
      <div className="si-card">
        <p className="si-h">Prop firm <span>FundingPips 2 Step · PROP EA v1.04</span></p>
        <div className="si-facts">{PROP.map(([a, b]) => <span key={a}><span className="k">{a}</span><strong>{b}</strong></span>)}</div>
        <p className="mute small" style={{ marginTop: 8 }}>Simulasi 96 awal bulan (2018–2025), target 8% lalu 5%, batas harian 5%, total 10%. Gagal 0% karena EA mengecilkan lot dekat batas; sisanya belum capai target dalam 1 tahun. Akun funded: risiko 0,4%.</p>
      </div>
      <p className="mute small">Hasil backtest riset, bukan janji. Kalah beruntun 17× dan bulan rugi 39% itu normal untuk strategi ini.</p>
    </section>
  );
}
