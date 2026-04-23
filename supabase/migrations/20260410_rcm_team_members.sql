-- RCM team members: link invited merchants to a parent (primary) merchant
-- Run this migration before deploying the team invite feature

-- Add parent_merchant_id to merchants table for team member linking
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS parent_merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL;

-- Index for fast team member lookups
CREATE INDEX IF NOT EXISTS idx_merchants_parent_merchant_id
  ON merchants(parent_merchant_id)
  WHERE parent_merchant_id IS NOT NULL;

COMMENT ON COLUMN merchants.parent_merchant_id IS
  'When set, this merchant is a team member of the parent merchant. All RCM workspace data is scoped to the parent.';
