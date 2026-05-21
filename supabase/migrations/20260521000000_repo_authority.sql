-- Repo Authority: scoped, revocable repository leases for agent workflows.
-- These records are authority declarations only. Raw GitHub/GitLab tokens must
-- remain in provider vaults or GitHub App installations, never in chat or MCP output.

CREATE TABLE IF NOT EXISTS repo_access_requests (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id          text        NOT NULL,
  principal_id         text        NOT NULL,
  operator_id          text,
  provider             text        NOT NULL DEFAULT 'github',
  purpose              text        NOT NULL,
  requested_repos      jsonb       NOT NULL DEFAULT '[]',
  requested_operations jsonb       NOT NULL DEFAULT '[]',
  status               text        NOT NULL DEFAULT 'pending',
  action_session_id    text,
  metadata             jsonb       NOT NULL DEFAULT '{}',
  expires_at           timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  approved_at          timestamptz,
  denied_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repo_access_requests_merchant_status_idx
  ON repo_access_requests (merchant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS repo_access_leases (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          uuid        REFERENCES repo_access_requests(id) ON DELETE SET NULL,
  merchant_id         text        NOT NULL,
  principal_id        text        NOT NULL,
  operator_id         text,
  provider            text        NOT NULL DEFAULT 'github',
  selected_repos      jsonb       NOT NULL DEFAULT '[]',
  approved_operations jsonb       NOT NULL DEFAULT '[]',
  status              text        NOT NULL DEFAULT 'active',
  metadata            jsonb       NOT NULL DEFAULT '{}',
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repo_access_leases_merchant_status_idx
  ON repo_access_leases (merchant_id, status, expires_at DESC);

