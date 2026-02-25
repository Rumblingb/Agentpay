require('dotenv').config();

// Enable test-mode features (force-verify endpoint, Solana bypass).
// Gated in src/server.ts by NODE_ENV==='test' && AGENTPAY_TEST_MODE==='true'.
process.env.AGENTPAY_TEST_MODE = 'true';
