CREATE TABLE IF NOT EXISTS user_mfa (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mfa_setup (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mfa_setup_expires_idx ON mfa_setup(expires_at);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  code_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx ON mfa_recovery_codes(user_id);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mfa_challenges_user_idx ON mfa_challenges(user_id);
CREATE INDEX IF NOT EXISTS mfa_challenges_expires_idx ON mfa_challenges(expires_at);
