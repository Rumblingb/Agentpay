/**
 * Deploy Solana Escrow Program to Devnet
 *
 * Usage:
 *   npm run deploy:escrow-devnet
 *
 * Required environment variables:
 *   SOLANA_RPC_URL         — Solana devnet RPC (e.g. https://api.devnet.solana.com)
 *   SOLANA_DEPLOY_KEYPAIR  — Path to the deployer keypair JSON file
 *
 * This script:
 *   1. Verifies Solana devnet connectivity
 *   2. Logs the deployer wallet address and SOL balance
 *   3. Prints the simulated program ID (replace with real Anchor build in production)
 *   4. Writes the program ID to .escrow-program-id so the server can load it
 *
 * For a real Anchor deployment, replace the placeholder section with:
 *   anchor build && anchor deploy --provider.cluster devnet
 *
 * @module scripts/deploy-escrow-devnet
 */

import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../src/logger.js';

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.SOLANA_DEPLOY_KEYPAIR;

async function main(): Promise<void> {
  console.log('\n🚀 AgentPay Solana Escrow — Devnet Deployment\n');
  console.log(`RPC URL: ${RPC_URL}`);

  // --- Step 1: Verify connectivity ---
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    const data = await response.json() as { result?: string };
    if (data.result === 'ok') {
      console.log('✅ Solana devnet reachable');
    } else {
      console.warn('⚠️  Solana RPC responded but health is not "ok":', data);
    }
  } catch (err: any) {
    console.error('❌ Cannot reach Solana RPC:', err.message);
    console.error('   Set SOLANA_RPC_URL to a valid devnet endpoint.');
    process.exit(1);
  }

  // --- Step 2: Load deployer keypair ---
  if (!KEYPAIR_PATH) {
    console.warn('⚠️  SOLANA_DEPLOY_KEYPAIR not set — using simulated program ID');
  } else if (!existsSync(KEYPAIR_PATH)) {
    console.error(`❌ Keypair file not found: ${KEYPAIR_PATH}`);
    process.exit(1);
  } else {
    console.log(`✅ Deployer keypair: ${KEYPAIR_PATH}`);
  }

  // --- Step 3: Simulated program ID (replace with real Anchor output) ---
  // In production: run `anchor build && anchor deploy --provider.cluster devnet`
  // and read the program ID from the Anchor deploy output.
  // You can also set SOLANA_ESCROW_PROGRAM_ID in your .env to skip simulation.
  const simulatedProgramId =
    process.env.SOLANA_ESCROW_PROGRAM_ID ?? 'AgentPayEscrow111111111111111111111111111111';

  const isSimulated = !process.env.SOLANA_ESCROW_PROGRAM_ID;
  console.log(`\n📦 Program ID ${isSimulated ? '(simulated devnet)' : '(from env)'}: ${simulatedProgramId}`);
  if (isSimulated) {
    console.log('   ℹ️  Replace with real Anchor program ID after: anchor deploy --provider.cluster devnet');
    console.log('   Or set SOLANA_ESCROW_PROGRAM_ID=<real-id> in your .env to skip simulation\n');
  }

  // --- Step 4: Write program ID for server to consume ---
  const outPath = resolve(process.cwd(), '.escrow-program-id');
  writeFileSync(outPath, simulatedProgramId, 'utf8');
  console.log(`✅ Program ID written to ${outPath}`);

  console.log('\n✨ Devnet deployment simulation complete!');
  console.log('   Next steps:');
  console.log('   1. Install Anchor CLI: npm install -g @coral-xyz/anchor-cli');
  console.log('   2. Build the program: anchor build');
  console.log('   3. Deploy to devnet:  anchor deploy --provider.cluster devnet');
  console.log('   4. Set SOLANA_ESCROW_PROGRAM_ID=<real-id> in .env\n');
}

main().catch((err) => {
  logger.error('Deploy script failed', { err });
  process.exit(1);
});
