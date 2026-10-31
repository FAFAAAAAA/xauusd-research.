-- RBR/DBD v1. Safe to run more than once; the app also inserts it automatically.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('rbr_dbd', 'v1', 'rbr_dbd_v1', 'active', false,
  'RBR/DBD: zona base H1 (1-3 candle kecil <= 0.5 ATR) di antara dua dorongan searah >= 1 ATR, zona masih segar, entry candle penolakan M15 saat harga kembali ke base, searah tren H4 EMA50/200, SL di luar base + 0.1 ATR, 1 trade per zona.')
on conflict (strategy_key, version) do nothing;
