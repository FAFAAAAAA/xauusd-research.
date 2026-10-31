-- Order Block + FVG v1. Safe to run more than once; the app also inserts it automatically.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('ob_fvg', 'v1', 'ob_fvg_v1', 'active', false,
  'Order Block + FVG H1 (SMC): FVG >= 0.3 ATR dengan break of structure, entry saat harga pertama kali kembali ke FVG, SL di luar order block + 0.1 ATR, searah tren H4 EMA50/200 & D1.')
on conflict (strategy_key, version) do nothing;
