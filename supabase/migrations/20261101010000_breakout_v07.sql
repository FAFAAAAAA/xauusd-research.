-- Breakout v0.7. Safe to run more than once; the app also inserts it automatically.
insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values ('breakout', 'v0.7', 'breakout_v07', 'active', false,
  'v0.7: v0.6 tanpa perubahan + Pola N (A-B-C di H1 dan H4, swing = pantulan 3 ATR, C lebih tinggi/rendah dari A, entry close M15 tembus B, SL di C, BUY: EMA50 H4 > EMA200; SELL: EMA50 < EMA200 di H4 dan D1) dengan slot sendiri.')
on conflict (strategy_key, version) do nothing;
