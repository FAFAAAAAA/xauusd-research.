-- Breakout v0.8. Safe to run more than once; the app also inserts it automatically.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('breakout', 'v0.8', 'breakout_v08', 'active', false,
  'v0.8: v0.7 tanpa perubahan + Breakout Base: base >= 3 candle (overlap >= 50%, tinggi <= 1.5 ATR) di H4 (breakout jam 07-17 UTC) dan H1 (harga sebelumnya sudah bergerak >= 1 ATR searah), entry close M15 keluar base, SL batas base -/+ 0.3 ATR, filter tren EMA50/200 H4 (SELL juga D1); tiap bagian slot sendiri.')
on conflict (strategy_key, version) do nothing;
