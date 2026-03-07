import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const initSql = `
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  api_key_hash VARCHAR(255) NOT NULL,
  api_key_salt VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(8) NOT NULL,
  wallet_address VARCHAR(255) UNIQUE NOT NULL,
  webhook_url TEXT,
  stripe_connected_account_id VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  total_volume NUMERIC(20, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  payment_id UUID UNIQUE NOT NULL,
  amount_usdc NUMERIC(20, 6) NOT NULL,
  recipient_address VARCHAR(255) NOT NULL,
  payer_address VARCHAR(255),
  transaction_hash VARCHAR(255),
  stripe_payment_reference VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  webhook_status VARCHAR(50) DEFAULT 'not_sent',
  confirmation_depth INTEGER DEFAULT 0,
  required_depth INTEGER DEFAULT 2,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_logs (
  id UUID PRIMARY KEY,
  merchant_id UUID REFERENCES merchants(id),
  method VARCHAR(10),
  endpoint VARCHAR(255),
  status_code INTEGER,
  ip_address VARCHAR(255),
  user_agent TEXT,
  response_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  merchant_id UUID,
  ip_address VARCHAR(255),
  request_count INTEGER DEFAULT 0,
  reset_at TIMESTAMP NOT NULL,
  PRIMARY KEY (merchant_id, ip_address)
);

CREATE TABLE IF NOT EXISTS payment_verifications (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  verification_token VARCHAR(255),
  verified_at TIMESTAMP,
  verification_data JSONB,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  event_type VARCHAR(100),
  transaction_id UUID REFERENCES transactions(id),
  webhook_url TEXT,
  payload JSONB,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  status VARCHAR(50) DEFAULT 'pending',
  response_status INTEGER,
  response_code INTEGER,
  response_body TEXT,
  last_attempt_at TIMESTAMP,
  next_attempt_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_reputation (
  agent_id VARCHAR(255) PRIMARY KEY,
  trust_score INTEGER NOT NULL DEFAULT 0,
  total_payments INTEGER NOT NULL DEFAULT 0,
  success_rate FLOAT NOT NULL DEFAULT 1.0,
  dispute_rate FLOAT NOT NULL DEFAULT 0.0,
  last_payment_at TIMESTAMP,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- APPEND-ONLY TABLE (FCA AML compliance).
-- Do NOT run UPDATE or DELETE on this table.
-- Every row is an immutable record of a verify-payment attempt.
CREATE TABLE IF NOT EXISTS payment_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  ip_address VARCHAR(50),
  transaction_signature VARCHAR(255),
  transaction_id UUID,
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  succeeded BOOLEAN NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  amount NUMERIC(20, 6) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USDC',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  verification_token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS verification_certificates (
  id UUID PRIMARY KEY,
  intent_id UUID REFERENCES payment_intents(id),
  payload TEXT NOT NULL,
  signature VARCHAR(255) NOT NULL,
  encoded TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  url TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id),
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS merchant_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  intent_id UUID REFERENCES payment_intents(id),
  transaction_id UUID REFERENCES transactions(id),
  fee_amount NUMERIC(20, 6) NOT NULL,
  fee_percent NUMERIC(5, 4) NOT NULL DEFAULT 0.02,
  currency VARCHAR(10) NOT NULL DEFAULT 'USDC',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_merchant_invoices_merchant ON merchant_invoices(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_invoices_intent ON merchant_invoices(intent_id);
CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);
CREATE INDEX IF NOT EXISTS idx_merchants_wallet ON merchants(wallet_address);
CREATE INDEX IF NOT EXISTS idx_merchants_key_prefix ON merchants(key_prefix);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_id ON transactions(payment_id);
CREATE INDEX IF NOT EXISTS idx_transactions_recipient ON transactions(recipient_address);
CREATE INDEX IF NOT EXISTS idx_transactions_payer ON transactions(payer_address);
CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_api_logs_merchant ON api_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters ON rate_limit_counters(merchant_id, ip_address);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_transaction ON payment_verifications(transaction_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_merchant ON webhook_events(merchant_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_merchant ON payment_intents(merchant_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_verification_certificates_intent ON verification_certificates(intent_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_merchant ON webhook_subscriptions(merchant_id);

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
  daily_spending_limit     DECIMAL(18, 6) DEFAULT 10.00,
  per_tx_limit             DECIMAL(18, 6) DEFAULT 2.00,
  auto_approve_under       DECIMAL(18, 6) DEFAULT 0.50,
  daily_auto_approve_cap   DECIMAL(18, 6) DEFAULT 5.00,
  require_pin_above        DECIMAL(18, 6),
  alert_webhook_url        TEXT,
  pin_hash                 TEXT,
  balance_usdc             DECIMAL(18, 6) DEFAULT 0,
  total_earned             DECIMAL(18, 6) DEFAULT 0,
  total_spent              DECIMAL(18, 6) DEFAULT 0,
  total_tips_received      DECIMAL(18, 6) DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS revenue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream VARCHAR(50) NOT NULL,
  amount DECIMAL(20, 6) NOT NULL,
  fee DECIMAL(20, 6) NOT NULL DEFAULT 0,
  net_to_recipient DECIMAL(20, 6) NOT NULL DEFAULT 0,
  from_entity_type VARCHAR(10) NOT NULL,
  from_entity_id VARCHAR(255) NOT NULL,
  to_entity_type VARCHAR(10) NOT NULL,
  to_entity_id VARCHAR(255) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_revenue_events_stream ON revenue_events(stream);
CREATE INDEX IF NOT EXISTS idx_revenue_events_created_at ON revenue_events(created_at);
CREATE INDEX IF NOT EXISTS idx_revenue_events_from_entity ON revenue_events(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_revenue_events_to_entity ON revenue_events(to_entity_id);

CREATE TABLE IF NOT EXISTS agentrank_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT UNIQUE NOT NULL,
  score INT NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1000),
  grade TEXT NOT NULL DEFAULT 'U',
  payment_reliability NUMERIC(5, 4) NOT NULL DEFAULT 0,
  service_delivery NUMERIC(5, 4) NOT NULL DEFAULT 0,
  transaction_volume INT NOT NULL DEFAULT 0,
  wallet_age_days INT NOT NULL DEFAULT 0,
  dispute_rate NUMERIC(5, 4) NOT NULL DEFAULT 0,
  stake_usdc NUMERIC(20, 6) NOT NULL DEFAULT 0,
  unique_counterparties INT NOT NULL DEFAULT 0,
  factors JSONB DEFAULT '{}',
  history JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agentrank_scores_agent_id ON agentrank_scores(agent_id);
CREATE INDEX IF NOT EXISTS idx_agentrank_scores_score ON agentrank_scores(score DESC);
`;

async function initializeDatabase() {
  try {
    console.log('🔄 Connecting to database...');
    const client = await pool.connect();
    
    console.log('📊 Creating tables...');
    await client.query(initSql);
    
    console.log('✅ Database initialized successfully!');
    console.log('📋 Tables created:');
    console.log('   - merchants');
    console.log('   - transactions');
    console.log('   - api_logs');
    console.log('   - rate_limit_counters');
    console.log('   - payment_verifications');
    console.log('   - webhook_events');
    console.log('   - agent_reputation');
    console.log('   - payment_intents');
    console.log('   - verification_certificates');
    console.log('   - webhook_subscriptions');
    console.log('   - webhook_delivery_logs');
    console.log('   - merchant_invoices');
    console.log('   - bots');
    console.log('   - revenue_events');
    console.log('   - agentrank_scores');
    
    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    process.exit(1);
  }
}

initializeDatabase();