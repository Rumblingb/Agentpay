import { Pool } from 'pg';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

async function hashApiKey(apiKey: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(apiKey, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

async function registerMerchant() {
  const email = 'test@agentpay.com';
  const name = 'Test Merchant';
  const walletAddress = process.env.MERCHANT_WALLET_ADDRESS || '9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo';
  
  // Generate API key
  const apiKey = `sk_test_${crypto.randomBytes(32).toString('hex')}`;
  const { hash, salt } = await hashApiKey(apiKey);

  console.log('🔄 Registering merchant...');
  console.log('📧 Email:', email);
  console.log('👤 Name:', name);
  console.log('💳 Wallet:', walletAddress);
  console.log('');

  try {
    // First, check if merchants table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'merchants'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.error('❌ Error: merchants table does not exist!');
      console.log('\nPlease run the database migrations first:');
      console.log('  npm run db:create');
      console.log('  npm run db:migrate');
      process.exit(1);
    }

    // Register or update merchant
    const result = await pool.query(
      `INSERT INTO merchants (id, name, email, api_key_hash, api_key_salt, wallet_address, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE 
       SET api_key_hash = $3, api_key_salt = $4, updated_at = NOW()
       RETURNING id, email`,
      [name, email, hash, salt, walletAddress]
    );

    console.log('✅ Merchant registered successfully!');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 MERCHANT DETAILS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('ID:', result.rows[0].id);
    console.log('Email:', email);
    console.log('');
    console.log('🔑 API KEY (SAVE THIS - YOU CANNOT RETRIEVE IT LATER!)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(apiKey);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('📝 Add this to your dashboard/.env.local file:');
    console.log('');
    console.log(`NEXT_PUBLIC_API_KEY=${apiKey}`);
    console.log('');
    console.log('🧪 Test your API key:');
    console.log('');
    console.log(`curl -H "Authorization: Bearer ${apiKey}" http://localhost:3000/api/merchants/profile`);
    console.log('');
    
  } catch (error: any) {
    console.error('❌ Error registering merchant:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Tip: Check your DATABASE_URL in .env file');
      console.log('   Current:', process.env.DATABASE_URL ? 'Set' : 'Not set');
    }
  } finally {
    await pool.end();
  }
}

console.log('═══════════════════════════════════════════════════════════');
console.log('🚀 AgentPay - Merchant Registration Script');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

registerMerchant().catch(console.error);