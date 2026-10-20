CREATE TABLE IF NOT EXISTS remote_scanner_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS remote_scanner_sessions_expires_idx ON remote_scanner_sessions(expires_at);
CREATE TABLE IF NOT EXISTS remote_scanner_scans (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL REFERENCES remote_scanner_sessions(token_hash) ON DELETE CASCADE,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS remote_scanner_scans_session_idx ON remote_scanner_scans(token_hash, id);
