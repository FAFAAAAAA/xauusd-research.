-- Breakout v0.2 (research 2018-2026). Safe to run more than once; the app also inserts it automatically.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('breakout', 'v0.2', 'breakout_v02', 'active', false,
  'v0.2 hasil riset 2018-2026: breakout H1 (40 candle) + breakout sesi London & New York, hanya searah tren H4 & D1, BUY dan SELL. SL ATR/range, TP sesuai RR.')
on conflict (strategy_key, version) do nothing;
