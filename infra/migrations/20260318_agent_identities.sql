-- Migration: agent_identities
-- Purpose: KYA (Know Your Agent) identity table for self-registered agents.
--          Stores agent identity records, KYC status, and metadata.
--          The agentKey hash is stored in metadata.agentKeyHash (never plaintext).

CREATE TABLE IF NOT EXISTS agent_identities (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT          UNIQUE NOT NULL,
  owner_email     TEXT          NOT NULL,
  owner_id        TEXT,
  verified        BOOLEAN       NOT NULL DEFAULT false,
  kyc_status      TEXT          NOT NULL DEFAULT 'pending',
  risk_score      DECIMAL(5,2)  NOT NULL DEFAULT 0,
  stripe_account  TEXT,
  platform_token  TEXT,
  world_id_hash   TEXT,
  metadata        JSONB         NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_identities_agent_id
  ON agent_identities (agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_identities_owner_email
  ON agent_identities (owner_email);

CREATE INDEX IF NOT EXISTS idx_agent_identities_kyc_status
  ON agent_identities (kyc_status);

CREATE INDEX IF NOT EXISTS idx_agent_identities_created_at
  ON agent_identities (created_at DESC);

COMMENT ON TABLE agent_identities IS
  'KYA — Know Your Agent. Stores identity records for self-registered agents. '
  'agentKey is hashed (SHA-256) and stored in metadata.agentKeyHash. '
  'kyc_status=programmatic means agent self-registered without human KYC. '
  'verified=true is set after payment history builds sufficient trust.';
