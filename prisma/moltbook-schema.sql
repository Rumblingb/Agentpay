-- AgentPay Moltbook Database Schema
-- Complete database structure for the human→bot→bot agent economy
--
-- Apply on top of the existing AgentPay schema (merchants, transactions, etc.)

-- ===========================
-- 1. BOTS
-- ===========================

CREATE TABLE IF NOT EXISTS bots (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_bot_id          VARCHAR(255) UNIQUE NOT NULL,
  handle                   VARCHAR(255) UNIQUE NOT NULL,
  wallet_address           VARCHAR(255) UNIQUE NOT NULL,
  wallet_keypair_encrypted TEXT NOT NULL,

  display_name             VARCHAR(255),
  bio                      TEXT,
  avatar_url               TEXT,
  created_by               VARCHAR(255),
  primary_function         VARCHAR(100),

  -- Spending policy
  daily_spending_limit     DECIMAL(18, 6) DEFAULT 10.00,
  per_tx_limit             DECIMAL(18, 6) DEFAULT 2.00,
  auto_approve_under       DECIMAL(18, 6) DEFAULT 0.50,
  daily_auto_approve_cap   DECIMAL(18, 6) DEFAULT 5.00,
  require_pin_above        DECIMAL(18, 6),
  alert_webhook_url        TEXT,
  pin_hash                 TEXT,

  -- Financial stats
  balance_usdc             DECIMAL(18, 6) DEFAULT 0,
  total_earned             DECIMAL(18, 6) DEFAULT 0,
  total_spent              DECIMAL(18, 6) DEFAULT 0,
  total_tips_received      DECIMAL(18, 6) DEFAULT 0,

  -- Reputation
  reputation_score         INTEGER DEFAULT 50,
  total_transactions       INTEGER DEFAULT 0,
  successful_transactions  INTEGER DEFAULT 0,
  disputed_transactions    INTEGER DEFAULT 0,
  tips_received_count      INTEGER DEFAULT 0,

  status                   VARCHAR(50) DEFAULT 'active',
  verified                 BOOLEAN DEFAULT FALSE,

  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  last_active_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bots_handle ON bots(handle);
CREATE INDEX IF NOT EXISTS idx_bots_wallet ON bots(wallet_address);
CREATE INDEX IF NOT EXISTS idx_bots_reputation ON bots(reputation_score DESC);

-- ===========================
-- 2. HUMAN TIPS
-- ===========================

CREATE TABLE IF NOT EXISTS human_tips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id           UUID REFERENCES bots(id) ON DELETE CASCADE,
  human_id         VARCHAR(255),

  amount           DECIMAL(18, 6) NOT NULL,
  fee              DECIMAL(18, 6) NOT NULL,
  bot_receives     DECIMAL(18, 6) NOT NULL,
  currency         VARCHAR(10) DEFAULT 'USDC',

  payment_method   VARCHAR(50),
  payment_provider VARCHAR(50),

  intent_id        UUID UNIQUE NOT NULL,
  tx_hash          VARCHAR(255),
  stripe_payment_id VARCHAR(255),

  status           VARCHAR(50) DEFAULT 'pending',
  verified         BOOLEAN DEFAULT FALSE,
  verification_timestamp TIMESTAMPTZ,

  message          TEXT,
  post_id          VARCHAR(255),

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_human_tips_bot ON human_tips(bot_id);
CREATE INDEX IF NOT EXISTS idx_human_tips_status ON human_tips(status);
CREATE INDEX IF NOT EXISTS idx_human_tips_created ON human_tips(created_at DESC);

-- ===========================
-- 3. BOT-TO-BOT TRANSACTIONS
-- ===========================

CREATE TABLE IF NOT EXISTS bot_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_bot_id       UUID REFERENCES bots(id) ON DELETE CASCADE,
  to_bot_id         UUID REFERENCES bots(id) ON DELETE CASCADE,

  amount            DECIMAL(18, 6) NOT NULL,
  fee               DECIMAL(18, 6) NOT NULL,
  recipient_receives DECIMAL(18, 6) NOT NULL,
  currency          VARCHAR(10) DEFAULT 'USDC',

  intent_id         UUID UNIQUE NOT NULL,
  tx_hash           VARCHAR(255),

  transaction_type  VARCHAR(50),
  purpose           TEXT,
  service_id        UUID,
  subscription_id   UUID,

  status            VARCHAR(50) DEFAULT 'pending',
  verified          BOOLEAN DEFAULT FALSE,
  auto_approved     BOOLEAN DEFAULT FALSE,
  verification_timestamp TIMESTAMPTZ,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bot_tx_from ON bot_transactions(from_bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_tx_to ON bot_transactions(to_bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_tx_status ON bot_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bot_tx_created ON bot_transactions(created_at DESC);

-- ===========================
-- 4. SERVICES MARKETPLACE
-- ===========================

CREATE TABLE IF NOT EXISTS services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_bot_id  UUID REFERENCES bots(id) ON DELETE CASCADE,

  name             VARCHAR(255) NOT NULL,
  description      TEXT,
  category         VARCHAR(100),

  price            DECIMAL(18, 6) NOT NULL,
  pricing_model    VARCHAR(50) DEFAULT 'per_use',

  api_endpoint     TEXT NOT NULL,
  api_method       VARCHAR(10) DEFAULT 'POST',
  requires_auth    BOOLEAN DEFAULT TRUE,

  avg_response_time_ms INTEGER,
  success_rate     DECIMAL(5, 2),
  total_uses       INTEGER DEFAULT 0,
  total_revenue    DECIMAL(18, 6) DEFAULT 0,

  rating           DECIMAL(3, 2),
  review_count     INTEGER DEFAULT 0,

  status           VARCHAR(50) DEFAULT 'active',
  verified         BOOLEAN DEFAULT FALSE,
  metadata         JSONB,
  tags             TEXT[],

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_provider ON services(provider_bot_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_rating ON services(rating DESC);

-- ===========================
-- 5. SUBSCRIPTIONS
-- ===========================

CREATE TABLE IF NOT EXISTS bot_subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_bot_id   UUID REFERENCES bots(id) ON DELETE CASCADE,
  provider_bot_id     UUID REFERENCES bots(id) ON DELETE CASCADE,

  amount              DECIMAL(18, 6) NOT NULL,
  interval            VARCHAR(50) DEFAULT 'monthly',
  auto_renew          BOOLEAN DEFAULT TRUE,

  service_id          UUID REFERENCES services(id),
  access_level        VARCHAR(50),

  status              VARCHAR(50) DEFAULT 'active',

  last_payment_date   TIMESTAMPTZ,
  next_payment_date   TIMESTAMPTZ,
  total_payments      INTEGER DEFAULT 0,
  total_paid          DECIMAL(18, 6) DEFAULT 0,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  cancelled_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subs_subscriber ON bot_subscriptions(subscriber_bot_id);
CREATE INDEX IF NOT EXISTS idx_subs_provider ON bot_subscriptions(provider_bot_id);
CREATE INDEX IF NOT EXISTS idx_subs_next_payment ON bot_subscriptions(next_payment_date);

-- ===========================
-- 6. REPUTATION EVENTS
-- ===========================

CREATE TABLE IF NOT EXISTS reputation_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id         UUID REFERENCES bots(id) ON DELETE CASCADE,

  event_type     VARCHAR(50) NOT NULL,
  impact         INTEGER,

  transaction_id UUID,
  service_id     UUID,
  description    TEXT,

  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_events_bot ON reputation_events(bot_id);
CREATE INDEX IF NOT EXISTS idx_rep_events_created ON reputation_events(created_at DESC);

-- ===========================
-- 7. DAILY STATS
-- ===========================

CREATE TABLE IF NOT EXISTS moltbook_daily_stats (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date                         DATE NOT NULL UNIQUE,

  total_tips                   INTEGER DEFAULT 0,
  total_tip_volume             DECIMAL(18, 6) DEFAULT 0,
  total_bot_transactions       INTEGER DEFAULT 0,
  total_bot_transaction_volume DECIMAL(18, 6) DEFAULT 0,

  total_fees_collected         DECIMAL(18, 6) DEFAULT 0,
  human_tip_fees               DECIMAL(18, 6) DEFAULT 0,
  bot_transaction_fees         DECIMAL(18, 6) DEFAULT 0,

  active_bots                  INTEGER DEFAULT 0,
  active_humans                INTEGER DEFAULT 0,
  new_bots                     INTEGER DEFAULT 0,

  services_used                INTEGER DEFAULT 0,
  service_revenue              DECIMAL(18, 6) DEFAULT 0,

  created_at                   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moltbook_daily_stats_date ON moltbook_daily_stats(date DESC);

-- ===========================
-- 8. SPENDING VIOLATION LOGS
-- ===========================

CREATE TABLE IF NOT EXISTS spending_violation_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id         UUID REFERENCES bots(id) ON DELETE CASCADE,

  amount         DECIMAL(18, 6) NOT NULL,
  violation_type VARCHAR(100) NOT NULL,
  description    TEXT,

  daily_limit    DECIMAL(18, 6),
  per_tx_limit   DECIMAL(18, 6),
  today_spent    DECIMAL(18, 6),

  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_violation_logs_bot ON spending_violation_logs(bot_id);
CREATE INDEX IF NOT EXISTS idx_violation_logs_created ON spending_violation_logs(created_at DESC);

-- ===========================
-- 9. VIEWS
-- ===========================

CREATE OR REPLACE VIEW bot_leaderboard AS
SELECT
  id,
  handle,
  total_earned,
  total_tips_received,
  reputation_score,
  total_transactions,
  tips_received_count
FROM bots
WHERE status = 'active'
ORDER BY total_earned DESC;

CREATE OR REPLACE VIEW top_services AS
SELECT
  s.id,
  s.name,
  s.category,
  s.price,
  s.total_uses,
  s.total_revenue,
  s.rating,
  b.handle AS provider_handle
FROM services s
JOIN bots b ON s.provider_bot_id = b.id
WHERE s.status = 'active'
ORDER BY s.total_uses DESC;
