// Load .env.test for local dev (CI sets env vars directly so dotenv won't
// override them — dotenv skips keys that are already present in process.env).
require('dotenv').config({ path: '.env.test' });
// Fallback: also read .env for any values not covered by .env.test.
require('dotenv').config();

// Enable test-mode features (force-verify endpoint, Solana bypass).
// Gated in src/server.ts by NODE_ENV==='test' && AGENTPAY_TEST_MODE==='true'.
process.env.AGENTPAY_TEST_MODE = 'true';

// Stripe requires a non-empty API key to instantiate even in test mode.
// Provide a dummy key so the module loads without throwing.
if (!process.env.STRIPE_SECRET_KEY) {
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_for_tests';
}

// Check whether the database is reachable so DB-dependent tests can skip
// gracefully instead of failing with connection errors.
try {
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl) {
    const url = new URL(dbUrl);
    require('child_process').execFileSync(
      process.execPath,
      ['-e', 'require("dns").lookup(process.argv[1],(e)=>process.exit(e?1:0))', url.hostname],
      { timeout: 5000, stdio: 'ignore' }
    );
    process.env.DB_AVAILABLE = 'true';
  } else {
    process.env.DB_AVAILABLE = 'false';
  }
} catch {
  process.env.DB_AVAILABLE = 'false';
}
