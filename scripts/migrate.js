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
  {
    name: '013_create_agentrank_scores',
    sql: `CREATE TABLE IF NOT EXISTS agentrank_scores (
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
          CREATE INDEX IF NOT EXISTS idx_agentrank_scores_score ON agentrank_scores(score DESC);`,
  },
  {
    name: '014_add_total_volume_to_merchants',
    sql: `ALTER TABLE merchants
            ADD COLUMN IF NOT EXISTS total_volume NUMERIC(20, 6) NOT NULL DEFAULT 0;`,
  },
  {
    name: '015_add_metadata_to_transactions',
    sql: `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS metadata JSONB;`,
  },
  {
    name: '016_create_agent_wallets',
    sql: `CREATE TABLE IF NOT EXISTS agent_wallets (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_id TEXT UNIQUE NOT NULL,
            public_key TEXT NOT NULL,
            encrypted_private_key TEXT NOT NULL,
            balance_usdc NUMERIC(20, 6) DEFAULT 0,
            label TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_agent_wallets_agent_id ON agent_wallets(agent_id);
          CREATE INDEX IF NOT EXISTS idx_agent_wallets_public_key ON agent_wallets(public_key);`,
  },
  {
    name: '018_create_agents',
    sql: `CREATE TABLE IF NOT EXISTS agents (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            merchant_id  UUID REFERENCES merchants(id) ON DELETE SET NULL,
            display_name VARCHAR(255) NOT NULL,
            public_key   TEXT,
            risk_score   INTEGER NOT NULL DEFAULT 500,
            created_at   TIMESTAMPTZ DEFAULT NOW(),
            updated_at   TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_agents_merchant_id ON agents(merchant_id);`,
  },
  {
    name: '019_add_agent_id_protocol_to_payment_intents',
    sql: `ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
          ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS protocol VARCHAR(50);
          CREATE INDEX IF NOT EXISTS idx_payment_intents_agent_id ON payment_intents(agent_id);`,
  },
  // ── AgentPay Network migrations ──────────────────────────────────────────
  {
    name: '020_add_network_fields_to_agents',
    sql: `ALTER TABLE agents
            ADD COLUMN IF NOT EXISTS service VARCHAR(100),
            ADD COLUMN IF NOT EXISTS endpoint_url TEXT,
            ADD COLUMN IF NOT EXISTS pricing_model JSONB DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS rating FLOAT NOT NULL DEFAULT 5.0,
            ADD COLUMN IF NOT EXISTS total_earnings FLOAT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tasks_completed INT NOT NULL DEFAULT 0;
          CREATE INDEX IF NOT EXISTS idx_agents_service ON agents(service);
          CREATE INDEX IF NOT EXISTS idx_agents_rating ON agents(rating DESC);`,
  },
  {
    name: '021_create_agent_transactions',
    sql: `CREATE TABLE IF NOT EXISTS agent_transactions (
            id             TEXT PRIMARY KEY,
            buyer_agent_id TEXT NOT NULL,
            seller_agent_id TEXT NOT NULL,
            task           JSONB NOT NULL DEFAULT '{}',
            status         VARCHAR(50) NOT NULL DEFAULT 'pending',
            amount         FLOAT NOT NULL,
            escrow_id      TEXT,
            output         JSONB,
            created_at     TIMESTAMPTZ DEFAULT NOW(),
            updated_at     TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_agent_tx_buyer ON agent_transactions(buyer_agent_id);
          CREATE INDEX IF NOT EXISTS idx_agent_tx_seller ON agent_transactions(seller_agent_id);
          CREATE INDEX IF NOT EXISTS idx_agent_tx_status ON agent_transactions(status);
          CREATE INDEX IF NOT EXISTS idx_agent_tx_created ON agent_transactions(created_at DESC);`,
  },
  {
    name: '022_create_agent_escrow',
    sql: `CREATE TABLE IF NOT EXISTS agent_escrow (
            id             TEXT PRIMARY KEY,
            transaction_id TEXT NOT NULL,
            amount         FLOAT NOT NULL,
            status         VARCHAR(50) NOT NULL DEFAULT 'locked',
            created_at     TIMESTAMPTZ DEFAULT NOW(),
            updated_at     TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_agent_escrow_tx ON agent_escrow(transaction_id);`,
  },
  {
    name: '023_create_agent_reputation_network',
    sql: `CREATE TABLE IF NOT EXISTS agent_reputation_network (
            id               TEXT PRIMARY KEY,
            agent_id         TEXT UNIQUE NOT NULL,
            success_rate     FLOAT NOT NULL DEFAULT 1.0,
            dispute_rate     FLOAT NOT NULL DEFAULT 0.0,
            avg_response_time INT NOT NULL DEFAULT 0,
            rating           FLOAT NOT NULL DEFAULT 5.0,
            total_tx         INT NOT NULL DEFAULT 0,
            updated_at       TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_agent_rep_network_agent_id ON agent_reputation_network(agent_id);`,
  },
  {
    name: '017_trigger_auto_create_transaction',
    sql: `
      CREATE OR REPLACE FUNCTION auto_create_transaction_on_intent_complete()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
          INSERT INTO transactions
            (merchant_id, payment_id, amount_usdc, recipient_address,
             status, webhook_status, metadata, created_at, updated_at)
          SELECT
            NEW.merchant_id,
            NEW.id,
            NEW.amount::NUMERIC(20,6),
            m.wallet_address,
            'released',
            'not_sent',
            NEW.metadata,
            NOW(),
            NOW()
          FROM merchants m
          WHERE m.id = NEW.merchant_id
          ON CONFLICT (payment_id) DO NOTHING;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trigger_auto_transaction ON payment_intents;
      CREATE TRIGGER trigger_auto_transaction
        AFTER UPDATE OF status ON payment_intents
        FOR EACH ROW
        EXECUTE FUNCTION auto_create_transaction_on_intent_complete();`,
  },
  // ── 025 KYC / AML tables ─────────────────────────────────────────────────
  {
    name: '025_kyc_aml_tables',
    sql: `
      -- KYC submissions (one per agent, upsert-safe)
      CREATE TABLE IF NOT EXISTS kyc_submissions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id     TEXT NOT NULL UNIQUE,
        owner_email  TEXT NOT NULL,
        owner_id     TEXT,
        kyc_provider TEXT DEFAULT 'manual',
        document_type TEXT,
        document_ref  TEXT,
        region_code   CHAR(2),
        status        TEXT NOT NULL DEFAULT 'pending',
        metadata      JSONB DEFAULT '{}',
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_kyc_agent ON kyc_submissions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_submissions(status);

      -- KYC supporting documents
      CREATE TABLE IF NOT EXISTS kyc_documents (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_id UUID REFERENCES kyc_submissions(id) ON DELETE CASCADE,
        document_type TEXT NOT NULL,
        storage_ref   TEXT NOT NULL,
        verified      BOOLEAN DEFAULT FALSE,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      -- AML flags (append-only audit log)
      CREATE TABLE IF NOT EXISTS aml_flags (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id       TEXT NOT NULL,
        flags          JSONB NOT NULL DEFAULT '[]',
        score          INT NOT NULL DEFAULT 0,
        ip_address     TEXT,
        wallet_address TEXT,
        region_code    TEXT,
        metadata       JSONB DEFAULT '{}',
        created_at     TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_aml_agent ON aml_flags(agent_id);
      CREATE INDEX IF NOT EXISTS idx_aml_created ON aml_flags(created_at);
    `,
  },

  // ── 026 RBAC roles tables ─────────────────────────────────────────────────
  {
    name: '026_rbac_roles',
    sql: `
      CREATE TABLE IF NOT EXISTS roles (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Seed built-in roles (idempotent)
      INSERT INTO roles (name, description) VALUES
        ('admin',    'Full system access'),
        ('platform', 'Platform operator access'),
        ('merchant', 'Merchant account access'),
        ('agent',    'Agent access')
      ON CONFLICT (name) DO NOTHING;

      CREATE TABLE IF NOT EXISTS user_roles (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_id  TEXT NOT NULL,       -- merchant.id or agent.id
        subject_type TEXT NOT NULL,      -- 'merchant' | 'agent'
        role_name   TEXT NOT NULL REFERENCES roles(name),
        granted_by  TEXT,
        granted_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(subject_id, role_name)
      );
      CREATE INDEX IF NOT EXISTS idx_user_roles_subject ON user_roles(subject_id);
    `,
  },

  // ── 027 Multi-tenant platforms table ─────────────────────────────────────
  {
    name: '027_platforms',
    sql: `
      CREATE TABLE IF NOT EXISTS platforms (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         TEXT NOT NULL,
        api_key_hash TEXT NOT NULL UNIQUE,
        is_active    BOOLEAN DEFAULT TRUE,
        metadata     JSONB DEFAULT '{}',
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_platforms_key ON platforms(api_key_hash);

      -- Soft add platform_id to core tables (nullable for backward compat)
      ALTER TABLE agents       ADD COLUMN IF NOT EXISTS platform_id TEXT DEFAULT 'default';
      ALTER TABLE agent_transactions ADD COLUMN IF NOT EXISTS platform_id TEXT DEFAULT 'default';
      ALTER TABLE escrow_transactions ADD COLUMN IF NOT EXISTS platform_id TEXT DEFAULT 'default';
      CREATE INDEX IF NOT EXISTS idx_agents_platform ON agents(platform_id);
    `,
  },

  // ── 028 Webhook deliveries table ─────────────────────────────────────────
  {
    name: '028_webhook_deliveries',
    sql: `
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id  TEXT,
        event_type   TEXT NOT NULL,
        url          TEXT NOT NULL,
        payload      TEXT,
        status_code  INT,
        response_body TEXT,
        attempt      INT DEFAULT 1,
        success      BOOLEAN DEFAULT FALSE,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_del_merchant ON webhook_deliveries(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_del_event ON webhook_deliveries(event_type);
      CREATE INDEX IF NOT EXISTS idx_webhook_del_created ON webhook_deliveries(created_at);
    `,
  },

  // ── 029 Incentive / reward events table ──────────────────────────────────
  {
    name: '029_reward_events',
    sql: `
      CREATE TABLE IF NOT EXISTS reward_events (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id   TEXT NOT NULL,
        event_type TEXT NOT NULL,   -- BONUS | BOOST | PENALTY
        amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
        reason     TEXT,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_reward_agent ON reward_events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_reward_expires ON reward_events(expires_at);
    `,
  },

  {
    name: '024_agent_embedding_vector',
    sql: `
      -- Enable pgvector extension (no-op if already enabled, safe on plain Postgres)
      DO $$
      BEGIN
        CREATE EXTENSION IF NOT EXISTS vector;
      EXCEPTION WHEN OTHERS THEN
        -- pgvector not installed — skip gracefully
        NULL;
      END;
      $$;

      -- Add embedding column to agents table (optional — only added if vector type is available)
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'vector'
        ) THEN
          ALTER TABLE agents ADD COLUMN IF NOT EXISTS embedding vector(1536);
          CREATE INDEX IF NOT EXISTS agents_embedding_cosine_idx
            ON agents USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);
        END IF;
      END;
      $$;`,
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
