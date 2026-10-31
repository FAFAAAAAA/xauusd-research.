-- Breakout v0.5 inti. Safe to run more than once; the app also inserts it automatically.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('breakout', 'v0.5', 'breakout_v05', 'active', false,
  'v0.5 inti: breakout H1 (40 candle) + New York + tembus level swing H1 yang disentuh 2-3 kali, searah tren H4 EMA50/200 & D1; SELL hanya jika EMA50 D1 < EMA200 D1.')
on conflict (strategy_key, version) do nothing;
