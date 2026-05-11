-- MCP Server Registry — AgentPay Marketplace
-- Run once against Supabase Direct connection (port 5432)

CREATE TABLE IF NOT EXISTS mcp_servers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text        UNIQUE NOT NULL,
  name                text        NOT NULL,
  description         text,
  category            text,
  endpoint_url        text        NOT NULL,
  publisher_id        text        NOT NULL,
  pricing_model       text        NOT NULL DEFAULT 'free',
  price_per_call_usd  numeric(10,6),
  price_monthly_usd   numeric(10,4),
  free_tier_calls     integer     NOT NULL DEFAULT 100,
  status              text        NOT NULL DEFAULT 'pending',
  verified            boolean     NOT NULL DEFAULT false,
  featured            boolean     NOT NULL DEFAULT false,
  install_count       integer     NOT NULL DEFAULT 0,
  domain_verified     boolean     NOT NULL DEFAULT false,
  verification_token  text,
  metadata            jsonb       NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_servers_status_category_idx ON mcp_servers (status, category);
CREATE INDEX IF NOT EXISTS mcp_servers_publisher_idx        ON mcp_servers (publisher_id);
CREATE INDEX IF NOT EXISTS mcp_servers_featured_idx         ON mcp_servers (featured, install_count DESC) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS mcp_subscriptions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            text        NOT NULL,
  server_id           uuid        NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  plan                text        NOT NULL DEFAULT 'free',
  agentpay_payment_id text,
  status              text        NOT NULL DEFAULT 'active',
  calls_used          integer     NOT NULL DEFAULT 0,
  started_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, server_id)
);

CREATE INDEX IF NOT EXISTS mcp_subscriptions_agent_idx ON mcp_subscriptions (agent_id, status);

CREATE TABLE IF NOT EXISTS mcp_usage_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            text        NOT NULL,
  server_id           uuid        REFERENCES mcp_servers(id) ON DELETE SET NULL,
  tool_name           text,
  billed_amount_usd   numeric(10,6) NOT NULL DEFAULT 0,
  publisher_share_usd numeric(10,6) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_usage_events_agent_date_idx  ON mcp_usage_events (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_usage_events_server_date_idx ON mcp_usage_events (server_id, created_at DESC);

CREATE TABLE IF NOT EXISTS totp_enrollments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     text        UNIQUE NOT NULL,
  secret_enc   text        NOT NULL,
  confirmed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
