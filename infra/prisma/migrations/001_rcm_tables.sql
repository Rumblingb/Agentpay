-- RCM tables: initial migration
-- Creates all six RCM domain tables that back the autonomous billing engine.
-- Safe to run once; idempotent via IF NOT EXISTS guards.

-- 1. Workspaces: one per provider / facility client
CREATE TABLE IF NOT EXISTS rcm_workspaces (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  legal_name      TEXT,
  workspace_type  TEXT        NOT NULL DEFAULT 'facility_rcm',
  specialty       TEXT,
  timezone        TEXT        DEFAULT 'America/New_York',
  status          TEXT        NOT NULL DEFAULT 'active',
  approval_policy JSONB       DEFAULT '{}',
  config          JSONB       DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_workspaces_merchant ON rcm_workspaces(merchant_id);
CREATE INDEX IF NOT EXISTS idx_rcm_workspaces_type     ON rcm_workspaces(workspace_type);
CREATE INDEX IF NOT EXISTS idx_rcm_workspaces_status   ON rcm_workspaces(status);

-- 2. Work items: the unit of work in every lane
CREATE TABLE IF NOT EXISTS rcm_work_items (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID          NOT NULL REFERENCES rcm_workspaces(id) ON DELETE CASCADE,
  merchant_id          UUID          NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  assigned_agent_id    UUID          REFERENCES agents(id) ON DELETE SET NULL,
  work_type            TEXT          NOT NULL,
  billing_domain       TEXT          NOT NULL DEFAULT 'facility',
  form_type            TEXT,
  title                TEXT          NOT NULL,
  payer_name           TEXT,
  coverage_type        TEXT,
  patient_ref          TEXT,
  provider_ref         TEXT,
  encounter_ref        TEXT,
  claim_ref            TEXT,
  source_system        TEXT,
  amount_at_risk       DECIMAL(20,2),
  confidence_pct       INT,
  priority             TEXT          NOT NULL DEFAULT 'normal',
  status               TEXT          NOT NULL DEFAULT 'new',
  requires_human_review BOOLEAN      NOT NULL DEFAULT FALSE,
  due_at               TIMESTAMPTZ,
  submitted_at         TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  metadata             JSONB         DEFAULT '{}',
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_work_items_workspace  ON rcm_work_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_rcm_work_items_merchant   ON rcm_work_items(merchant_id);
CREATE INDEX IF NOT EXISTS idx_rcm_work_items_agent      ON rcm_work_items(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_rcm_work_items_work_type  ON rcm_work_items(work_type);
CREATE INDEX IF NOT EXISTS idx_rcm_work_items_domain     ON rcm_work_items(billing_domain);
CREATE INDEX IF NOT EXISTS idx_rcm_work_items_status     ON rcm_work_items(status);
CREATE INDEX IF NOT EXISTS idx_rcm_work_items_priority   ON rcm_work_items(priority);
CREATE INDEX IF NOT EXISTS idx_rcm_work_items_due_at     ON rcm_work_items(due_at);

-- 3. Evidence: immutable audit trail for every agent and human action
CREATE TABLE IF NOT EXISTS rcm_work_item_evidence (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id  UUID        NOT NULL REFERENCES rcm_work_items(id) ON DELETE CASCADE,
  actor_type    TEXT        NOT NULL,
  actor_ref     TEXT        NOT NULL,
  evidence_type TEXT        NOT NULL,
  payload       JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_evidence_work_item ON rcm_work_item_evidence(work_item_id);
CREATE INDEX IF NOT EXISTS idx_rcm_evidence_type      ON rcm_work_item_evidence(evidence_type);

-- 4. Milestones: fee capture events linked to payment_intents
CREATE TABLE IF NOT EXISTS rcm_milestones (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id      UUID        NOT NULL REFERENCES rcm_work_items(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  amount            DECIMAL(20,2) NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending',
  success_criteria  JSONB       DEFAULT '{}',
  payment_intent_id UUID        UNIQUE REFERENCES payment_intents(id) ON DELETE SET NULL,
  released_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_milestones_work_item ON rcm_milestones(work_item_id);
CREATE INDEX IF NOT EXISTS idx_rcm_milestones_status    ON rcm_milestones(status);

-- 5. Exceptions: escalated cases awaiting human review
CREATE TABLE IF NOT EXISTS rcm_exceptions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id   UUID        NOT NULL REFERENCES rcm_work_items(id) ON DELETE CASCADE,
  exception_type TEXT        NOT NULL,
  severity       TEXT        NOT NULL DEFAULT 'normal',
  reason_code    TEXT,
  summary        TEXT        NOT NULL,
  payload        JSONB       DEFAULT '{}',
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_exceptions_work_item ON rcm_exceptions(work_item_id);
CREATE INDEX IF NOT EXISTS idx_rcm_exceptions_type      ON rcm_exceptions(exception_type);
CREATE INDEX IF NOT EXISTS idx_rcm_exceptions_severity  ON rcm_exceptions(severity);

-- 6. Vendor metrics: scorecard per agent per billing period
CREATE TABLE IF NOT EXISTS rcm_vendor_metrics (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         UUID          NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  agent_id            UUID          NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  period_start        TIMESTAMPTZ   NOT NULL,
  period_end          TIMESTAMPTZ   NOT NULL,
  completed_count     INT           NOT NULL DEFAULT 0,
  approved_count      INT           NOT NULL DEFAULT 0,
  rejected_count      INT           NOT NULL DEFAULT 0,
  escalated_count     INT           NOT NULL DEFAULT 0,
  avg_turnaround_mins INT           NOT NULL DEFAULT 0,
  released_amount     DECIMAL(20,2) NOT NULL DEFAULT 0,
  score_payload       JSONB         DEFAULT '{}',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_vendor_metrics_merchant_agent ON rcm_vendor_metrics(merchant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_rcm_vendor_metrics_period         ON rcm_vendor_metrics(period_start, period_end);
