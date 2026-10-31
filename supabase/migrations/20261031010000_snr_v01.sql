-- SNR H4/H1 -> M15 strategy v0.1 (DRAFT). Safe to run more than once.
-- The app also inserts this row automatically (ensureBuiltinStrategies), so running this file is optional.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('snr', 'h4h1m15-v0.1', 'snr_h4h1_m15', 'active', false,
  'DRAF v0.1: tren H4 (struktur swing), zona SNR H4+H1, entry M15 saat sentuh zona, SL luar zona + 0.5 ATR(14) M15, TP diuji RR 1/2/3. Belum terbukti profit.')
on conflict (strategy_key, version) do nothing;
