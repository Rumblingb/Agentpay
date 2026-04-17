import { Pool } from 'pg';
import { logger } from '../logger.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: true }
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
        stripe_connected_account_id VARCHAR(255),
        stripe_billing_customer_id VARCHAR(255),
        hosted_mcp_plan_code VARCHAR(32) NOT NULL DEFAULT 'launch',
        hosted_mcp_pricing_override_json JSONB
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

    // ============ PAYMENT INTENTS ============
    // Upcoming payment requests (also managed by Prisma)
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_intents (
        id UUID PRIMARY KEY,
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        amount NUMERIC(20, 6) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'USDC',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        verification_token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_payment_intents_merchant ON payment_intents(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status, expires_at);
    `);

    // ============ VERIFICATION CERTIFICATES ============
    // Signed certificates for payment verification
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_certificates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        intent_id UUID REFERENCES payment_intents(id),
        payload TEXT NOT NULL,
        signature VARCHAR(255) NOT NULL,
        encoded TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_verification_certificates_intent ON verification_certificates(intent_id);
    `);

    // ============ MERCHANT INVOICES ============
    // Platform-fee invoices for successfully verified payments
    await client.query(`
      CREATE TABLE IF NOT EXISTS merchant_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        intent_id UUID REFERENCES payment_intents(id),
        transaction_id UUID REFERENCES transactions(id),
        fee_amount NUMERIC(20, 6) NOT NULL,
        fee_percent NUMERIC(5, 4) NOT NULL DEFAULT 0.02,
        currency VARCHAR(10) NOT NULL DEFAULT 'USDC',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        invoice_type VARCHAR(32) NOT NULL DEFAULT 'platform_fee',
        reference_key TEXT,
        period_start TIMESTAMPTZ,
        period_end TIMESTAMPTZ,
        line_items_json JSONB,
        external_checkout_url TEXT,
        external_checkout_session_id TEXT,
        paid_at TIMESTAMPTZ,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_merchant_invoices_merchant ON merchant_invoices(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_merchant_invoices_intent ON merchant_invoices(intent_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_invoices_reference_key
        ON merchant_invoices(reference_key)
        WHERE reference_key IS NOT NULL;
    `);

    // ============ HOSTED MCP USAGE EVENTS ============
    // Append-only usage ledger for hosted remote MCP billing and reporting.
    await client.query(`
      CREATE TABLE IF NOT EXISTS mcp_usage_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        plan_code VARCHAR(32) NOT NULL,
        auth_type VARCHAR(32) NOT NULL,
        audience VARCHAR(32) NOT NULL DEFAULT 'generic',
        event_type VARCHAR(32) NOT NULL,
        request_id TEXT,
        tool_name TEXT,
        usage_units INT NOT NULL DEFAULT 1,
        unit_price_usd_micros INT NOT NULL DEFAULT 0,
        estimated_amount_usd_micros INT NOT NULL DEFAULT 0,
        status_code INT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (plan_code IN ('launch', 'builder', 'growth', 'enterprise')),
        CHECK (auth_type IN ('api_key', 'mcp_token')),
        CHECK (audience IN ('openai', 'anthropic', 'generic')),
        CHECK (event_type IN ('token_mint', 'tools_list', 'tool_call', 'transport_request')),
        CHECK (usage_units > 0)
      );

      CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_merchant_created
        ON mcp_usage_events(merchant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_event_type
        ON mcp_usage_events(event_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_tool_name
        ON mcp_usage_events(tool_name);
    `);

    // ============ CAPABILITY VAULT ============ 
    // Generic capability storage, connection sessions, audit trail, and usage ledger.
    await client.query(`
      CREATE TABLE IF NOT EXISTS capability_vault_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        capability_key TEXT NOT NULL,
        capability_type TEXT NOT NULL,
        capability_scope TEXT,
        provider TEXT,
        subject_type TEXT,
        subject_ref TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        secret_payload_json JSONB DEFAULT '{}'::jsonb,
        metadata JSONB DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT capability_vault_entries_unique_key UNIQUE (merchant_id, capability_key)
      );

      CREATE INDEX IF NOT EXISTS idx_capability_vault_entries_merchant_status
        ON capability_vault_entries(merchant_id, status);
      CREATE INDEX IF NOT EXISTS idx_capability_vault_entries_type_status
        ON capability_vault_entries(capability_type, status);
      CREATE INDEX IF NOT EXISTS idx_capability_vault_entries_expires
        ON capability_vault_entries(expires_at);

      CREATE TABLE IF NOT EXISTS capability_connect_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        capability_vault_entry_id UUID NOT NULL REFERENCES capability_vault_entries(id) ON DELETE CASCADE,
        session_token_hash TEXT NOT NULL UNIQUE,
        session_state TEXT NOT NULL DEFAULT 'pending',
        provider TEXT,
        redirect_url TEXT,
        callback_url TEXT,
        connection_payload_json JSONB DEFAULT '{}'::jsonb,
        metadata JSONB DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NOT NULL,
        connected_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_capability_connect_sessions_merchant_created
        ON capability_connect_sessions(merchant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_capability_connect_sessions_entry_state
        ON capability_connect_sessions(capability_vault_entry_id, session_state);
      CREATE INDEX IF NOT EXISTS idx_capability_connect_sessions_state_expires
        ON capability_connect_sessions(session_state, expires_at);

      CREATE TABLE IF NOT EXISTS capability_access_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        capability_vault_entry_id UUID REFERENCES capability_vault_entries(id) ON DELETE SET NULL,
        session_id UUID REFERENCES capability_connect_sessions(id) ON DELETE SET NULL,
        capability_key TEXT NOT NULL,
        capability_type TEXT NOT NULL,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL DEFAULT 'allowed',
        actor_type TEXT,
        actor_ref TEXT,
        request_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        reason_code TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_capability_access_logs_merchant_created
        ON capability_access_logs(merchant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_capability_access_logs_entry_created
        ON capability_access_logs(capability_vault_entry_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_capability_access_logs_action_created
        ON capability_access_logs(action, created_at DESC);

      CREATE TABLE IF NOT EXISTS capability_usage_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        capability_vault_entry_id UUID REFERENCES capability_vault_entries(id) ON DELETE SET NULL,
        session_id UUID REFERENCES capability_connect_sessions(id) ON DELETE SET NULL,
        capability_key TEXT NOT NULL,
        capability_type TEXT NOT NULL,
        event_type TEXT NOT NULL,
        request_id TEXT,
        tool_name TEXT,
        usage_units INT NOT NULL DEFAULT 1,
        unit_price_micros INT NOT NULL DEFAULT 0,
        estimated_amount_micros INT NOT NULL DEFAULT 0,
        status_code INT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (usage_units > 0),
        CHECK (unit_price_micros >= 0),
        CHECK (estimated_amount_micros >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_capability_usage_events_merchant_created
        ON capability_usage_events(merchant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_capability_usage_events_entry_created
        ON capability_usage_events(capability_vault_entry_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_capability_usage_events_event_type
        ON capability_usage_events(event_type, created_at DESC);

      CREATE TABLE IF NOT EXISTS oauth_clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id TEXT NOT NULL UNIQUE,
        client_secret_hash TEXT,
        client_name TEXT,
        redirect_uris_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
        grant_types_json JSONB NOT NULL DEFAULT '["authorization_code"]'::jsonb,
        response_types_json JSONB NOT NULL DEFAULT '["code"]'::jsonb,
        scope TEXT NOT NULL DEFAULT 'remote_mcp',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_clients_created
        ON oauth_clients(created_at DESC);

      CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code_hash TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        merchant_email TEXT NOT NULL,
        merchant_key_prefix TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'remote_mcp',
        resource TEXT,
        audience TEXT NOT NULL DEFAULT 'generic',
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL DEFAULT 'S256',
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (audience IN ('openai', 'anthropic', 'generic'))
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_client_expires
        ON oauth_authorization_codes(client_id, expires_at DESC);
      CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_merchant_created
        ON oauth_authorization_codes(merchant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS oauth_email_link_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        attempt_token_hash TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        merchant_email TEXT NOT NULL,
        merchant_key_prefix TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'remote_mcp',
        state TEXT,
        resource TEXT,
        audience TEXT NOT NULL DEFAULT 'generic',
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL DEFAULT 'S256',
        delivery_channel TEXT NOT NULL DEFAULT 'email_link',
        expires_at TIMESTAMPTZ NOT NULL,
        verified_at TIMESTAMPTZ,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (audience IN ('openai', 'anthropic', 'generic'))
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_email_link_attempts_client_expires
        ON oauth_email_link_attempts(client_id, expires_at DESC);
      CREATE INDEX IF NOT EXISTS idx_oauth_email_link_attempts_merchant_created
        ON oauth_email_link_attempts(merchant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_oauth_email_link_attempts_email_created
        ON oauth_email_link_attempts(merchant_email, created_at DESC);

      CREATE TABLE IF NOT EXISTS hosted_action_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        action_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        title TEXT NOT NULL,
        summary TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        audience TEXT,
        auth_type TEXT,
        resume_url TEXT,
        resume_token_hash TEXT NOT NULL UNIQUE,
        display_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (status IN ('pending', 'completed', 'failed', 'expired'))
      );

      CREATE INDEX IF NOT EXISTS idx_hosted_action_sessions_merchant_created
        ON hosted_action_sessions(merchant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_hosted_action_sessions_status_expires
        ON hosted_action_sessions(status, expires_at DESC);
      CREATE INDEX IF NOT EXISTS idx_hosted_action_sessions_entity_created
        ON hosted_action_sessions(entity_type, entity_id, created_at DESC);
    `);

    // ============ BOTS ============
    // Bot economy entities for Moltbook
    await client.query(`
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
    `);

    // ============ SCHEMA MIGRATIONS (safe, idempotent ALTER TABLE) ============
    // Add total_volume to merchants — tracks cumulative USDC released via approved escrows.
    // Used to compute the merchant's reputation grade for the dashboard AAA badge.
    await client.query(`
      ALTER TABLE merchants
        ADD COLUMN IF NOT EXISTS total_volume NUMERIC(20, 6) NOT NULL DEFAULT 0;
    `);

    await client.query(`
      ALTER TABLE merchants
        ADD COLUMN IF NOT EXISTS hosted_mcp_plan_code VARCHAR(32) NOT NULL DEFAULT 'launch';
    `);

    await client.query(`
      ALTER TABLE merchants
        ADD COLUMN IF NOT EXISTS hosted_mcp_pricing_override_json JSONB;
    `);

    await client.query(`
      ALTER TABLE merchants
        ADD COLUMN IF NOT EXISTS stripe_billing_customer_id VARCHAR(255);
    `);

    logger.info('✅ Database schema initialized successfully!');
    logger.info('📊 Tables created:');
    logger.info('   - merchants (API users)');
    logger.info('   - transactions (payment records with recipient verification)');
    logger.info('   - api_logs (audit trail)');
    logger.info('   - rate_limit_counters (DDoS protection)');
    logger.info('   - payment_verifications (secure tokens)');
    logger.info('   - webhook_events (merchant notifications)');
    logger.info('   - webhook_subscriptions (event subscriptions)');
    logger.info('   - webhook_delivery_logs (delivery tracking)');
    logger.info('   - payment_audit_log (FCA AML compliance)');
    logger.info('   - agent_reputation (trust scores per agent)');
    logger.info('   - revenue_events (unified revenue ledger)');
    logger.info('   - payment_intents (upcoming payment requests)');
    logger.info('   - verification_certificates (signed certificates)');
    logger.info('   - merchant_invoices (platform-fee invoices)');
    logger.info('   - mcp_usage_events (hosted MCP metering ledger)');
    logger.info('   - capability_vault_entries (generic capability store)');
    logger.info('   - capability_connect_sessions (capability handshakes)');
    logger.info('   - oauth_clients (MCP OAuth clients)');
    logger.info('   - oauth_authorization_codes (MCP OAuth PKCE codes)');
    logger.info('   - oauth_email_link_attempts (MCP OAuth no-key email link challenges)');
    logger.info('   - hosted_action_sessions (resumable human-step continuity)');
    logger.info('   - capability_access_logs (capability audit trail)');
    logger.info('   - capability_usage_events (capability usage ledger)');
    logger.info('   - bots (Moltbook bot economy)');
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
