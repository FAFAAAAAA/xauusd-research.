-- SNR breakout H1 v1. Safe to run more than once; the app also inserts it automatically.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('snr_break', 'h1-v1', 'snr_break_h1_v1', 'active', false,
  'SNR breakout H1 tanpa tren H4: level = swing high/low H1 terakhir (pivot 3), entry di open M15 berikutnya saat candle H1 close menembus level (pertama kali), BUY dan SELL, SL = level -/+ 1.5 ATR(14) H1.')
on conflict (strategy_key, version) do nothing;
