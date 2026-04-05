-- RCM Credential Vault
-- Migration: 002_rcm_credential_vault.sql
--
-- Stores encrypted payer portal credentials for autonomous portal connector access.
-- Blocked on encryption key management strategy — see rcmCredentialVault.ts for details.
--
-- Run after 001_rcm_tables.sql.
-- Apply with: psql $DATABASE_URL -f infra/prisma/migrations/002_rcm_credential_vault.sql

-- ── Credential vault ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rcm_credential_vault (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: credentials are scoped to a workspace (not just merchant) to support
  -- multi-facility operators where each facility has its own payer credentials.
  workspace_id      UUID        NOT NULL REFERENCES rcm_workspaces(id) ON DELETE CASCADE,

  -- Credential classification
  credential_type   TEXT        NOT NULL,  -- payer_portal | dde | x12_edi | api_key
  payer_name        TEXT        NOT NULL,
  payer_id          TEXT,                  -- CMS payer ID if known
  portal_url        TEXT,                  -- Base URL for portal login

  -- Encrypted credential blob (AES-GCM, key via Workers Secret RCM_VAULT_ENCRYPTION_KEY)
  -- TODO: Implement real encryption in rcmCredentialVault.ts before production use.
  encrypted_payload TEXT        NOT NULL,

  -- Unencrypted metadata for connector routing (login URL, selector hints, etc.)
  meta              JSONB       NOT NULL DEFAULT '{}',

  -- Lifecycle
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,          -- NULL = never expires

  -- Constraints
  CONSTRAINT rcm_credential_type_check CHECK (
    credential_type IN ('payer_portal', 'dde', 'x12_edi', 'api_key')
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rcm_credential_vault_workspace
  ON rcm_credential_vault (workspace_id);

CREATE INDEX IF NOT EXISTS idx_rcm_credential_vault_payer
  ON rcm_credential_vault (workspace_id, payer_name, credential_type);

CREATE INDEX IF NOT EXISTS idx_rcm_credential_vault_expires
  ON rcm_credential_vault (expires_at)
  WHERE expires_at IS NOT NULL;

-- ── Credential access audit log ───────────────────────────────────────────────
-- Tracks every retrieve/use event for HIPAA compliance.

CREATE TABLE IF NOT EXISTS rcm_credential_access_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id   UUID        NOT NULL REFERENCES rcm_credential_vault(id) ON DELETE CASCADE,
  workspace_id    UUID        NOT NULL,
  accessed_by     TEXT        NOT NULL,  -- 'rcm_autonomy_loop' | 'connector:portal' | 'human:...'
  access_reason   TEXT        NOT NULL,  -- 'portal_login' | 'eligibility_check' | 'claim_status' | 'denial_appeal'
  work_item_id    UUID,                  -- linked work item if applicable
  ip_address      TEXT,
  accessed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_credential_access_log_credential
  ON rcm_credential_access_log (credential_id);

CREATE INDEX IF NOT EXISTS idx_rcm_credential_access_log_workspace
  ON rcm_credential_access_log (workspace_id, accessed_at DESC);

-- ── Comments ──────────────────────────────────────────────────────────────────

COMMENT ON TABLE rcm_credential_vault IS
  'Encrypted payer portal credentials for autonomous connector portal fallback. '
  'Production use requires AES-GCM encryption via Workers Secret RCM_VAULT_ENCRYPTION_KEY.';

COMMENT ON TABLE rcm_credential_access_log IS
  'Immutable audit log for all credential access events. Required for HIPAA compliance.';

COMMENT ON COLUMN rcm_credential_vault.encrypted_payload IS
  'AES-GCM encrypted JSON blob containing username, password, and payer-specific auth fields. '
  'TODO: Implement real encryption before production use — current implementation is placeholder.';
