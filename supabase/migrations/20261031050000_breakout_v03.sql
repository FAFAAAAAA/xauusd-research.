-- Breakout v0.3. Safe to run more than once; the app also inserts it automatically.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('breakout', 'v0.3', 'breakout_v03', 'active', false,
  'v0.3: breakout H1 (40) + London + New York + M30 (10), searah tren H4 & D1. SELL hanya jika EMA50 D1 < EMA200 D1. SL ATR/range, TP sesuai RR.')
on conflict (strategy_key, version) do nothing;
