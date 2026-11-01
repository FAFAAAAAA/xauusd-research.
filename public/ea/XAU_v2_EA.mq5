//+------------------------------------------------------------------+
//| XAU_v2_EA.mq5 — v2 · Breakout volatilitas (sama dengan backtest   |
//| website, versi volbreak-v4). Untuk MetaTrader 5, simbol emas.      |
//|                                                                    |
//| Aturan (semua memakai hari UTC dan candle yang SUDAH TUTUP):       |
//|  Level hari ini = open hari ini ± 0,5 × range kemarin (high−low).  |
//|  Hari Senin (dan Minggu malam) memakai range JUMAT.                |
//|  BUY : close M15 menembus level atas dari bawah, tren naik.        |
//|  SELL: close M15 menembus level bawah dari atas, tren turun.       |
//|  Maks 1 entry per arah per blok 4 jam UTC (00/04/08/12/16/20).     |
//|  SL = level ∓ 0,35 × ATR14 D1. TP = 2 × jarak SL dari harga isi.   |
//|  Tren (aturan 1): BUY  jika close H4 > EMA50 > EMA200 (H4) dan     |
//|                        close D1 > EMA50 (D1)                       |
//|                   SELL jika close H4 < EMA50 < EMA200, close D1 <  |
//|                        EMA50 dan EMA50 D1 < EMA200 D1              |
//|  H4 & D1 dibentuk sendiri dari candle H1 dalam jam UTC (bukan jam  |
//|  server broker), supaya sama dengan backtest.                      |
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
input bool   InpTrade        = true;   // true = pasang order; false = hanya lapor sinyal ke log
input double InpMaxSpread    = 0.60;   // Lewati entry jika spread (harga) di atas ini
input long   InpMagic        = 20261102; // Magic number (pembeda posisi EA ini)
input string InpReportUrl    = "https://xauusd-research.vercel.app/api/ea/report"; // Alamat laporan website
input string InpEaKey        = "";     // Kunci EA dari website (Atur → EA)
input int    InpSlippagePts  = 30;     // Slippage maksimum (points)

const double VOL_K   = 0.5;
const double SL_ATR  = 0.35;
const double RR      = 2.0;
const int    H4_WIN  = 1000;   // jumlah candle H4 untuk EMA (sama dengan backtest)
const int    D1_WIN  = 1000;   // jumlah candle D1 untuk EMA
const int    ATR_WIN = 400;    // jumlah candle D1 untuk ATR

CTrade trade;
datetime g_lastBar = 0;

struct Bar { datetime t; double o, h, l, c; };

//--- server→UTC offset in seconds (broker server time minus GMT), rounded to 15 minutes
int UtcOffset()
{
   long d = (long)(TimeTradeServer() - TimeGMT());
   return (int)(MathRound(d / 900.0) * 900);
}

//--- build UTC candles of `periodSec` (14400 = H4, 86400 = D1) from H1 rates (only completed buckets before `nowUtc`)
int BuildUtc(const MqlRates &h1[], int n, int off, int periodSec, datetime nowUtc, Bar &out[])
{
   ArrayResize(out, 0);
   int k = -1; long cur = -1;
   for(int i = 0; i < n; i++)
   {
      long t = (long)h1[i].time - off;               // UTC open time of the H1 candle
      if(t + 3600 > (long)nowUtc) break;             // H1 candle not closed yet
      long b = (t / periodSec) * periodSec;
      if(b != cur)
      {
         cur = b; k++; ArrayResize(out, k + 1);
         out[k].t = (datetime)b; out[k].o = h1[i].open; out[k].h = h1[i].high; out[k].l = h1[i].low; out[k].c = h1[i].close;
      }
      else
      {
         out[k].h = MathMax(out[k].h, h1[i].high); out[k].l = MathMin(out[k].l, h1[i].low); out[k].c = h1[i].close;
      }
   }
   // drop the last bucket if it is not complete yet
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
//--- Wilder ATR as EWM(alpha=1/len) over the last `win` candles, seeded with the first true range
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

int OnInit()
{
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePts);
   if(StringLen(InpEaKey) < 10) Print("Peringatan: Kunci EA kosong — laporan ke website tidak akan diterima.");
   Print("XAU v2 EA aktif. Offset server-UTC: ", UtcOffset() / 3600.0, " jam.");
   return INIT_SUCCEEDED;
}

//--- was a v2 entry of this side already opened in this 4-hour UTC block? (positions + recent history, survives restarts)
bool UsedInBlock(int side, long blockStart, int off)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      long tUtc = (long)PositionGetInteger(POSITION_TIME) - off;
      int s = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      if(s == side && tUtc >= blockStart) return true;
   }
   if(HistorySelect(TimeCurrent() - 6 * 3600, TimeCurrent() + 60))
      for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
      {
         ulong d = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(d, DEAL_MAGIC) != InpMagic || HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
         if(HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
         long tUtc = (long)HistoryDealGetInteger(d, DEAL_TIME) - off;
         int s = HistoryDealGetInteger(d, DEAL_TYPE) == DEAL_TYPE_BUY ? 1 : -1;
         if(s == side && tUtc >= blockStart) return true;
      }
   return false;
}

//--- lot for a $ risk and an SL distance (price), rounded DOWN to the volume step
double LotFor(double riskMoney, double dist)
{
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tv <= 0) tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), mn = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), mx = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(tv <= 0 || ts <= 0 || dist <= 0 || step <= 0) return 0;
   double perLot = dist / ts * tv;                    // money lost per 1.00 lot if SL is hit
   double lot = MathFloor(riskMoney / perLot / step) * step;
   if(lot < mn) return 0;                             // below the broker minimum: skip (never risk more than planned)
   return MathMin(lot, mx);
}

void OnTick()
{
   datetime bar = iTime(_Symbol, PERIOD_M15, 0);
   if(bar == 0 || bar == g_lastBar) return;          // run once, on the first tick of a new M15 candle
   g_lastBar = bar;

   int off = UtcOffset();
   datetime nowUtc = (datetime)((long)TimeTradeServer() - off);

   // closed M15 candles: [1] = just closed (signal candle), [2] = the one before
   MqlRates m[];
   ArraySetAsSeries(m, true);
   if(CopyRates(_Symbol, PERIOD_M15, 0, 200, m) < 100) return;
   long sigUtc = (long)m[1].time - off;
   long dayStart = (sigUtc / 86400) * 86400;

   // today's open = open of the first M15 candle of the UTC day
   double dayOpen = 0;
   for(int i = 1; i < ArraySize(m); i++)
   {
      long t = (long)m[i].time - off;
      if(t < dayStart) break;
      dayOpen = m[i].open;
   }
   if(dayOpen <= 0) return;

   // H4 and D1 in UTC, built from H1
   MqlRates h1[];
   ArraySetAsSeries(h1, false);
   int nh = CopyRates(_Symbol, PERIOD_H1, 0, 26000, h1);
   if(nh < 5000) { Print("Riwayat H1 kurang (", nh, "). Scroll chart H1 ke kiri / tambah Max bars in chart."); return; }
   Bar h4[], d1[];
   datetime sigClose = (datetime)(sigUtc + 900);
   int n4 = BuildUtc(h1, nh, off, 14400, sigClose, h4);
   int nd = BuildUtc(h1, nh, off, 86400, (datetime)dayStart, d1);   // days completed before today
   if(n4 < 210 || nd < 210) return;

   // trend (aturan 1)
   double e50 = EmaLast(h4, n4, 50, H4_WIN), e200 = EmaLast(h4, n4, 200, H4_WIN), lc4 = h4[n4 - 1].c;
   double d50 = EmaLast(d1, nd, 50, D1_WIN), d200 = EmaLast(d1, nd, 200, D1_WIN), lcd = d1[nd - 1].c;
   bool up = lc4 > e50 && e50 > e200 && lcd > d50;
   bool dn = lc4 < e50 && e50 < e200 && lcd < d50 && d50 < d200;

   // yesterday = last completed UTC day that is not Sunday
   int yi = nd - 1;
   while(yi > 0) { MqlDateTime dt; TimeToStruct(d1[yi].t, dt); if(dt.day_of_week != 0) break; yi--; }
   double range = d1[yi].h - d1[yi].l;
   double atr = AtrLast(d1, nd, 14, ATR_WIN);
   if(range <= 0 || atr <= 0) return;
   double upL = dayOpen + VOL_K * range, dnL = dayOpen - VOL_K * range;

   long block = (sigUtc / 14400) * 14400;
   for(int s = 1; s >= -1; s -= 2)
   {
      double lv = s > 0 ? upL : dnL;
      bool cross = s * (m[1].close - lv) > 0 && s * (m[2].close - lv) <= 0;
      if(!cross || !(s > 0 ? up : dn)) continue;
      if(UsedInBlock(s, block, off)) continue;
      double sl = lv - s * SL_ATR * atr;
      string side = s > 0 ? "BUY" : "SELL";
      PrintFormat("Sinyal v2 %s: level %.2f, SL %.2f (ATR D1 %.2f, range %.2f)", side, lv, sl, atr, range);
      if(!InpTrade) break;
      double spread = SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(spread > InpMaxSpread) { PrintFormat("Lewati: spread %.2f > %.2f", spread, InpMaxSpread); break; }
      double price = s > 0 ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double dist = s * (price - sl);
      if(dist <= 0) { Print("Lewati: harga sudah melewati SL."); break; }
      double tp = price + s * RR * dist;
      double lot = LotFor(AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPercent / 100.0, dist);
      if(lot <= 0) { PrintFormat("Lewati: lot di bawah minimum broker untuk risiko %.2f%% dan jarak SL %.2f.", InpRiskPercent, dist); break; }
      int dg = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
      bool ok = s > 0 ? trade.Buy(lot, _Symbol, 0, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), "v2")
                      : trade.Sell(lot, _Symbol, 0, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), "v2");
      if(!ok) PrintFormat("Order gagal: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
      break;                                          // one signal per candle (like the backtest)
   }
}

//--- report entries and exits to the website
void Report(string json)
{
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
   long t = (long)HistoryDealGetInteger(tx.deal, DEAL_TIME) - UtcOffset();   // UTC seconds
   double price = HistoryDealGetDouble(tx.deal, DEAL_PRICE), vol = HistoryDealGetDouble(tx.deal, DEAL_VOLUME);
   long dtype = HistoryDealGetInteger(tx.deal, DEAL_TYPE);
   if(entry == DEAL_ENTRY_IN)
   {
      double sl = 0, tp = 0;
      if(PositionSelectByTicket(pos)) { sl = PositionGetDouble(POSITION_SL); tp = PositionGetDouble(POSITION_TP); }
      string side = dtype == DEAL_TYPE_BUY ? "BUY" : "SELL";
      Report(StringFormat("{\"key\":\"%s\",\"event\":\"open\",\"ticket\":\"%I64d\",\"side\":\"%s\",\"price\":%.3f,\"sl\":%.3f,\"tp\":%.3f,\"lot\":%.2f,\"time\":%I64d}",
                          InpEaKey, pos, side, price, sl, tp, vol, t));
   }
   else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
   {
      double profit = HistoryDealGetDouble(tx.deal, DEAL_PROFIT) + HistoryDealGetDouble(tx.deal, DEAL_SWAP) + HistoryDealGetDouble(tx.deal, DEAL_COMMISSION);
      // add the entry deal's commission (charged at entry by many brokers)
      if(HistorySelectByPosition(pos))
         for(int i = 0; i < HistoryDealsTotal(); i++)
         {
            ulong d = HistoryDealGetTicket(i);
            if(HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN) profit += HistoryDealGetDouble(d, DEAL_COMMISSION);
         }
      long why = HistoryDealGetInteger(tx.deal, DEAL_REASON);
      string reason = why == DEAL_REASON_TP ? "tp" : why == DEAL_REASON_SL ? "sl" : "manual";
      string side = dtype == DEAL_TYPE_SELL ? "BUY" : "SELL";       // closing deal is opposite to the position
      Report(StringFormat("{\"key\":\"%s\",\"event\":\"close\",\"ticket\":\"%I64d\",\"side\":\"%s\",\"price\":%.3f,\"profit\":%.2f,\"reason\":\"%s\",\"lot\":%.2f,\"time\":%I64d}",
                          InpEaKey, pos, side, price, profit, reason, vol, t));
   }
}
//+------------------------------------------------------------------+
