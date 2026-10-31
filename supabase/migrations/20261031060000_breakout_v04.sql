-- Breakout v0.4. Safe to run more than once; the app also inserts it automatically.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('breakout', 'v0.4', 'breakout_v04', 'active', false,
  'v0.4: v0.3 (breakout H1, London, New York, M30 searah tren H4 & D1; SELL hanya jika EMA50 D1 < EMA200 D1) + tembus level swing H1 yang sudah disentuh 2-3 kali, SL level -/+ 1.5 ATR H1.')
on conflict (strategy_key, version) do nothing;
