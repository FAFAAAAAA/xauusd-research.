-- Breakout v0.6. Safe to run more than once; the app also inserts it automatically.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('breakout', 'v0.6', 'breakout_v06', 'active', false,
  'v0.6: v0.5 inti (breakout H1 40 candle, New York, level H1 2-3x searah tren H4 EMA50/200 & D1) + candle yang menembus harus candle momentum (badan >= 1 ATR14).')
on conflict (strategy_key, version) do nothing;
