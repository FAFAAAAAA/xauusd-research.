-- =====================================================================
-- XAUUSD Trading Research System — initial schema
-- Target: a NEW, dedicated Supabase project (PostgreSQL 15+).
-- All timestamps are stored in UTC (timestamptz).
-- Access model: the app connects server-side with the database
-- connection string (postgres role). RLS is enabled on every table and
-- NO policies are granted to anon/authenticated, so the public anon key
-- cannot read or write anything (including Telegram secrets).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enumerations as CHECK constraints (easier to extend than enum types)
-- ---------------------------------------------------------------------
-- timeframe: M1 M5 M15 M30 H1 H4 D1
-- mode:      LIVE | BACKTEST

-- 1. instruments -------------------------------------------------------
create table if not exists instruments (
  id            uuid primary key default gen_random_uuid(),
  symbol        text not null unique,
  description   text,
  price_digits  int  not null default 2,
  created_at    timestamptz not null default now()
);

-- 2. market_data_sources -----------------------------------------------
create table if not exists market_data_sources (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  provider          text not null,               -- e.g. "Dukascopy", "OANDA", "TradingView export (OANDA:XAUUSD)"
  kind              text not null check (kind in ('csv_import','api','tradingview_export')),
  broker_symbol     text,                         -- e.g. "OANDA:XAUUSD"
  file_timezone     text not null default 'UTC',  -- timezone the raw file was written in
  price_basis       text not null default 'bid' check (price_basis in ('bid','ask','mid','last','unknown')),
  spread_spec       jsonb not null default '{}'::jsonb, -- e.g. {"type":"fixed","points":0.25}
  notes             text,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now()
);

-- import bookkeeping (extra)
create table if not exists import_batches (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('ohlc','economic_events','news_articles','indicator_events','strategy_report')),
  source_id      uuid references market_data_sources(id) on delete set null,
  filename       text,
  rows_total     int not null default 0,
  rows_inserted  int not null default 0,
  rows_skipped   int not null default 0,
  errors         jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);

-- 3. historical_candles ------------------------------------------------
create table if not exists historical_candles (
  source_id      uuid not null references market_data_sources(id) on delete cascade,
  instrument_id  uuid not null references instruments(id) on delete cascade,
  timeframe      text not null check (timeframe in ('M1','M5','M15','M30','H1','H4','D1')),
  open_time      timestamptz not null,
  open           numeric(14,4) not null,
  high           numeric(14,4) not null,
  low            numeric(14,4) not null,
  close          numeric(14,4) not null,
  volume         numeric(20,4),
  import_batch_id uuid references import_batches(id) on delete set null,
  primary key (source_id, timeframe, open_time),
  constraint candle_ohlc_valid check (
    high >= low and high >= open and high >= close and low <= open and low <= close and low > 0
  )
);
create index if not exists idx_candles_instr_tf_time on historical_candles (instrument_id, timeframe, open_time);

-- 4. strategy_versions -------------------------------------------------
create table if not exists strategy_versions (
  id             uuid primary key default gen_random_uuid(),
  strategy_key   text not null,
  version        text not null,
  adapter_key    text not null,                -- maps to a registered StrategyAdapter in code
  status         text not null default 'draft' check (status in ('draft','active','retired')),
  is_test        boolean not null default false,
  description    text,
  created_at     timestamptz not null default now(),
  unique (strategy_key, version)
);

-- 5. strategy_settings -------------------------------------------------
create table if not exists strategy_settings (
  id                  uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references strategy_versions(id) on delete cascade,
  mode                text not null check (mode in ('LIVE','BACKTEST')),
  params              jsonb not null default '{}'::jsonb,
  active              boolean not null default false,
  updated_at          timestamptz not null default now(),
  unique (strategy_version_id, mode)
);

-- replay_sessions is referenced by several tables, create it early ----
-- 9. replay_sessions ---------------------------------------------------
create table if not exists backtest_sessions (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  strategy_version_id  uuid references strategy_versions(id) on delete set null,
  source_id            uuid references market_data_sources(id) on delete set null,
  instrument_id        uuid references instruments(id) on delete set null,
  timeframe            text check (timeframe in ('M1','M5','M15','M30','H1','H4','D1')),
  period_start         timestamptz,
  period_end           timestamptz,
  confirmation_profile text not null default 'snr_only'
                       check (confirmation_profile in ('snr_only','snr_news','snr_trend_momentum','snr_all')),
  cost_config          jsonb not null default '{}'::jsonb, -- spread, commission, slippage, ambiguity policy
  status               text not null default 'created' check (status in ('created','running','completed','failed')),
  is_test              boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);

create table if not exists replay_sessions (
  id                   uuid primary key default gen_random_uuid(),
  backtest_session_id  uuid references backtest_sessions(id) on delete set null,
  source_id            uuid not null references market_data_sources(id) on delete cascade,
  instrument_id        uuid not null references instruments(id) on delete cascade,
  strategy_version_id  uuid references strategy_versions(id) on delete set null,
  timeframe            text not null check (timeframe in ('M1','M5','M15','M30','H1','H4','D1')),
  start_time           timestamptz not null,      -- first candle revealed is the last one whose open_time <= start_time
  cursor_time          timestamptz,               -- open_time of the last revealed candle (null = nothing revealed yet)
  status               text not null default 'ready' check (status in ('ready','playing','paused','finished')),
  speed                int  not null default 1 check (speed in (1,2,5,10)),
  telegram_enabled     boolean not null default false,  -- default OFF, must be enabled explicitly
  resend_policy        text not null default 'never' check (resend_policy in ('never','new_run')),
  run_number           int  not null default 1,
  candles_processed    int  not null default 0,
  strategy_params      jsonb not null default '{}'::jsonb,
  strategy_state       jsonb not null default '{}'::jsonb,  -- persisted between steps (edge-triggering etc.)
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_replay_created on replay_sessions (created_at desc);

-- 6. snr_zones ---------------------------------------------------------
create table if not exists snr_zones (
  id                   uuid primary key default gen_random_uuid(),
  instrument_id        uuid not null references instruments(id) on delete cascade,
  mode                 text not null check (mode in ('LIVE','BACKTEST')),
  timeframe            text check (timeframe in ('M1','M5','M15','M30','H1','H4','D1')),
  kind                 text not null default 'unknown' check (kind in ('support','resistance','unknown')),
  price_low            numeric(14,4) not null,
  price_high           numeric(14,4) not null,
  origin               text not null check (origin in ('manual','tradingview','strategy','test')),
  valid_from           timestamptz not null,       -- when the zone became KNOWN (anti-lookahead)
  valid_until          timestamptz,
  strategy_version_id  uuid references strategy_versions(id) on delete set null,
  replay_session_id    uuid references replay_sessions(id) on delete cascade,
  is_test              boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  check (price_low <= price_high)
);
create index if not exists idx_zones_valid on snr_zones (instrument_id, mode, valid_from);

-- 7. market_events -----------------------------------------------------
create table if not exists market_events (
  id                    uuid primary key default gen_random_uuid(),
  mode                  text not null check (mode in ('LIVE','BACKTEST')),
  event_uid             text not null,              -- id from TradingView or engine
  dedupe_key            text not null unique,       -- prevents duplicates per mode/session/run
  instrument_id         uuid not null references instruments(id) on delete cascade,
  timeframe             text not null check (timeframe in ('M1','M5','M15','M30','H1','H4','D1')),
  event_type            text not null check (event_type in ('SNR_NEAR','SNR_TOUCH','SNR_BREAKOUT','SNR_RETEST','SETUP_CONFIRMED','SETUP_INVALIDATED')),
  event_time            timestamptz not null,       -- MARKET time the event became true (candle close)
  received_at           timestamptz not null default now(),
  price                 numeric(14,4) not null,
  zone_low              numeric(14,4),
  zone_high             numeric(14,4),
  zone_kind             text check (zone_kind in ('support','resistance','unknown')),
  zone_id               uuid references snr_zones(id) on delete set null,
  strategy_version_id   uuid references strategy_versions(id) on delete set null,
  strategy_version_label text not null,
  source                text not null check (source in ('tradingview_webhook','replay_engine','tradingview_csv')),
  replay_session_id     uuid references replay_sessions(id) on delete cascade,
  backtest_session_id   uuid references backtest_sessions(id) on delete set null,
  run_number            int,
  confirmations         jsonb not null default '{}'::jsonb,
  payload               jsonb not null default '{}'::jsonb,
  is_test               boolean not null default false,
  -- LIVE and BACKTEST are strictly separated
  constraint live_has_no_replay check (mode = 'BACKTEST' or (replay_session_id is null and backtest_session_id is null)),
  constraint live_source check (mode = 'BACKTEST' or source = 'tradingview_webhook'),
  constraint zone_order check (zone_low is null or zone_high is null or zone_low <= zone_high)
);
create index if not exists idx_events_mode_time on market_events (mode, event_time desc);
create index if not exists idx_events_replay on market_events (replay_session_id, event_time);

-- 10. simulated_trades --------------------------------------------------
create table if not exists simulated_trades (
  id                   uuid primary key default gen_random_uuid(),
  backtest_session_id  uuid references backtest_sessions(id) on delete cascade,
  replay_session_id    uuid references replay_sessions(id) on delete set null,
  strategy_version_id  uuid references strategy_versions(id) on delete set null,
  entry_event_id       uuid references market_events(id) on delete set null,
  origin               text not null check (origin in ('engine','tradingview_import')),
  side                 text not null check (side in ('long','short')),
  timeframe            text check (timeframe in ('M1','M5','M15','M30','H1','H4','D1')),
  entry_time           timestamptz not null,
  entry_price          numeric(14,4) not null,
  stop_loss            numeric(14,4),
  take_profit          numeric(14,4),
  exit_time            timestamptz,
  exit_price           numeric(14,4),
  exit_reason          text check (exit_reason in ('tp','sl','ambiguous_worst','ambiguous_best','ambiguous_skipped','time','manual','imported','open')),
  pnl                  numeric(16,4),
  pnl_r                numeric(10,4),
  planned_rr           numeric(10,4),
  session_label        text check (session_label in ('asia','london','new_york','off')),
  news_confirmed       boolean,
  sentiment_confirmed  boolean,
  zone_outcome         text check (zone_outcome in ('respect','breakout','unknown')),
  setup_reason         jsonb not null default '{}'::jsonb,
  costs                jsonb not null default '{}'::jsonb,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now()
);
create index if not exists idx_trades_session_time on simulated_trades (backtest_session_id, entry_time);

-- 11. economic_events ---------------------------------------------------
create table if not exists economic_events (
  id                     uuid primary key default gen_random_uuid(),
  provider               text not null,
  external_id            text not null,
  title                  text not null,
  category               text not null check (category in ('FOMC','US_CPI','US_PCE','NFP','UNEMPLOYMENT','US_TREASURY_YIELD','DXY','GEOPOLITICAL','GOLD_NEWS','OTHER')),
  currency               text,
  impact                 text not null default 'unknown' check (impact in ('low','medium','high','unknown')),
  scheduled_at           timestamptz not null,     -- official release time
  schedule_available_at  timestamptz,              -- when the schedule itself was known (null = assume known)
  forecast               numeric(18,6),
  previous               numeric(18,6),
  actual                 numeric(18,6),
  actual_available_at    timestamptz,              -- when ACTUAL was first available (anti-lookahead)
  unit                   text,
  source_url             text,
  is_test                boolean not null default false,
  created_at             timestamptz not null default now(),
  unique (provider, external_id),
  check (actual is null or actual_available_at is not null)
);
create index if not exists idx_econ_scheduled on economic_events (scheduled_at);

-- 12. news_articles ------------------------------------------------------
create table if not exists news_articles (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null,
  external_id    text not null,
  title          text not null,
  source_name    text not null,
  category       text not null default 'OTHER' check (category in ('FOMC','US_CPI','US_PCE','NFP','UNEMPLOYMENT','US_TREASURY_YIELD','DXY','GEOPOLITICAL','GOLD_NEWS','OTHER')),
  published_at   timestamptz not null,
  first_seen_at  timestamptz,                  -- when our system / the archive first captured it
  available_at   timestamptz generated always as (greatest(published_at, coalesce(first_seen_at, published_at))) stored,
  url            text,
  summary        text,
  is_test        boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (provider, external_id)
);
create index if not exists idx_news_available on news_articles (available_at);

-- 13. sentiment_analyses -------------------------------------------------
create table if not exists sentiment_analyses (
  id                 uuid primary key default gen_random_uuid(),
  economic_event_id  uuid references economic_events(id) on delete cascade,
  news_article_id    uuid references news_articles(id) on delete cascade,
  label              text not null check (label in ('Bullish','Bearish','Neutral','Mixed','Unknown')),
  confidence         numeric(4,3) check (confidence between 0 and 1),
  reasoning          text not null,
  method             text not null,           -- e.g. rule_surprise_v0, manual
  available_at       timestamptz not null,    -- never earlier than the input data it used
  created_at         timestamptz not null default now(),
  check ((economic_event_id is not null)::int + (news_article_id is not null)::int = 1)
);
create unique index if not exists uq_sentiment_econ on sentiment_analyses (economic_event_id, method) where economic_event_id is not null;
create unique index if not exists uq_sentiment_news on sentiment_analyses (news_article_id, method) where news_article_id is not null;

-- 14. event_news_links ---------------------------------------------------
create table if not exists event_news_links (
  id                  uuid primary key default gen_random_uuid(),
  market_event_id     uuid not null references market_events(id) on delete cascade,
  economic_event_id   uuid references economic_events(id) on delete cascade,
  news_article_id     uuid references news_articles(id) on delete cascade,
  relation            text not null default 'related_by_time' check (relation in ('related_by_time')),
  info_available_at   timestamptz not null,
  time_delta_seconds  int not null,           -- event_time - info time (>= 0 means info was known before the event)
  created_at          timestamptz not null default now(),
  check ((economic_event_id is not null)::int + (news_article_id is not null)::int = 1)
);
create unique index if not exists uq_link_econ on event_news_links (market_event_id, economic_event_id) where economic_event_id is not null;
create unique index if not exists uq_link_news on event_news_links (market_event_id, news_article_id) where news_article_id is not null;

-- 15. tradingview_webhook_logs -------------------------------------------
create table if not exists tradingview_webhook_logs (
  id               uuid primary key default gen_random_uuid(),
  received_at      timestamptz not null default now(),
  remote_ip        text,
  status           text not null check (status in ('accepted','duplicate','rejected_auth','rejected_validation','rate_limited','error')),
  http_status      int not null,
  event_uid        text,
  market_event_id  uuid references market_events(id) on delete set null,
  error            text,
  payload          jsonb                       -- secret is redacted before storing
);
create index if not exists idx_tvlogs_time on tradingview_webhook_logs (received_at desc);
create index if not exists idx_tvlogs_ip_time on tradingview_webhook_logs (remote_ip, received_at desc);

-- 16. telegram_settings (single row, NEVER exposed to the browser) -------
create table if not exists telegram_settings (
  id                   int primary key default 1 check (id = 1),
  chat_id              text,
  bot_token_encrypted  text,                  -- AES-256-GCM, key lives only in server env (APP_ENCRYPTION_KEY)
  bot_token_hint       text,                  -- e.g. "1234…wxyz", safe to show
  live_enabled         boolean not null default false,
  backtest_enabled     boolean not null default false,   -- default OFF
  cooldown_seconds     int not null default 300 check (cooldown_seconds >= 0),
  max_per_minute       int not null default 20 check (max_per_minute between 1 and 60),
  last_test_at         timestamptz,
  last_test_ok         boolean,
  last_test_error      text,
  updated_at           timestamptz not null default now()
);

-- 17. telegram_delivery_logs ----------------------------------------------
create table if not exists telegram_delivery_logs (
  id                   uuid primary key default gen_random_uuid(),
  delivery_key         text not null unique,   -- idempotency key, prevents double sends
  mode                 text not null check (mode in ('LIVE','BACKTEST','TEST')),
  market_event_id      uuid references market_events(id) on delete set null,
  replay_session_id    uuid references replay_sessions(id) on delete set null,
  status               text not null check (status in ('pending','sent','failed','skipped')),
  skip_reason          text,
  attempts             int not null default 0,
  http_status          int,
  telegram_message_id  bigint,
  error                text,
  message_text         text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  sent_at              timestamptz
);
create index if not exists idx_tglogs_time on telegram_delivery_logs (created_at desc);

-- 18. system_errors -------------------------------------------------------
create table if not exists system_errors (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  scope        text not null,
  message      text not null,
  details      jsonb not null default '{}'::jsonb
);
create index if not exists idx_errors_time on system_errors (occurred_at desc);

-- app_settings (extra: timezone, replay defaults, providers) --------------
create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Security: RLS on, no policies for anon/authenticated.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'instruments','market_data_sources','import_batches','historical_candles','strategy_versions',
    'strategy_settings','backtest_sessions','replay_sessions','snr_zones','market_events',
    'simulated_trades','economic_events','news_articles','sentiment_analyses','event_news_links',
    'tradingview_webhook_logs','telegram_settings','telegram_delivery_logs','system_errors','app_settings'
  ] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Seed rows (infrastructure only — NO market data, NO strategy rules)
-- ---------------------------------------------------------------------
insert into instruments (symbol, description, price_digits)
values ('XAUUSD', 'Gold vs US Dollar (spot)', 2)
on conflict (symbol) do nothing;

insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
values
  ('snr', 'unconfigured', 'not_configured', 'active', false,
   'Placeholder: SNR strategy rules not yet specified by the owner. Produces no events.'),
  ('test_zone_proximity', 'TEST-0', 'test_zone_proximity', 'draft', true,
   'TEST ONLY: technical fixture that flags proximity to manually entered zones. Not a trading strategy, no BUY/SELL.')
on conflict (strategy_key, version) do nothing;

insert into telegram_settings (id) values (1) on conflict (id) do nothing;

insert into app_settings (key, value) values
  ('display_timezone', '"UTC"'::jsonb),
  ('replay_defaults', '{"timeframe":"H1","speed":1,"base_interval_ms":1000,"warmup_candles":300}'::jsonb),
  ('providers', '{"historical":null,"news":null}'::jsonb)
on conflict (key) do nothing;
