import { Pool } from 'pg';
import { logger } from '../logger';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle database client', err);
});

export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();

  try {
    logger.info('🔄 Initializing database schema...');

    // Enable required extensions
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    // ============ MERCHANTS TABLE ============
    await client.query(`
      CREATE TABLE IF NOT EXISTS merchants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        api_key_hash VARCHAR(255) UNIQUE NOT NULL,
        api_key_salt VARCHAR(255) NOT NULL,
        key_prefix VARCHAR(8) NOT NULL,
        wallet_address VARCHAR(255) NOT NULL UNIQUE,
        webhook_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        rate_limit_requests INT DEFAULT 100,
        rate_limit_window_ms INT DEFAULT 900000,
        stripe_connected_account_id VARCHAR(255)
      );

      CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);
      CREATE INDEX IF NOT EXISTS idx_merchants_api_key_hash ON merchants(api_key_hash);
      CREATE INDEX IF NOT EXISTS idx_merchants_key_prefix ON merchants(key_prefix);
      CREATE INDEX IF NOT EXISTS idx_merchants_wallet ON merchants(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_merchants_active ON merchants(is_active);
    `);

    // ============ TRANSACTIONS TABLE ============
    // Core payment records with recipient verification
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        payment_id VARCHAR(255) UNIQUE NOT NULL,
        amount_usdc DECIMAL(20, 6) NOT NULL,
        recipient_address VARCHAR(255) NOT NULL,
        payer_address VARCHAR(255),
        transaction_hash VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        webhook_status VARCHAR(50) DEFAULT 'not_sent',
        confirmation_depth INT DEFAULT 0,
        required_depth INT DEFAULT 2,
        metadata JSONB,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        stripe_payment_reference VARCHAR(255),
        CHECK (confirmation_depth >= 0),
        CHECK (status IN ('pending', 'confirmed', 'failed', 'expired')),
        CHECK (webhook_status IN ('not_sent', 'sent', 'failed'))
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_merchant_id ON transactions(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_payment_id ON transactions(payment_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(transaction_hash);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
      CREATE INDEX IF NOT EXISTS idx_transactions_recipient ON transactions(recipient_address);
      CREATE INDEX IF NOT EXISTS idx_transactions_payer ON transactions(payer_address);
      CREATE INDEX IF NOT EXISTS idx_transactions_merchant_status ON transactions(merchant_id, status);
    `);

    // ============ API AUDIT LOG ============
    // Track all API calls for security and monitoring
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
        method VARCHAR(10) NOT NULL,
        endpoint VARCHAR(500) NOT NULL,
        status_code INT,
        ip_address VARCHAR(50),
        user_agent TEXT,
        response_time_ms INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (response_time_ms >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_api_logs_merchant ON api_logs(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_api_logs_ip ON api_logs(ip_address);
    `);

    // ============ RATE LIMIT TRACKING ============
    // Per-merchant and per-IP rate limiting
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limit_counters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
        ip_address VARCHAR(50),
        request_count INT DEFAULT 1,
        reset_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + interval '15 minutes'),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_rate_limit UNIQUE NULLS NOT DISTINCT (merchant_id, ip_address, reset_at)
      );

      CREATE INDEX IF NOT EXISTS idx_rate_limit_merchant_ip ON rate_limit_counters(merchant_id, ip_address);
      CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_counters(reset_at);
    `);

    // ============ PAYMENT VERIFICATION ============
    // Secure verification tokens for payment confirmation
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        verification_token VARCHAR(255) UNIQUE NOT NULL,
        verified_at TIMESTAMP,
        verification_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + interval '1 hour')
      );

      CREATE INDEX IF NOT EXISTS idx_verification_transaction ON payment_verifications(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_verification_token ON payment_verifications(verification_token);
      CREATE INDEX IF NOT EXISTS idx_verification_expires ON payment_verifications(expires_at);
    `);

    // ============ WEBHOOK EVENTS ============
    // Outgoing webhooks for merchant notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        event_type VARCHAR(100) NOT NULL,
        transaction_id UUID REFERENCES transactions(id),
        webhook_url TEXT NOT NULL,
        payload JSONB NOT NULL,
        retry_count INT DEFAULT 0,
        max_retries INT DEFAULT 3,
        status VARCHAR(50) DEFAULT 'pending',
        response_status INT,
        response_body TEXT,
        last_attempt_at TIMESTAMP,
        next_attempt_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_merchant ON webhook_events(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_events(status);
      CREATE INDEX IF NOT EXISTS idx_webhook_next_attempt ON webhook_events(next_attempt_at);
    `);

    // ============ WEBHOOK SUBSCRIPTIONS (V2) ============
    // Merchant-configured subscriptions for event-driven webhook delivery
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        event_types TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_wh_sub_merchant ON webhook_subscriptions(merchant_id);
    `);

    // ============ WEBHOOK DELIVERY LOGS (V2) ============
    // Per-subscription delivery attempt tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
        payload JSONB NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (status IN ('pending', 'sent', 'failed'))
      );

      CREATE INDEX IF NOT EXISTS idx_wh_log_sub ON webhook_delivery_logs(subscription_id);
      CREATE INDEX IF NOT EXISTS idx_wh_log_status ON webhook_delivery_logs(status);
    `);

    // ============ PAYMENT AUDIT LOG ============
    // APPEND-ONLY TABLE (FCA AML compliance).
    // No UPDATEs or DELETEs should ever be performed on this table.
    // Every row is an immutable record of a verify-payment attempt.
    await client.query(`
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

      CREATE INDEX IF NOT EXISTS idx_audit_merchant ON payment_audit_log(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON payment_audit_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_sig ON payment_audit_log(transaction_signature);
    `);

    // ============ AGENT REPUTATION ============
    // Tracks trust scores and payment history per agent (identified by wallet/payer address)
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_reputation (
        agent_id VARCHAR(255) PRIMARY KEY,
        trust_score INT NOT NULL DEFAULT 50,
        total_payments INT NOT NULL DEFAULT 0,
        success_rate FLOAT NOT NULL DEFAULT 0,
        dispute_rate FLOAT NOT NULL DEFAULT 0,
        last_payment_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_agent_reputation_trust ON agent_reputation(trust_score);
      CREATE INDEX IF NOT EXISTS idx_agent_reputation_updated ON agent_reputation(updated_at);
    `);

    // ============ REVENUE EVENTS ============
    // Unified ledger for all platform revenue streams
    await client.query(`
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
    `);

    logger.info('✅ Database schema initialized successfully!');
    logger.info('📊 Tables created:');
    logger.info('   - merchants (API users)');
    logger.info('   - transactions (payment records with recipient verification)');
    logger.info('   - api_logs (audit trail)');
    logger.info('   - rate_limit_counters (DDoS protection)');
    logger.info('   - payment_verifications (secure tokens)');
    logger.info('   - webhook_events (merchant notifications)');
    logger.info('   - agent_reputation (trust scores per agent)');
    logger.info('   - revenue_events (unified revenue ledger)');
  } catch (error) {
    logger.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export { pool };
