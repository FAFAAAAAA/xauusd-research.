//+------------------------------------------------------------------+
//| PROP_XAU_NAS_EA.mq5 — v1 XAU + v1 NAS dalam SATU EA, dengan       |
//| penjaga aturan prop firm (FundingPips 2 Step Standard dsb.).       |
//|                                                                    |
//| Dua metode tetap TERPISAH (tidak digabung):                        |
//|  v1 XAU (emas)   = sama persis dengan XAU_v2_EA v1.14 (volbreak-v5)|
//|  v1 NAS (Nasdaq) = sama persis dengan NAS_v1_EA v1.00              |
//|  Masing-masing punya magic number sendiri (jurnal website terpisah)|
//|                                                                    |
//| Pasang di SATU chart saja (simbol apa pun, timeframe apa pun).     |
//| EA membaca data emas & Nasdaq sendiri (nama simbol di pengaturan). |
//|                                                                    |
//| Risiko per trade = InpRiskPercent % dari InpAccountSize (ukuran    |
//| akun awal, seperti cara prop firm menghitung batas).               |
//|                                                                    |
//| Penjaga prop firm (semua dihitung dari InpAccountSize):            |
//|  - Target: equity >= target -> semua posisi EA ditutup, EA berhenti|
//|    membuka posisi (fase lulus). Target 0 = mati (akun funded).     |
//|  - Rugi harian: rugi hari ini (dari saldo/equity tertinggi saat    |
//|    hari server mulai) mencapai batas − buffer -> semua posisi EA   |
//|    ditutup, tidak ada entry baru sampai hari server berikutnya.    |
//|  - Rugi total: equity turun ke batas − buffer -> semua posisi EA   |
//|    ditutup, tidak ada entry baru.                                  |
//|  - Berita (opsional, untuk akun funded): tidak buka posisi dalam   |
//|    InpNewsMinutes menit sebelum/sesudah berita USD berdampak tinggi|
//|    (kalender ekonomi bawaan MT5).                                  |
//|  - Sebelum entry: lot dikecilkan bila "rugi terburuk" (semua posisi|
//|    terbuka kena SL + trade baru kena SL) bisa melewati batas harian|
//|    atau total − buffer, dan bila margin bebas tidak cukup.         |
//|                                                                    |
//| WAJIB: Tools → Options → Expert Advisors → centang "Allow WebRequest|
//| for listed URL" lalu tambahkan alamat website (untuk laporan).     |
//| Uji dulu di akun trial / demo. Trading berisiko; hasil backtest    |
//| bukan jaminan hasil nyata.                                         |
//+------------------------------------------------------------------+
#property copyright "XAUUSD Research"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

input group "Strategi"
input bool   InpUseXau       = true;       // Jalankan v1 XAU (emas)
input string InpXauSymbol    = "XAUUSD";   // Nama simbol emas di broker ini
input bool   InpUseNas       = true;       // Jalankan v1 NAS (Nasdaq)
input string InpNasSymbol    = "NAS100";   // Nama simbol Nasdaq di broker ini (FundingPips: NAS100, Exness: USTEC)
input double InpRiskPercent  = 2.0;        // Risiko per trade (% dari ukuran akun)
input bool   InpTrade        = true;       // true = pasang order; false = hanya tulis sinyal ke log

input group "Aturan prop firm"
input double InpAccountSize  = 10000;      // Ukuran akun awal ($). 0 = risiko dari equity, penjaga prop mati
input double InpTargetPct    = 8.0;        // Target fase (%): Fase 1 = 8, Fase 2 = 5, funded = 0 (mati)
input double InpDailyLimitPct = 5.0;       // Batas rugi harian prop firm (%)
input double InpMaxLossPct   = 10.0;       // Batas rugi total prop firm (%)
input double InpBufferPct    = 1.0;        // EA berhenti sekian % SEBELUM batas (jarak aman)
input int    InpMinTradingDays = 3;        // Minimal hari trading per fase (FundingPips 2 Step Standard = 3)
input int    InpNewsMinutes  = 0;          // Tidak buka posisi X menit sebelum/sesudah berita USD berdampak tinggi (challenge 0, funded 5)

input group "Teknis"
input double InpXauMaxSpread = 0.60;       // Emas: lewati entry jika spread (harga) di atas ini
input double InpNasMaxSpread = 4.0;        // Nasdaq: lewati entry jika spread (poin) di atas ini
input long   InpXauMagic     = 20261102;   // Magic v1 XAU (sama dengan EA lama → jurnal v1 XAU)
input long   InpNasMagic     = 20261107;   // Magic v1 NAS (sama dengan EA lama → jurnal v1 NAS)
input int    InpXauSlippagePts = 30;       // Slippage maksimum emas (points)
input int    InpNasSlippagePts = 300;      // Slippage maksimum Nasdaq (points)
input string InpReportUrl    = "https://xauusd-research.vercel.app/api/ea/report"; // Alamat laporan website
input string InpEaKey        = "";         // Kunci EA dari website (Atur → EA). Kosong = tidak lapor
input int    InpTesterUtcOffset = 0;       // KHUSUS Strategy Tester: offset jam server − UTC. -99 = otomatis GMT+2/+3

//--- v1 XAU constants (volbreak-v5)
const double X_VOL_K   = 0.5;
const double X_SL_ATR  = 0.35;
const double X_BODY_MIN = 0.5;
//--- v1 NAS constants (nas-donchian-v1)
const int    N_DON_N   = 20;
const int    N_GAP     = 2;
const double N_SL_ATR  = 0.2;
const int    N_NY_FROM = 10, N_NY_TO = 16;
//--- shared
const double RR      = 2.0;
const int    H4_WIN  = 1000;
const int    D1_WIN  = 1000;
const int    ATR_WIN = 400;

CTrade tradeX, tradeN;
string XS, NS;

struct Bar { datetime t; double o, h, l, c; };

//====================================================================
// shared helpers
//====================================================================
bool UsDst(datetime t)
{
   MqlDateTime d; TimeToStruct(t, d);
   if(d.mon < 3 || d.mon > 11) return false;
   if(d.mon > 3 && d.mon < 11) return true;
   int firstSun = 1 + (7 - ((d.day_of_week - (d.day - 1) % 7) + 7) % 7) % 7;
   if(d.mon == 3) return d.day >= firstSun + 7;
   return d.day < firstSun;
}
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
double NyHour(long utc)
{
   long ny = utc - 5 * 3600;
   if(UsDst((datetime)ny)) ny += 3600;
   long s = ((ny % 86400) + 86400) % 86400;
   return s / 3600.0;
}
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
double EmaLast(const Bar &a[], int n, int len, int win)
{
   int s = MathMax(0, n - win);
   double alpha = 2.0 / (len + 1.0), e = a[s].c;
   for(int i = s + 1; i < n; i++) e = alpha * a[i].c + (1 - alpha) * e;
   return e;
}
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
//--- lot for a money risk and an SL distance (price) on `sym`, rounded DOWN to the volume step; 0 if below the broker minimum
double LotFor(string sym, double riskMoney, double dist)
{
   double tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tv <= 0) tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   double ts = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP), mn = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), mx = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(tv <= 0 || ts <= 0 || dist <= 0 || step <= 0 || riskMoney <= 0) return 0;
   double perLot = dist / ts * tv;
   double lot = MathFloor(riskMoney / perLot / step + 1e-9) * step;
   if(lot < mn) return 0;
   return MathMin(lot, mx);
}

//====================================================================
// reports to the website (journal + Telegram)
//====================================================================
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
void Info(string text, bool err)
{
   Print(text);
   StringReplace(text, "\"", "'");
   Report(StringFormat("{\"key\":\"%s\",\"event\":\"info\",\"text\":\"%s\",\"level\":\"%s\"}", InpEaKey, text, err ? "error" : "info"));
}

string gHistWarn = "";

//--- number of distinct server days with an entry deal on this account (any EA / manual)
int TradingDays()
{
   if(!HistorySelect(0, TimeCurrent() + 86400)) return -1;
   int days[]; int n = 0;
   for(int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      int day = (int)((long)HistoryDealGetInteger(d, DEAL_TIME) / 86400);
      bool seen = false;
      for(int k = 0; k < n; k++) if(days[k] == day) { seen = true; break; }
      if(!seen) { ArrayResize(days, n + 1); days[n++] = day; }
   }
   return n;
}

//====================================================================
// prop firm guard
//====================================================================
int    gDayKey = -1;
double gDayRef = 0;
bool   gTargetHit = false, gDayStop = false, gMaxStop = false;

bool   PropOn() { return InpAccountSize > 0; }
string PGv(string name) { return StringFormat("PROP_%I64d_%s", AccountInfoInteger(ACCOUNT_LOGIN), name); }
int    ServerDay() { return (int)((long)TimeTradeServer() / 86400); }

bool IsOurs(long magic) { return magic == InpXauMagic || magic == InpNasMagic; }

void CloseOurs(string why)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || !IsOurs(PositionGetInteger(POSITION_MAGIC))) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      CTrade t; t.SetExpertMagicNumber((ulong)PositionGetInteger(POSITION_MAGIC)); t.SetTypeFillingBySymbol(sym);
      t.SetDeviationInPoints(PositionGetInteger(POSITION_MAGIC) == InpNasMagic ? InpNasSlippagePts : InpXauSlippagePts);
      if(!t.PositionClose(tk)) PrintFormat("Gagal menutup posisi %I64u (%s): %d %s — TUTUP MANUAL!", tk, why, t.ResultRetcode(), t.ResultRetcodeDescription());
   }
}

//--- equity if every open position (all positions of the account) hits its SL now
double WorstEquity()
{
   double w = AccountInfoDouble(ACCOUNT_EQUITY);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      double sl = PositionGetDouble(POSITION_SL), vol = PositionGetDouble(POSITION_VOLUME);
      bool buy = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY;
      if(sl <= 0) continue;                                            // manual position without SL: cannot be measured
      double px = buy ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK), p = 0;
      if(OrderCalcProfit(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, sym, vol, px, sl, p) && p < 0) w += p;
   }
   return w;
}

//--- money that may still be risked on a new trade without the worst case crossing (limit − buffer)
double PropRoom()
{
   if(!PropOn()) return DBL_MAX;
   if(gTargetHit || gDayStop || gMaxStop) return 0;
   double w = WorstEquity();
   double dayFloor = gDayRef - InpAccountSize * (InpDailyLimitPct - InpBufferPct) / 100.0;
   double maxFloor = InpAccountSize * (1.0 - (InpMaxLossPct - InpBufferPct) / 100.0);
   return MathMin(w - dayFloor, w - maxFloor);
}

void PropUpdate()
{
   if(!PropOn()) return;
   double eq = AccountInfoDouble(ACCOUNT_EQUITY), bal = AccountInfoDouble(ACCOUNT_BALANCE);
   int d = ServerDay();
   if(d != gDayKey)
   {
      string k = PGv(StringFormat("dayref_%d", d));
      if(GlobalVariableCheck(k)) gDayRef = GlobalVariableGet(k);
      else { gDayRef = MathMax(bal, eq); GlobalVariableSet(k, gDayRef); }
      gDayKey = d;
      gDayStop = GlobalVariableCheck(PGv(StringFormat("daystop_%d", d)));
   }
   if(!gTargetHit && InpTargetPct > 0 && eq >= InpAccountSize * (1.0 + InpTargetPct / 100.0))
   {
      gTargetHit = true; GlobalVariableSet(PGv(StringFormat("target_%.0f", InpTargetPct)), 1);
      CloseOurs("target");
      int td = TradingDays();
      Info(StringFormat("PROP EA: TARGET %.1f%% TERCAPAI (equity %.2f). Semua posisi EA ditutup, EA berhenti membuka posisi. Hari trading: %d dari minimal %d%s", InpTargetPct, eq, td, InpMinTradingDays,
                        td >= InpMinTradingDays ? " - syarat hari terpenuhi." : " - BELUM cukup: buka 1 trade kecil manual (0,01 lot, langsung tutup) di hari-hari berikutnya sampai cukup."), false);
   }
   double maxLine = InpAccountSize * (1.0 - (InpMaxLossPct - InpBufferPct) / 100.0);
   if(!gMaxStop && eq <= maxLine)
   {
      gMaxStop = true;
      CloseOurs("rugi total");
      Info(StringFormat("PROP EA: equity %.2f menyentuh batas aman rugi total (%.2f = batas %.1f%% − buffer %.1f%%). Semua posisi EA ditutup, tidak ada entry baru.", eq, maxLine, InpMaxLossPct, InpBufferPct), true);
   }
   else if(gMaxStop && eq > maxLine + InpAccountSize * 0.005) gMaxStop = false;      // back above the line (e.g. deposit/reset)
   double dayLine = gDayRef - InpAccountSize * (InpDailyLimitPct - InpBufferPct) / 100.0;
   if(!gDayStop && eq <= dayLine)
   {
      gDayStop = true; GlobalVariableSet(PGv(StringFormat("daystop_%d", d)), 1);
      CloseOurs("rugi harian");
      Info(StringFormat("PROP EA: rugi hari ini mencapai batas aman (equity %.2f, awal hari %.2f, batas %.1f%% − buffer %.1f%%). Semua posisi EA ditutup, entry baru mulai lagi besok (hari server).", eq, gDayRef, InpDailyLimitPct, InpBufferPct), true);
   }
}

//--- high-impact USD news within InpNewsMinutes of now (MT5 economic calendar, server time). Not available in the Strategy Tester.
bool NewsNear(string &what)
{
   if(InpNewsMinutes <= 0 || MQLInfoInteger(MQL_TESTER)) return false;
   datetime now = TimeTradeServer();
   MqlCalendarValue v[];
   if(CalendarValueHistory(v, now - InpNewsMinutes * 60, now + InpNewsMinutes * 60, NULL, "USD") <= 0) return false;
   for(int i = 0; i < ArraySize(v); i++)
   {
      MqlCalendarEvent ev;
      if(CalendarEventById(v[i].event_id, ev) && ev.importance == CALENDAR_IMPORTANCE_HIGH) { what = ev.name; return true; }
   }
   return false;
}

//--- shared entry: spread check, risk (with prop room and margin), SL/TP, send
void OpenTrade(CTrade &t, string sym, int s, double sl, double maxSpread, string comment)
{
   string news = "";
   if(NewsNear(news)) { PrintFormat("%s: lewati, berita USD berdampak tinggi dalam %d menit (%s).", comment, InpNewsMinutes, news); return; }
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK), bid = SymbolInfoDouble(sym, SYMBOL_BID);
   if(ask - bid > maxSpread) { PrintFormat("%s: lewati, spread %.2f > %.2f", comment, ask - bid, maxSpread); return; }
   double price = s > 0 ? ask : bid;
   double dist = s * (price - sl);
   if(dist <= 0) { PrintFormat("%s: lewati, harga sudah melewati SL.", comment); return; }
   double tp = price + s * RR * dist;
   double base = PropOn() ? InpAccountSize : AccountInfoDouble(ACCOUNT_EQUITY);
   double risk = base * InpRiskPercent / 100.0;
   double room = PropRoom();
   if(room < risk)
   {
      if(room <= 0) { PrintFormat("%s: lewati, tidak ada ruang risiko (penjaga prop firm).", comment); return; }
      PrintFormat("%s: risiko dikecilkan %.2f → %.2f supaya rugi terburuk tidak melewati batas prop firm.", comment, risk, room);
      risk = room;
   }
   double lot = LotFor(sym, risk, dist);
   if(lot <= 0) { PrintFormat("%s: lewati, lot di bawah minimum broker (%.2f) untuk risiko %.2f dan jarak SL %.2f.", comment, SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), risk, dist); return; }
   // margin: shrink the lot if free margin is not enough (low prop-firm leverage)
   double mg = 0;
   if(OrderCalcMargin(s > 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, sym, lot, price, mg) && mg > 0)
   {
      double free = AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9;
      if(mg > free)
      {
         double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
         double l2 = MathFloor(lot * free / mg / step + 1e-9) * step;
         if(l2 < SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN)) { PrintFormat("%s: lewati, margin tidak cukup (butuh %.2f, bebas %.2f).", comment, mg, free / 0.9); return; }
         PrintFormat("%s: lot dikecilkan %.2f → %.2f karena margin (leverage) tidak cukup.", comment, lot, l2);
         lot = l2;
      }
   }
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   bool ok = s > 0 ? t.Buy(lot, sym, 0, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), comment)
                   : t.Sell(lot, sym, 0, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), comment);
   if(!ok) PrintFormat("%s: order gagal: %d %s", comment, t.ResultRetcode(), t.ResultRetcodeDescription());
}

//====================================================================
// v1 XAU (copy of XAU_v2_EA v1.14, symbol = XS)
//====================================================================
datetime gx_lastBar = 0;
long   gx_day = -1;
bool   gx_dayOk = false;
double gx_range = 0, gx_atr = 0, gx_d50 = 0, gx_d200 = 0, gx_lcd = 0;

string XGv(string kind, int side, long key) { return StringFormat("XAUv2_%I64d_%s_%d_%I64d", InpXauMagic, kind, side, key); }

bool XauUsedInBlock(int side, long blockStart, int off)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || PositionGetInteger(POSITION_MAGIC) != InpXauMagic || PositionGetString(POSITION_SYMBOL) != XS) continue;
      long tUtc = (long)PositionGetInteger(POSITION_TIME) - off;
      int s = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      if(s == side && tUtc >= blockStart) return true;
   }
   if(HistorySelect(TimeCurrent() - 6 * 3600, TimeCurrent() + 60))
      for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
      {
         ulong d = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(d, DEAL_MAGIC) != InpXauMagic || HistoryDealGetString(d, DEAL_SYMBOL) != XS) continue;
         if(HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
         long tUtc = (long)HistoryDealGetInteger(d, DEAL_TIME) - off;
         int s = HistoryDealGetInteger(d, DEAL_TYPE) == DEAL_TYPE_BUY ? 1 : -1;
         if(s == side && tUtc >= blockStart) return true;
      }
   return false;
}

void XauBreakeven()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || PositionGetInteger(POSITION_MAGIC) != InpXauMagic || PositionGetString(POSITION_SYMBOL) != XS) continue;
      double op = PositionGetDouble(POSITION_PRICE_OPEN), sl = PositionGetDouble(POSITION_SL), tp = PositionGetDouble(POSITION_TP);
      bool buy = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY;
      if(sl <= 0 || (buy ? sl >= op : sl <= op)) continue;
      double r = MathAbs(op - sl);
      double px = buy ? SymbolInfoDouble(XS, SYMBOL_BID) : SymbolInfoDouble(XS, SYMBOL_ASK);
      if(buy ? px >= op + r : px <= op - r)
      {
         int dg = (int)SymbolInfoInteger(XS, SYMBOL_DIGITS);
         if(tradeX.PositionModify(tk, NormalizeDouble(op, dg), tp)) PrintFormat("v1 XAU breakeven: SL posisi %I64u digeser ke entry %.2f", tk, op);
         else PrintFormat("v1 XAU breakeven gagal (%I64u): %d %s", tk, tradeX.ResultRetcode(), tradeX.ResultRetcodeDescription());
      }
   }
}

double AtrM15(const MqlRates &m[])
{
   int n = ArraySize(m);
   double e = -1;
   for(int i = n - 2; i >= 1; i--)
   {
      double tr = MathMax(m[i].high - m[i].low, MathMax(MathAbs(m[i].high - m[i + 1].close), MathAbs(m[i].low - m[i + 1].close)));
      e = e < 0 ? tr : e + (tr - e) / 14.0;
   }
   return e;
}

void XauCheck()
{
   datetime bar = iTime(XS, PERIOD_M15, 0);
   if(bar == 0 || bar == gx_lastBar) return;
   int off = UtcOffset();
   MqlRates m[];
   ArraySetAsSeries(m, true);
   if(CopyRates(XS, PERIOD_M15, 0, 200, m) < 100) return;          // data not ready yet: try again on the next timer
   gx_lastBar = bar;
   long sigUtc = (long)m[1].time - off;
   long dayStart = (sigUtc / 86400) * 86400;

   double dayOpen = 0;
   for(int i = 1; i < ArraySize(m); i++)
   {
      long t = (long)m[i].time - off;
      if(t < dayStart) break;
      dayOpen = m[i].open;
   }
   if(dayOpen <= 0) return;

   if(dayStart != gx_day)
   {
      gx_dayOk = false;
      MqlRates h1d[];
      ArraySetAsSeries(h1d, false);
      int nhd = CopyRates(XS, PERIOD_H1, 0, 26000, h1d);
      if(nhd < 5000) { Print("v1 XAU: riwayat H1 ", XS, " kurang (", nhd, ")", ". Buka chart ", XS, " H1 dan scroll ke kiri / Tools → Options → Charts → Max bars in chart = Unlimited."); return; }
      Bar d1[];
      int nd = BuildUtc(h1d, nhd, off, 86400, (datetime)dayStart, d1);
      if(nd < 210) return;
      int yi = nd - 1;
      while(yi > 0) { MqlDateTime dt; TimeToStruct(d1[yi].t, dt); if(dt.day_of_week != 0) break; yi--; }
      gx_range = d1[yi].h - d1[yi].l;
      gx_atr = AtrLast(d1, nd, 14, ATR_WIN);
      gx_d50 = EmaLast(d1, nd, 50, D1_WIN); gx_d200 = EmaLast(d1, nd, 200, D1_WIN); gx_lcd = d1[nd - 1].c;
      gx_day = dayStart;
      gx_dayOk = gx_range > 0 && gx_atr > 0;
   }
   if(!gx_dayOk) return;
   double range = gx_range, atr = gx_atr;
   double upL = dayOpen + X_VOL_K * range, dnL = dayOpen - X_VOL_K * range;

   bool crossUp = m[1].close > upL && m[2].close <= upL, crossDn = m[1].close < dnL && m[2].close >= dnL;
   if(!crossUp && !crossDn) return;

   MqlRates h1[];
   ArraySetAsSeries(h1, false);
   int nh = CopyRates(XS, PERIOD_H1, 0, 6000, h1);
   if(nh < 4100) { Print("v1 XAU: riwayat H1 ", XS, " kurang (", nh, ")."); return; }
   Bar h4[];
   int n4 = BuildUtc(h1, nh, off, 14400, (datetime)(sigUtc + 900), h4);
   if(n4 < 210) return;
   double e50 = EmaLast(h4, n4, 50, H4_WIN), e200 = EmaLast(h4, n4, 200, H4_WIN), lc4 = h4[n4 - 1].c;
   bool up = lc4 > e50 && e50 > e200 && gx_lcd > gx_d50;
   bool dn = lc4 < e50 && e50 < e200 && gx_lcd < gx_d50 && gx_d50 < gx_d200;

   long block = (sigUtc / 14400) * 14400;
   for(int s = 1; s >= -1; s -= 2)
   {
      double lv = s > 0 ? upL : dnL;
      bool cross = s > 0 ? crossUp : crossDn;
      if(!cross || !(s > 0 ? up : dn)) continue;
      if(XauUsedInBlock(s, block, off) || GlobalVariableCheck(XGv("blk", s, block))) continue;
      GlobalVariableSet(XGv("blk", s, block), 1);
      string gc = XGv("day", s, dayStart);
      double nth = (GlobalVariableCheck(gc) ? GlobalVariableGet(gc) : 0) + 1;
      GlobalVariableSet(gc, nth);
      string side = s > 0 ? "BUY" : "SELL";
      if(nth == 2) { PrintFormat("v1 XAU: lewati sinyal %s (sinyal ke-2 searah hari ini).", side); continue; }
      double a15 = AtrM15(m);
      if(!(MathAbs(m[1].close - m[1].open) >= X_BODY_MIN * a15)) { PrintFormat("v1 XAU: lewati sinyal %s, badan candle %.2f < %.1f x ATR M15 (%.2f).", side, MathAbs(m[1].close - m[1].open), X_BODY_MIN, a15); continue; }
      double sl = lv - s * X_SL_ATR * atr;
      PrintFormat("Sinyal v1 XAU %s: level %.2f, SL %.2f (ATR D1 %.2f, range %.2f)", side, lv, sl, atr, range);
      if(!InpTrade) break;
      OpenTrade(tradeX, XS, s, sl, InpXauMaxSpread, "v2");
      break;
   }
}

//====================================================================
// v1 NAS (copy of NAS_v1_EA v1.00, symbol = NS)
//====================================================================
datetime gn_lastH1 = 0;
string   gn_tk = "";
bool     gn_up = false, gn_dn = false;
double   gn_atr = 0;

string NGv(int side, long barTime) { return StringFormat("NASv1_%I64d_%d_%I64d", InpNasMagic, side, barTime); }

bool NasTrendAt(const MqlRates &h1[], int nh, int off, datetime nowUtc, bool &up, bool &dn, double &atr)
{
   Bar h4[], dall[];
   int n4 = BuildUtc(h1, nh, off, 14400, nowUtc, h4);
   int nda = BuildUtc(h1, nh, off, 86400, nowUtc, dall);
   if(n4 < 210 || nda < 1) { up = dn = false; atr = 0; return false; }
   string key = StringFormat("%I64d|%I64d", (long)h4[n4 - 1].t, (long)dall[nda - 1].t);
   if(key == gn_tk) { up = gn_up; dn = gn_dn; atr = gn_atr; return atr > 0; }
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
   gn_tk = key; gn_up = up; gn_dn = dn; gn_atr = atr;
   return atr > 0;
}

int NasAlignedBreakout(const MqlRates &h1[], int nh, int i, int off, double &atr)
{
   if(i < N_DON_N) return 0;
   double hh = -DBL_MAX, ll = DBL_MAX;
   for(int x = i - N_DON_N; x < i; x++) { hh = MathMax(hh, h1[x].high); ll = MathMin(ll, h1[x].low); }
   bool bu = h1[i].close > hh, bd = h1[i].close < ll;
   if(!bu && !bd) return 0;
   bool up, dn;
   datetime closeUtc = (datetime)((long)h1[i].time - off + 3600);
   if(!NasTrendAt(h1, i + 1, off, closeUtc, up, dn, atr)) return 0;
   if(bu && up) return 1;
   if(bd && dn) return -1;
   return 0;
}

void NasCheck()
{
   datetime bar = iTime(NS, PERIOD_H1, 0);
   if(bar == 0 || bar == gn_lastH1) return;
   int off = UtcOffset();
   MqlRates q[];
   ArraySetAsSeries(q, false);
   if(CopyRates(NS, PERIOD_H1, 1, N_DON_N + 1, q) < N_DON_N + 1) return;   // data not ready yet: try again on the next timer
   gn_lastH1 = bar;
   double qh = -DBL_MAX, ql = DBL_MAX;
   for(int x = 0; x < N_DON_N; x++) { qh = MathMax(qh, q[x].high); ql = MathMin(ql, q[x].low); }
   if(!(q[N_DON_N].close > qh) && !(q[N_DON_N].close < ql)) return;

   MqlRates h1[];
   ArraySetAsSeries(h1, false);
   int nh = CopyRates(NS, PERIOD_H1, 1, 26000, h1);
   if(nh < 5000) { Print("v1 NAS: riwayat H1 ", NS, " kurang (", nh, ")", ". Buka chart ", NS, " H1 dan scroll ke kiri / Tools → Options → Charts → Max bars in chart = Unlimited."); return; }
   int k = nh - 1;
   long closeUtc = (long)h1[k].time - off + 3600;

   double hh = -DBL_MAX, ll = DBL_MAX;
   for(int x = k - N_DON_N; x < k; x++) { hh = MathMax(hh, h1[x].high); ll = MathMin(ll, h1[x].low); }
   if(!(h1[k].close > hh) && !(h1[k].close < ll)) return;

   double atr = 0;
   int s = NasAlignedBreakout(h1, nh, k, off, atr);
   if(s == 0) return;
   double atrNow = atr;
   string side = s > 0 ? "BUY" : "SELL";
   int gap = 0;
   for(int g = 1; g <= N_GAP && gap == 0; g++) { double a2; if(NasAlignedBreakout(h1, nh, k - g, off, a2) == s) gap = g; }
   if(gap == 0) { PrintFormat("v1 NAS: breakout %s tanpa breakout searah 1–2 jam sebelumnya — lewati.", side); return; }
   double nyh = NyHour(closeUtc);
   if(!(nyh >= N_NY_FROM && nyh < N_NY_TO)) { PrintFormat("v1 NAS: sinyal %s di luar sesi New York (jam NY %.0f) — lewati.", side, MathFloor(nyh)); return; }
   if(GlobalVariableCheck(NGv(s, (long)h1[k].time))) return;
   GlobalVariableSet(NGv(s, (long)h1[k].time), 1);
   double sl = h1[k].close - s * N_SL_ATR * atrNow;
   PrintFormat("Sinyal v1 NAS %s: close %.2f menembus %s 20 candle (%.2f), lanjutan %d jam, SL %.2f (ATR D1 %.2f), jam NY %.0f",
               side, h1[k].close, s > 0 ? "high" : "low", s > 0 ? hh : ll, gap, sl, atrNow, MathFloor(nyh));
   if(!InpTrade) return;
   OpenTrade(tradeN, NS, s, sl, InpNasMaxSpread, "v1 NAS");
}

//====================================================================
// main
//====================================================================
bool CheckSymbol(string sym)
{
   if(!SymbolSelect(sym, true)) { Print("Simbol '", sym, "' tidak ada di broker ini. Cek nama simbol di Market Watch (klik kanan → Show All) lalu isi di pengaturan EA."); return false; }
   MqlRates r[]; CopyRates(sym, PERIOD_H1, 0, 26000, r);        // ask the terminal to load the history now
   CopyRates(sym, PERIOD_M15, 0, 200, r);
   return true;
}

void Status()
{
   if(MQLInfoInteger(MQL_TESTER)) return;
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   string s = StringFormat("PROP EA v1.00 | risiko %.2f%% | v1 XAU %s (%s) | v1 NAS %s (%s)\n", InpRiskPercent,
                           InpUseXau ? "ON" : "off", XS, InpUseNas ? "ON" : "off", NS);
   if(PropOn())
   {
      double tot = (eq - InpAccountSize) / InpAccountSize * 100.0, day = (eq - gDayRef) / InpAccountSize * 100.0;
      string st = gTargetHit ? "TARGET TERCAPAI — berhenti" : gMaxStop ? "REM RUGI TOTAL" : gDayStop ? "REM HARIAN (lanjut besok)" : "aktif";
      s += StringFormat("Akun %.0f | equity %.2f | total %+.2f%% (target %s, batas −%.1f%%) | hari ini %+.2f%% (batas −%.1f%%) | status: %s",
                        InpAccountSize, eq, tot, InpTargetPct > 0 ? StringFormat("+%.1f%%", InpTargetPct) : "mati", InpMaxLossPct, day, InpDailyLimitPct, st);
   }
   if(gHistWarn != "") s += "\n⚠ " + gHistWarn;
   Comment(s);
}

//--- the strategies need >= 5000 closed H1 candles of each symbol (checked every minute; shown on the chart)
datetime gHistAt = 0;
void HistCheck()
{
   if(TimeLocal() - gHistAt < 60) return;
   gHistAt = TimeLocal(); gHistWarn = "";
   int bx = InpUseXau ? Bars(XS, PERIOD_H1) : 99999, bn = InpUseNas ? Bars(NS, PERIOD_H1) : 99999;
   if(bx < 5000) gHistWarn = StringFormat("riwayat H1 %s baru %d candle (butuh 5000): v1 XAU belum bisa trading. Tools > Options > Charts > Max bars in chart = Unlimited, buka chart %s H1 dan scroll ke kiri", XS, bx, XS);
   if(bn < 5000) gHistWarn += (gHistWarn != "" ? "\n⚠ " : "") + StringFormat("riwayat H1 %s baru %d candle (butuh 5000): v1 NAS belum bisa trading. Buka chart %s H1 dan scroll ke kiri", NS, bn, NS);
}

//--- send the account balance to the website (Trade page, Forex): every minute with open positions, else every 15 minutes, and after each close
datetime gBalAt = 0;
void PushBalance()
{
   if(TimeLocal() - gBalAt < (PositionsTotal() > 0 ? 60 : 900)) return;   // every minute while positions are open, else every 15 min
   gBalAt = TimeLocal();
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY);
   Report(StringFormat("{\"key\":\"%s\",\"event\":\"balance\",\"source\":\"mt5\",\"wallet\":%.2f,\"upnl\":%.2f}", InpEaKey, bal, eq - bal));
}

void Run()
{
   PropUpdate();
   PushBalance();
   HistCheck();
   if(InpUseXau && InpTrade) XauBreakeven();
   if(InpUseXau) XauCheck();
   if(InpUseNas) NasCheck();
   Status();
}

int OnInit()
{
   XS = InpXauSymbol; NS = InpNasSymbol;
   if(InpUseXau && !CheckSymbol(XS)) return INIT_PARAMETERS_INCORRECT;
   if(InpUseNas && !CheckSymbol(NS)) return INIT_PARAMETERS_INCORRECT;
   tradeX.SetExpertMagicNumber(InpXauMagic); tradeX.SetDeviationInPoints(InpXauSlippagePts);
   tradeN.SetExpertMagicNumber(InpNasMagic); tradeN.SetDeviationInPoints(InpNasSlippagePts);
   if(InpUseXau) tradeX.SetTypeFillingBySymbol(XS);
   if(InpUseNas) tradeN.SetTypeFillingBySymbol(NS);
   if(PropOn()) gTargetHit = InpTargetPct > 0 && GlobalVariableCheck(PGv(StringFormat("target_%.0f", InpTargetPct)));
   if(StringLen(InpEaKey) < 10) Print("Info: Kunci EA kosong — tidak ada laporan ke website/Telegram.");
   PrintFormat("PROP EA aktif: v1 XAU %s (%s), v1 NAS %s (%s), risiko %.2f%%, akun %.0f, target %.1f%%, batas harian %.1f%%, total %.1f%%, buffer %.1f%%. Offset server-UTC %.1f jam.",
               InpUseXau ? "ON" : "off", XS, InpUseNas ? "ON" : "off", NS, InpRiskPercent, InpAccountSize, InpTargetPct, InpDailyLimitPct, InpMaxLossPct, InpBufferPct, UtcOffset() / 3600.0);
   if(gTargetHit) Print("Target fase ini sudah pernah tercapai di akun ini — EA tidak membuka posisi baru. (Fase berikutnya: ganti InpTargetPct.)");
   EventSetTimer(5);
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); Comment(""); }
void OnTick()  { Run(); }
void OnTimer() { Run(); }

void OnTradeTransaction(const MqlTradeTransaction &tx, const MqlTradeRequest &rq, const MqlTradeResult &rs)
{
   if(tx.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(tx.deal)) return;
   long magic = HistoryDealGetInteger(tx.deal, DEAL_MAGIC);
   if(!IsOurs(magic)) return;
   string strat = magic == InpNasMagic ? ",\"strategy\":\"nas\"" : "";
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
      Report(StringFormat("{\"key\":\"%s\"%s,\"event\":\"open\",\"ticket\":\"%I64d\",\"side\":\"%s\",\"price\":%.3f,\"sl\":%.3f,\"tp\":%.3f,\"lot\":%.2f,\"time\":%I64d}",
                          InpEaKey, strat, pos, side, price, sl, tp, vol, t));
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
      gBalAt = 0;                                                     // new balance on the next timer
      Report(StringFormat("{\"key\":\"%s\"%s,\"event\":\"close\",\"ticket\":\"%I64d\",\"side\":\"%s\",\"price\":%.3f,\"profit\":%.2f,\"reason\":\"%s\",\"lot\":%.2f,\"time\":%I64d}",
                          InpEaKey, strat, pos, side, price, profit, reason, vol, t));
   }
}
//+------------------------------------------------------------------+
