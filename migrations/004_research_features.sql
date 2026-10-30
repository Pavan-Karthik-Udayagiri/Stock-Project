CREATE TABLE IF NOT EXISTS paper_trades (
  id BIGSERIAL PRIMARY KEY,
  owner_key TEXT NOT NULL DEFAULT 'primary',
  symbol TEXT NOT NULL,
  company_name TEXT,
  side TEXT NOT NULL DEFAULT 'LONG',
  entry NUMERIC NOT NULL,
  stop NUMERIC NOT NULL,
  target NUMERIC NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  exit_price NUMERIC,
  gross_pnl NUMERIC,
  costs NUMERIC NOT NULL DEFAULT 0,
  net_pnl NUMERIC,
  notes TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_trades_owner_status_idx ON paper_trades(owner_key, status, opened_at DESC);
CREATE TABLE IF NOT EXISTS backtest_runs (
  id BIGSERIAL PRIMARY KEY,
  owner_key TEXT NOT NULL DEFAULT 'primary',
  strategy TEXT NOT NULL,
  symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS backtest_runs_owner_created_idx ON backtest_runs(owner_key, created_at DESC);