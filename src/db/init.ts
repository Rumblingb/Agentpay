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
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        rate_limit_requests INT DEFAULT 100,
        rate_limit_window_ms INT DEFAULT 900000
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
        confirmation_depth INT DEFAULT 0,
        required_depth INT DEFAULT 2,
        metadata JSONB,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        CHECK (confirmation_depth >= 0),
        CHECK (status IN ('pending', 'confirmed', 'failed', 'expired'))
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

    logger.info('✅ Database schema initialized successfully!');
    logger.info('📊 Tables created:');
    logger.info('   - merchants (API users)');
    logger.info('   - transactions (payment records with recipient verification)');
    logger.info('   - api_logs (audit trail)');
    logger.info('   - rate_limit_counters (DDoS protection)');
    logger.info('   - payment_verifications (secure tokens)');
    logger.info('   - webhook_events (merchant notifications)');
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
