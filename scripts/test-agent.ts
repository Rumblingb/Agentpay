#!/usr/bin/env tsx
/**
 * AgentPay Test Agent Script
 *
 * Simulates an autonomous AI agent that:
 *   1. Registers (or re-uses) a merchant account
 *   2. Creates a payment request via the /api/payments endpoint
 *   3. Describes how to send the USDC on Solana Devnet
 *   4. Optionally verifies a real transaction hash if provided via env var
 *
 * Usage:
 *   npx tsx scripts/test-agent.ts
 *
 * Environment variables:
 *   API_BASE           - Base URL of the AgentPay backend (default: http://localhost:3001)
 *   AGENT_API_KEY      - Existing merchant API key to skip registration
 *   TRANSACTION_HASH   - Solana Devnet tx hash to verify after creating the payment
 */

import 'dotenv/config';

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const POLL_INTERVAL_MS = 10_000;  // 10 s between attempts
const MAX_POLLS = 6;              // stop after 60 s (POLL_INTERVAL_MS * MAX_POLLS)
// Solana Devnet wallet used as both the test merchant wallet and demo payment recipient.
// Replace with a funded wallet address for real Devnet testing.
const TEST_WALLET_ADDRESS = '9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiRequest<T = any>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  apiKey?: string
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json()) as T;
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function banner(text: string): void {
  const line = '─'.repeat(text.length + 4);
  console.log(`\n┌${line}┐`);
  console.log(`│  ${text}  │`);
  console.log(`└${line}┘`);
}

// ---------------------------------------------------------------------------
// Main agent flow
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  banner('🤖  AgentPay Test Agent');

  // ── Step 1: authenticate ──────────────────────────────────────────────────
  let apiKey = process.env.AGENT_API_KEY || '';
  let merchantId: string;

  if (apiKey) {
    console.log('\n[1/4] Using provided API key — fetching merchant profile...');
    const profile = await apiRequest<{ id: string; name: string }>(
      'GET',
      '/api/merchants/profile',
      undefined,
      apiKey
    );
    merchantId = profile.id;
    console.log(`      ✅  Authenticated as "${profile.name}" (${merchantId})`);
  } else {
    console.log('\n[1/4] No AGENT_API_KEY set — registering a new merchant...');
    const reg = await apiRequest<{
      success: boolean;
      merchantId: string;
      apiKey: string;
    }>('POST', '/api/merchants/register', {
      name: 'Test Agent Merchant',
      email: `agent-${Date.now()}@test.example.com`,
      walletAddress: TEST_WALLET_ADDRESS,
    });

    apiKey = reg.apiKey;
    merchantId = reg.merchantId;
    console.log(`      ✅  Merchant registered: ${merchantId}`);
    console.log(`      🔑  API Key: ${apiKey}`);
    console.log('      ⚠️   Save this key!  Re-use it with: AGENT_API_KEY=<key> npx tsx scripts/test-agent.ts\n');
  }

  // ── Step 2: create payment request ────────────────────────────────────────
  console.log('\n[2/4] Creating payment request via POST /api/payments ...');
  const payment = await apiRequest<{
    success: boolean;
    transactionId: string;
    paymentId: string;
    amount: number;
    recipientAddress: string;
    instructions: string;
  }>('POST', '/api/payments', {
    amount_usdc: 10.50,
    recipient_address: TEST_WALLET_ADDRESS,
    description: 'AI Agent Subscription Fee',
  }, apiKey);

  console.log(`      ✅  Payment request created:`);
  console.log(`         Transaction ID : ${payment.transactionId}`);
  console.log(`         Payment ID     : ${payment.paymentId}`);
  console.log(`         Amount         : ${payment.amount} USDC`);
  console.log(`         Recipient      : ${payment.recipientAddress}`);

  // ── Step 3: Solana Devnet transfer instructions ───────────────────────────
  console.log('\n[3/4] Solana Devnet transfer instructions:');
  console.log('      In a real agent deployment, this step would:');
  console.log('        1. Load a funded Solana wallet (keypair from env / secrets manager)');
  console.log('        2. Build a SPL-Token "transfer" instruction for USDC');
  console.log('        3. Sign and submit the transaction to Solana Devnet');
  console.log('        4. Capture the returned transaction signature (hash)');
  console.log('');
  console.log('      Example using @solana/web3.js + @solana/spl-token:');
  console.log('        const tx = await transfer(connection, payer, srcATA, destATA, payer.publicKey, 10_500_000);');
  console.log('        // then call: POST /api/merchants/payments/<transactionId>/verify');
  console.log('        //           { "transactionHash": tx }');
  console.log('');
  console.log('      Solana Pay QR / deeplink:');
  console.log(`        solana:${payment.recipientAddress}?amount=10.50&spl-token=<USDC_MINT>&label=AgentPay`);

  // ── Step 4: verify (optional — only if TRANSACTION_HASH is provided) ──────
  const txHash = process.env.TRANSACTION_HASH;

  if (!txHash) {
    console.log('\n[4/4] Verification skipped — no TRANSACTION_HASH provided.');
    console.log('      To verify a real Devnet transaction, run:');
    console.log(`        TRANSACTION_HASH=<hash> npx tsx scripts/test-agent.ts`);

    // Show current dashboard stats to confirm the pending payment appears
    console.log('\n📊  Current merchant stats:');
    const stats = await apiRequest<{
      totalTransactions: number;
      confirmedCount: number;
      pendingCount: number;
      totalConfirmedUsdc: number;
    }>('GET', '/api/merchants/stats', undefined, apiKey);
    console.log(`     Total Transactions : ${stats.totalTransactions}`);
    console.log(`     Confirmed          : ${stats.confirmedCount}`);
    console.log(`     Pending            : ${stats.pendingCount}`);
    console.log(`     Total USDC         : $${stats.totalConfirmedUsdc}`);
    console.log('\n✅  Demo complete!  Refresh your dashboard to see the pending payment.\n');
    return;
  }

  console.log(`\n[4/4] Verifying transaction hash: ${txHash}`);
  let verified = false;

  for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
    try {
      const result = await apiRequest<{
        success: boolean;
        verified: boolean;
        payer?: string;
        message: string;
      }>(
        'POST',
        `/api/merchants/payments/${payment.transactionId}/verify`,
        { transactionHash: txHash },
        apiKey
      );

      if (result.verified) {
        console.log('\n🎉  Payment CONFIRMED on-chain!');
        console.log(`    Payer   : ${result.payer ?? 'n/a'}`);
        console.log('    A webhook event has been fired to your registered URL (if configured).');
        verified = true;
        break;
      }

      console.log(`    [${attempt}/${MAX_POLLS}] ${result.message} — retrying in ${POLL_INTERVAL_MS / 1000}s...`);
    } catch (err: any) {
      console.log(`    [${attempt}/${MAX_POLLS}] Verification error: ${err.message}`);
    }

    if (attempt < MAX_POLLS) await sleep(POLL_INTERVAL_MS);
  }

  if (!verified) {
    console.log('\n⚠️   Payment not yet confirmed after all retries.');
    console.log('     The Solana Listener will continue checking automatically in the background.');
  }

  console.log('\n✅  Agent script complete!\n');
}

// ---------------------------------------------------------------------------

run().catch((err: Error) => {
  console.error('\n❌  Agent failed:', err.message);
  process.exit(1);
});
