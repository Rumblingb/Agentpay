const { Pool } = require('pg');
require('dotenv').config();

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
  is_active BOOLEAN DEFAULT true,
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
  status VARCHAR(50) DEFAULT 'pending',
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
  id UUID PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  event_type VARCHAR(50),
  transaction_id UUID REFERENCES transactions(id),
  webhook_url VARCHAR(255),
  payload JSONB,
  retry_count INTEGER DEFAULT 0,
  status VARCHAR(50),
  response_code INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
    
    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    process.exit(1);
  }
}

initializeDatabase();