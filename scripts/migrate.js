/**
 * Database migration script — adds columns/tables introduced after initial setup.
 * Safe to run multiple times (idempotent).
 * Usage: node scripts/migrate.js
 */
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrations = [
  {
    name: '001_add_key_prefix',
    sql: `ALTER TABLE merchants ADD COLUMN IF NOT EXISTS key_prefix VARCHAR(8);
          CREATE INDEX IF NOT EXISTS idx_merchants_key_prefix ON merchants(key_prefix);`,
  },
  {
    name: '002_add_webhook_url',
    sql: `ALTER TABLE merchants ADD COLUMN IF NOT EXISTS webhook_url TEXT;`,
  },
  {
    name: '003_add_webhook_status',
    sql: `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS webhook_status VARCHAR(50) DEFAULT 'not_sent';`,
  },
  {
    name: '004_create_payment_audit_log',
    sql: `CREATE TABLE IF NOT EXISTS payment_audit_log (
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
          CREATE INDEX IF NOT EXISTS idx_audit_sig ON payment_audit_log(transaction_signature);`,
  },
  {
    name: '005_fix_webhook_events_schema',
    sql: `ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3;
          ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS response_status INTEGER;
          ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS response_body TEXT;
          ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP;`,
  },
  {
    name: '006_add_stripe_fields',
    sql: `ALTER TABLE merchants ADD COLUMN IF NOT EXISTS stripe_connected_account_id VARCHAR(255);
          ALTER TABLE transactions ADD COLUMN IF NOT EXISTS stripe_payment_reference VARCHAR(255);`,
  },
  {
    name: '007_create_agent_reputation',
    sql: `CREATE TABLE IF NOT EXISTS agent_reputation (
            agent_id VARCHAR(255) PRIMARY KEY,
            trust_score INTEGER NOT NULL DEFAULT 0,
            total_payments INTEGER NOT NULL DEFAULT 0,
            success_rate FLOAT NOT NULL DEFAULT 1.0,
            dispute_rate FLOAT NOT NULL DEFAULT 0.0,
            last_payment_at TIMESTAMP,
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
          );`,
  },
  {
    name: '008_add_expires_at_to_transactions',
    sql: `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_id UUID;
          ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount_usdc NUMERIC(20, 6);
          ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recipient_address VARCHAR(255);
          ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payer_address VARCHAR(255);
          ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_hash VARCHAR(255);
          ALTER TABLE transactions ADD COLUMN IF NOT EXISTS confirmation_depth INTEGER DEFAULT 0;
          ALTER TABLE transactions ADD COLUMN IF NOT EXISTS required_depth INTEGER DEFAULT 2;
          ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
          ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`,
  },
  {
    name: '009_create_bots_table',
    sql: `CREATE TABLE IF NOT EXISTS bots (
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
          CREATE INDEX IF NOT EXISTS idx_bots_reputation ON bots(reputation_score DESC);`,
  },
  {
    name: '010_create_revenue_events',
    sql: `CREATE TABLE IF NOT EXISTS revenue_events (
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
          CREATE INDEX IF NOT EXISTS idx_revenue_events_to_entity ON revenue_events(to_entity_id);`,
  },
  {
    name: '011_create_verification_certificates',
    sql: `CREATE TABLE IF NOT EXISTS verification_certificates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            intent_id UUID REFERENCES payment_intents(id) ON DELETE SET NULL,
            payload TEXT NOT NULL,
            signature VARCHAR(255) NOT NULL,
            encoded TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_verification_certificates_intent ON verification_certificates(intent_id);`,
  },
  {
    name: '012_create_merchant_invoices',
    sql: `CREATE TABLE IF NOT EXISTS merchant_invoices (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
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
          CREATE INDEX IF NOT EXISTS idx_merchant_invoices_intent ON merchant_invoices(intent_id);`,
  },
];

async function migrate() {
  const client = await pool.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    for (const m of migrations) {
      const exists = await client.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [m.name]
      );
      if (exists.rowCount > 0) {
        console.log(`⏭  Skipping (already applied): ${m.name}`);
        continue;
      }
      console.log(`🔄 Applying migration: ${m.name}`);
      await client.query(m.sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [m.name]);
      console.log(`✅ Applied: ${m.name}`);
    }

    console.log('\n✅ All migrations complete.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
