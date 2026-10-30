ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS sector TEXT NOT NULL DEFAULT 'Unknown';
CREATE TABLE IF NOT EXISTS scan_run_health (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  universe_count INTEGER NOT NULL DEFAULT 0,
  quoted_count INTEGER NOT NULL DEFAULT 0,
  analyzed_count INTEGER NOT NULL DEFAULT 0,
  qualified_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_text TEXT
);
CREATE INDEX IF NOT EXISTS scan_run_health_started_idx ON scan_run_health(started_at DESC);