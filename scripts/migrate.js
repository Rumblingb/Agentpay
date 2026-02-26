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
