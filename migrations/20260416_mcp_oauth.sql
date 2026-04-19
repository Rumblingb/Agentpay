CREATE TABLE IF NOT EXISTS oauth_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT,
  client_name TEXT,
  redirect_uris_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  grant_types_json JSONB NOT NULL DEFAULT '["authorization_code"]'::jsonb,
  response_types_json JSONB NOT NULL DEFAULT '["code"]'::jsonb,
  scope TEXT NOT NULL DEFAULT 'remote_mcp',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_created
  ON oauth_clients (created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  merchant_email TEXT NOT NULL,
  merchant_key_prefix TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'remote_mcp',
  resource TEXT,
  audience TEXT NOT NULL DEFAULT 'generic',
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_authorization_codes_audience_check
    CHECK (audience IN ('openai', 'anthropic', 'generic'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_client_expires
  ON oauth_authorization_codes (client_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_merchant_created
  ON oauth_authorization_codes (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_email_link_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_token_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  merchant_email TEXT NOT NULL,
  merchant_key_prefix TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'remote_mcp',
  state TEXT,
  resource TEXT,
  audience TEXT NOT NULL DEFAULT 'generic',
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  delivery_channel TEXT NOT NULL DEFAULT 'email_link',
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_email_link_attempts_audience_check
    CHECK (audience IN ('openai', 'anthropic', 'generic'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_email_link_attempts_client_expires
  ON oauth_email_link_attempts (client_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_oauth_email_link_attempts_merchant_created
  ON oauth_email_link_attempts (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oauth_email_link_attempts_email_created
  ON oauth_email_link_attempts (merchant_email, created_at DESC);
