//+------------------------------------------------------------------+
//| NAS_v1_EA.mq5 — v1 NAS · Donchian H1 20 breakout lanjutan (sama   |
//| dengan backtest website, versi nas-donchian-v1). MetaTrader 5,     |
//| simbol Nasdaq 100 (Exness: USTEC).                                 |
//|                                                                    |
//| Aturan (memakai jam UTC dan candle yang SUDAH TUTUP):              |
//|  BUY : candle H1 CLOSE di atas high tertinggi 20 candle H1         |
//|        sebelumnya, tren naik (aturan 1), DAN breakout BUY searah   |
//|        tren sebelumnya terjadi paling jauh 2 candle H1 lalu        |
//|        ("breakout lanjutan"), DAN jam entry (= jam close H1) di    |
//|        antara 10:00 dan 16:00 waktu New York (DST otomatis).       |
//|  SELL: kebalikannya (close di bawah low 20 candle, tren turun).    |
//|  SL = close H1 ∓ 0,2 × ATR14 D1. TP = 2 × jarak SL dari harga isi. |
//|  Tidak ada breakeven, tidak ada batas jumlah posisi. Keluar hanya  |
//|  di TP atau SL.                                                    |
//|  Tren (aturan 1): BUY  jika close H4 > EMA50 > EMA200 (H4) dan     |
//|                        close D1 > EMA50 (D1)                       |
//|                   SELL jika close H4 < EMA50 < EMA200, close D1 <  |
//|                        EMA50 dan EMA50 D1 < EMA200 D1              |
//|  H4 & D1 dibentuk sendiri dari candle H1 dalam jam UTC; D1 hanya   |
//|  hari Senin–Jumat (candle Minggu malam dibuang), sama dengan web.  |
//|                                                                    |
//| Pasang di chart USTEC timeframe apa saja (EA membaca H1 sendiri).  |
//| Lot minimum USTEC Exness 0,05 — jika lot hasil risiko % di bawah   |
//| itu, entry DILEWATI (tidak pernah risiko lebih dari rencana).      |
//|                                                                    |
//| Setiap entry & penutupan dilaporkan ke website (Jurnal + Telegram).|
//| WAJIB: Tools → Options → Expert Advisors → centang "Allow WebRequest|
//| for listed URL" lalu tambahkan alamat website kamu.                |
//|                                                                    |
//| Uji dulu di AKUN DEMO. Trading berisiko; hasil backtest bukan      |
//| jaminan hasil nyata.                                               |
//+------------------------------------------------------------------+
#property copyright "XAUUSD Research"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

input double InpRiskPercent  = 0.5;    // Risiko per trade (% equity)
input bool   InpTrade        = true;   // true = pasang order; false = hanya tulis sinyal ke log
input double InpMaxSpread    = 4.0;    // Lewati entry jika spread (poin indeks) di atas ini
input long   InpMagic        = 20261107; // Magic number (beda dengan EA v1 XAU)
input string InpReportUrl    = "https://xauusd-research.vercel.app/api/ea/report"; // Alamat laporan website
input string InpEaKey        = "";     // Kunci EA dari website (Atur → EA) — sama dengan EA v1 XAU
input int    InpSlippagePts  = 300;    // Slippage maksimum (points; USTEC 2 digit → 300 = 3 poin)
input int    InpTesterUtcOffset = 0;   // KHUSUS Strategy Tester: offset jam server − UTC (Exness = 0). -99 = otomatis GMT+2 / GMT+3 (broker lain)

const int    DON_N   = 20;     // Donchian: 20 candle H1 sebelumnya
const int    GAP     = 2;      // breakout searah sebelumnya maksimal 2 candle H1 lalu
const double SL_ATR  = 0.2;    // SL = close ∓ 0,2 × ATR14 D1
const double RR      = 2.0;
const int    NY_FROM = 10, NY_TO = 16;   // jam entry New York [10:00, 16:00)
const int    H4_WIN  = 1000;   // jumlah candle H4 untuk EMA (sama dengan website)
const int    D1_WIN  = 1000;   // jumlah candle D1 untuk EMA
const int    ATR_WIN = 400;    // jumlah candle D1 untuk ATR

CTrade trade;
datetime g_lastH1 = 0;
string   g_tk = "";                                   // cache key of the trend values (last H4 | last D1)
bool     g_up = false, g_dn = false;
double   g_atr = 0;

struct Bar { datetime t; double o, h, l, c; };

//--- US daylight saving (2nd Sunday of March .. 1st Sunday of November), by date
bool UsDst(datetime t)
{
   MqlDateTime d; TimeToStruct(t, d);
   if(d.mon < 3 || d.mon > 11) return false;
   if(d.mon > 3 && d.mon < 11) return true;
   int firstSun = 1 + (7 - ((d.day_of_week - (d.day - 1) % 7) + 7) % 7) % 7;   // date of the 1st Sunday of this month
   if(d.mon == 3) return d.day >= firstSun + 7;
   return d.day < firstSun;
}
//--- server→UTC offset in seconds (Strategy Tester: from InpTesterUtcOffset, because TimeGMT() = server time there)
int UtcOffset()
{
   if(MQLInfoInteger(MQL_TESTER))
   {
      if(InpTesterUtcOffset != -99) return InpTesterUtcOffset * 3600;
      return (UsDst(TimeCurrent()) ? 3 : 2) * 3600;
   }
   long d = (long)(TimeTradeServer() - TimeGMT());
   return (int)(MathRound(d / 900.0) * 900);
}
//--- New York wall-clock hour of a UTC time (EST = UTC−5, EDT = UTC−4)
double NyHour(long utc)
{
   long ny = utc - 5 * 3600;
   if(UsDst((datetime)ny)) ny += 3600;
   long s = ((ny % 86400) + 86400) % 86400;
   return s / 3600.0;
}

//--- build UTC candles of `periodSec` (14400 = H4, 86400 = D1) from H1 rates (only buckets completed before `nowUtc`)
int BuildUtc(const MqlRates &h1[], int n, int off, int periodSec, datetime nowUtc, Bar &out[])
{
   ArrayResize(out, 0, 30000);
   int k = -1; long cur = -1;
   for(int i = 0; i < n; i++)
   {
      long t = (long)h1[i].time - off;
      if(t + 3600 > (long)nowUtc) break;
      long b = (t / periodSec) * periodSec;
      if(b != cur)
      {
         cur = b; k++; ArrayResize(out, k + 1, 30000);
         out[k].t = (datetime)b; out[k].o = h1[i].open; out[k].h = h1[i].high; out[k].l = h1[i].low; out[k].c = h1[i].close;
      }
      else
      {
         out[k].h = MathMax(out[k].h, h1[i].high); out[k].l = MathMin(out[k].l, h1[i].low); out[k].c = h1[i].close;
      }
   }
   if(k >= 0 && (long)out[k].t + periodSec > (long)nowUtc) { k--; ArrayResize(out, k + 1); }
   return k + 1;
}
//--- EMA over the last `win` closes, seeded with the first close of the window (like the website)
double EmaLast(const Bar &a[], int n, int len, int win)
{
   int s = MathMax(0, n - win);
   double alpha = 2.0 / (len + 1.0), e = a[s].c;
   for(int i = s + 1; i < n; i++) e = alpha * a[i].c + (1 - alpha) * e;
   return e;
}
//--- Wilder ATR as EWM(alpha=1/len) over the last `win` candles
double AtrLast(const Bar &a[], int n, int len, int win)
{
   int s = MathMax(1, n - win + 1);
   double alpha = 1.0 / len, e = -1;
   for(int i = s; i < n; i++)
   {
      double pc = a[i - 1].c;
      double tr = MathMax(a[i].h - a[i].l, MathMax(MathAbs(a[i].h - pc), MathAbs(a[i].l - pc)));
      e = (e < 0) ? tr : alpha * tr + (1 - alpha) * e;
   }
   return e;
}

//--- aturan 1 trend + ATR D1 as known at `nowUtc` (completed H4 and completed weekday D1 candles). Cached per H4/D1 close.
bool TrendAt(const MqlRates &h1[], int nh, int off, datetime nowUtc, bool &up, bool &dn, double &atr)
{
   Bar h4[], dall[];
   int n4 = BuildUtc(h1, nh, off, 14400, nowUtc, h4);
   int nda = BuildUtc(h1, nh, off, 86400, nowUtc, dall);
   if(n4 < 210 || nda < 1) { up = dn = false; atr = 0; return false; }
   string key = StringFormat("%I64d|%I64d", (long)h4[n4 - 1].t, (long)dall[nda - 1].t);
   if(key == g_tk) { up = g_up; dn = g_dn; atr = g_atr; return atr > 0; }
   Bar d1[]; int nd = 0;
   ArrayResize(d1, nda);
   for(int i = 0; i < nda; i++)
   {
      MqlDateTime dt; TimeToStruct(dall[i].t, dt);
      if(dt.day_of_week >= 1 && dt.day_of_week <= 5) d1[nd++] = dall[i];
   }
   ArrayResize(d1, nd);
   if(nd < 210) { up = dn = false; atr = 0; }
   else
   {
      double e50 = EmaLast(h4, n4, 50, H4_WIN), e200 = EmaLast(h4, n4, 200, H4_WIN), lc4 = h4[n4 - 1].c;
      double d50 = EmaLast(d1, nd, 50, D1_WIN), d200 = EmaLast(d1, nd, 200, D1_WIN), lcd = d1[nd - 1].c;
      up = lc4 > e50 && e50 > e200 && lcd > d50;
      dn = lc4 < e50 && e50 < e200 && lcd < d50 && d50 < d200;
      atr = AtrLast(d1, nd, 14, ATR_WIN);
   }
   g_tk = key; g_up = up; g_dn = dn; g_atr = atr;
   return atr > 0;
}

//--- side (+1 / −1 / 0) of a trend-aligned Donchian breakout by the CLOSED H1 candle at index i (oldest-first array)
int AlignedBreakout(const MqlRates &h1[], int nh, int i, int off, double &atr)
{
   if(i < DON_N) return 0;
   double hh = -DBL_MAX, ll = DBL_MAX;
   for(int x = i - DON_N; x < i; x++) { hh = MathMax(hh, h1[x].high); ll = MathMin(ll, h1[x].low); }
   bool bu = h1[i].close > hh, bd = h1[i].close < ll;
   if(!bu && !bd) return 0;
   bool up, dn;
   datetime closeUtc = (datetime)((long)h1[i].time - off + 3600);
   if(!TrendAt(h1, i + 1, off, closeUtc, up, dn, atr)) return 0;
   if(bu && up) return 1;
   if(bd && dn) return -1;
   return 0;
}

int OnInit()
{
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePts);
   trade.SetTypeFillingBySymbol(_Symbol);
   if(StringLen(InpEaKey) < 10) Print("Peringatan: Kunci EA kosong — laporan ke website tidak akan diterima.");
   Print("NAS v1 EA aktif. Offset server-UTC: ", UtcOffset() / 3600.0, " jam.");
   return INIT_SUCCEEDED;
}

string GvName(int side, long barTime) { return StringFormat("NASv1_%I64d_%d_%I64d", InpMagic, side, barTime); }

//--- lot for a $ risk and an SL distance (price), rounded DOWN to the volume step; 0 if below the broker minimum
double LotFor(double riskMoney, double dist)
{
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tv <= 0) tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), mn = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), mx = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(tv <= 0 || ts <= 0 || dist <= 0 || step <= 0) return 0;
   double perLot = dist / ts * tv;
   double lot = MathFloor(riskMoney / perLot / step + 1e-9) * step;
   if(lot < mn) return 0;
   return MathMin(lot, mx);
}

void OnTick()
{
   datetime bar = iTime(_Symbol, PERIOD_H1, 0);
   if(bar == 0 || bar == g_lastH1) return;          // once per new H1 candle
   g_lastH1 = bar;

   int off = UtcOffset();
   // cheapest check: 21 closed H1 candles only — most hours have no breakout and stop here
   MqlRates q[];
   ArraySetAsSeries(q, false);
   if(CopyRates(_Symbol, PERIOD_H1, 1, DON_N + 1, q) < DON_N + 1) return;
   double qh = -DBL_MAX, ql = DBL_MAX;
   for(int x = 0; x < DON_N; x++) { qh = MathMax(qh, q[x].high); ql = MathMin(ql, q[x].low); }
   if(!(q[DON_N].close > qh) && !(q[DON_N].close < ql)) return;

   MqlRates h1[];
   ArraySetAsSeries(h1, false);
   int nh = CopyRates(_Symbol, PERIOD_H1, 1, 26000, h1);   // CLOSED H1 candles, oldest first; h1[nh-1] = just closed
   if(nh < 5000) { Print("Riwayat H1 kurang (", nh, "). Scroll chart H1 ke kiri / tambah Max bars in chart."); return; }
   int k = nh - 1;
   long closeUtc = (long)h1[k].time - off + 3600;     // entry time = H1 close (UTC)

   // cheap check first: does the just-closed H1 candle break the 20-candle high/low at all?
   double hh = -DBL_MAX, ll = DBL_MAX;
   for(int x = k - DON_N; x < k; x++) { hh = MathMax(hh, h1[x].high); ll = MathMin(ll, h1[x].low); }
   if(!(h1[k].close > hh) && !(h1[k].close < ll)) return;

   double atr = 0;
   int s = AlignedBreakout(h1, nh, k, off, atr);
   if(s == 0) return;
   double atrNow = atr;
   string side = s > 0 ? "BUY" : "SELL";

   // "breakout lanjutan": a trend-aligned breakout of the same side 1 or 2 H1 candles earlier
   int gap = 0;
   for(int g = 1; g <= GAP && gap == 0; g++) { double a2; if(AlignedBreakout(h1, nh, k - g, off, a2) == s) gap = g; }
   if(gap == 0) { PrintFormat("Breakout %s tanpa breakout searah 1–2 jam sebelumnya — lewati.", side); return; }
   double nyh = NyHour(closeUtc);
   if(!(nyh >= NY_FROM && nyh < NY_TO)) { PrintFormat("Sinyal %s di luar sesi New York (jam NY %.0f) — lewati.", side, MathFloor(nyh)); return; }
   if(GlobalVariableCheck(GvName(s, (long)h1[k].time))) return;    // already handled (EA restarted within the hour)
   GlobalVariableSet(GvName(s, (long)h1[k].time), 1);

   double sl = h1[k].close - s * SL_ATR * atrNow;
   PrintFormat("Sinyal v1 NAS %s: close %.2f menembus %s 20 candle (%.2f), lanjutan %d jam, SL %.2f (ATR D1 %.2f), jam NY %.0f",
               side, h1[k].close, s > 0 ? "high" : "low", s > 0 ? hh : ll, gap, sl, atrNow, MathFloor(nyh));
   if(!InpTrade) return;
   double spread = SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(spread > InpMaxSpread) { PrintFormat("Lewati: spread %.2f > %.2f", spread, InpMaxSpread); return; }
   double price = s > 0 ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double dist = s * (price - sl);
   if(dist <= 0) { Print("Lewati: harga sudah melewati SL."); return; }
   double tp = price + s * RR * dist;
   double lot = LotFor(AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPercent / 100.0, dist);
   if(lot <= 0) { PrintFormat("Lewati: lot di bawah minimum broker (%.2f) untuk risiko %.2f%% dan jarak SL %.2f poin.", SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), InpRiskPercent, dist); return; }
   int dg = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   bool ok = s > 0 ? trade.Buy(lot, _Symbol, 0, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), "v1 NAS")
                   : trade.Sell(lot, _Symbol, 0, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), "v1 NAS");
   if(!ok) PrintFormat("Order gagal: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
}

//--- report entries and exits to the website
void Report(string json)
{
   if(MQLInfoInteger(MQL_TESTER)) return;
   if(StringLen(InpEaKey) < 10 || StringLen(InpReportUrl) < 10) return;
   char data[], res[]; string hdr;
   StringToCharArray(json, data, 0, StringLen(json), CP_UTF8);
   int code = WebRequest("POST", InpReportUrl, "Content-Type: application/json\r\n", 5000, data, res, hdr);
   if(code == -1) Print("Laporan gagal (", GetLastError(), "). Tambahkan alamat website di Tools → Options → Expert Advisors → Allow WebRequest.");
   else if(code != 200) Print("Website menolak laporan: HTTP ", code, " ", CharArrayToString(res));
}

void OnTradeTransaction(const MqlTradeTransaction &tx, const MqlTradeRequest &rq, const MqlTradeResult &rs)
{
   if(tx.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(tx.deal)) return;
   if(HistoryDealGetInteger(tx.deal, DEAL_MAGIC) != InpMagic || HistoryDealGetString(tx.deal, DEAL_SYMBOL) != _Symbol) return;
   long entry = HistoryDealGetInteger(tx.deal, DEAL_ENTRY);
   long pos = HistoryDealGetInteger(tx.deal, DEAL_POSITION_ID);
   long t = (long)HistoryDealGetInteger(tx.deal, DEAL_TIME) - UtcOffset();
   double price = HistoryDealGetDouble(tx.deal, DEAL_PRICE), vol = HistoryDealGetDouble(tx.deal, DEAL_VOLUME);
   long dtype = HistoryDealGetInteger(tx.deal, DEAL_TYPE);
   if(entry == DEAL_ENTRY_IN)
   {
      double sl = 0, tp = 0;
      if(PositionSelectByTicket(pos)) { sl = PositionGetDouble(POSITION_SL); tp = PositionGetDouble(POSITION_TP); }
      string side = dtype == DEAL_TYPE_BUY ? "BUY" : "SELL";
      Report(StringFormat("{\"key\":\"%s\",\"strategy\":\"nas\",\"event\":\"open\",\"ticket\":\"%I64d\",\"side\":\"%s\",\"price\":%.3f,\"sl\":%.3f,\"tp\":%.3f,\"lot\":%.2f,\"time\":%I64d}",
                          InpEaKey, pos, side, price, sl, tp, vol, t));
   }
   else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
   {
      double profit = HistoryDealGetDouble(tx.deal, DEAL_PROFIT) + HistoryDealGetDouble(tx.deal, DEAL_SWAP) + HistoryDealGetDouble(tx.deal, DEAL_COMMISSION);
      if(HistorySelectByPosition(pos))
         for(int i = 0; i < HistoryDealsTotal(); i++)
         {
            ulong d = HistoryDealGetTicket(i);
            if(HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN) profit += HistoryDealGetDouble(d, DEAL_COMMISSION);
         }
      long why = HistoryDealGetInteger(tx.deal, DEAL_REASON);
      string reason = why == DEAL_REASON_TP ? "tp" : why == DEAL_REASON_SL ? "sl" : "manual";
      string side = dtype == DEAL_TYPE_SELL ? "BUY" : "SELL";
      Report(StringFormat("{\"key\":\"%s\",\"strategy\":\"nas\",\"event\":\"close\",\"ticket\":\"%I64d\",\"side\":\"%s\",\"price\":%.3f,\"profit\":%.2f,\"reason\":\"%s\",\"lot\":%.2f,\"time\":%I64d}",
                          InpEaKey, pos, side, price, profit, reason, vol, t));
   }
}
//+------------------------------------------------------------------+
