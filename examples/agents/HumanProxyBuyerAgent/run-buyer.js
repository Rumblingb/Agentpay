#!/usr/bin/env node
/**
 * HumanProxyBuyerAgent — The demand side of the AgentPay Network.
 *
 * Translates a single natural-language task into a multi-step agent hiring
 * chain, proving that real money flows from a human intent through the
 * autonomous agent economy.
 *
 * Flow:
 *   1. Discover ResearchAgent + TranslatorAgent from /api/agents/discover
 *   2. Start a local callback server to receive async task outputs
 *   3. Hire ResearchAgent ($1.50)  → wait for research output
 *   4. Hire TranslatorAgent ($0.10) → wait for Spanish translation
 *   5. Print the final result + total money spent
 *
 * Usage:
 *   node run-buyer.js "Research the top 3 AI crypto coins and translate to Spanish"
 *
 * Environment variables:
 *   AGENTPAY_API_URL  — AgentPay backend base URL   (default: http://localhost:3001)
 *   AGENTPAY_API_KEY  — Merchant API key             (required)
 *   BUYER_AGENT_ID    — Buyer identity string        (default: "human-proxy-buyer")
 *   CALLBACK_PORT     — Local port for callbacks     (default: 3999)
 *   CALLBACK_HOST     — Public base URL for callbacks (default: http://localhost:PORT)
 *                       Set this when AgentPay runs on a remote server so sellers
 *                       can reach your local callback endpoint (e.g. via ngrok).
 *   TASK_TIMEOUT_MS   — Max ms to wait per step      (default: 120000)
 */

import express from 'express';
import axios from 'axios';
import { createServer } from 'http';

// ─── Configuration ─────────────────────────────────────────────────────────────
const AGENTPAY_BASE   = process.env.AGENTPAY_API_URL  ?? 'http://localhost:3001';
const API_KEY         = process.env.AGENTPAY_API_KEY;
const BUYER_AGENT_ID  = process.env.BUYER_AGENT_ID    ?? 'human-proxy-buyer';
const CALLBACK_PORT   = parseInt(process.env.CALLBACK_PORT ?? '3999', 10);
const TASK_TIMEOUT_MS = parseInt(process.env.TASK_TIMEOUT_MS ?? '120000', 10);

// Prices for each step (matches example agent pricing models)
const RESEARCH_AMOUNT   = 1.50;
const TRANSLATE_AMOUNT  = 0.10;

// ─── Argument validation ───────────────────────────────────────────────────────
const taskArg = process.argv[2];

if (!taskArg || taskArg.trim().length === 0) {
  console.error('\n❌  Task argument required.');
  console.error(
    '    Usage: node run-buyer.js "Research the top 3 AI crypto coins and translate to Spanish"\n',
  );
  process.exit(1);
}

if (!API_KEY) {
  console.error('\n❌  AGENTPAY_API_KEY environment variable is required.');
  console.error('    Get your key from the AgentPay dashboard, then run:');
  console.error('    AGENTPAY_API_KEY=sk_test_xxx node run-buyer.js "<task>"\n');
  process.exit(1);
}

// ─── Local callback server ─────────────────────────────────────────────────────
// Seller agents POST their results here when using buyerCallbackUrl mode.
const app = express();
app.use(express.json());

/** Maps transactionId → { resolve, reject } for awaiting seller callbacks. */
const pending = new Map();

app.post('/callback', (req, res) => {
  const { transactionId, output } = req.body ?? {};
  if (!transactionId) {
    res.status(400).json({ error: 'transactionId required' });
    return;
  }

  console.log(`\n   📨 Callback received  tx=${transactionId}`);

  const resolver = pending.get(transactionId);
  if (resolver) {
    pending.delete(transactionId);
    resolver.resolve(output ?? {});
  } else {
    // Could arrive after timeout — log and ignore
    console.warn(`   ⚠️  No pending resolver for tx: ${transactionId} (may have timed out)`);
  }

  res.json({ success: true });
});

/**
 * Wait up to TASK_TIMEOUT_MS for a seller to POST to /callback.
 * @param {string} transactionId
 * @returns {Promise<object>} The output payload from the seller
 */
function waitForCallback(transactionId) {
  return new Promise((resolve, reject) => {
    pending.set(transactionId, { resolve, reject });

    setTimeout(() => {
      if (pending.has(transactionId)) {
        pending.delete(transactionId);
        reject(
          new Error(
            `Timed out waiting for callback on tx=${transactionId} after ${TASK_TIMEOUT_MS}ms.\n` +
              '    Is the seller agent running and reachable? ' +
              'Check CALLBACK_HOST if running against a remote AgentPay server.',
          ),
        );
      }
    }, TASK_TIMEOUT_MS);
  });
}

// ─── AgentPay API helpers ──────────────────────────────────────────────────────
const authHeaders = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

/**
 * Discover agents for a given service type.
 * @param {string} service  e.g. 'research' | 'translation'
 * @returns {Promise<Array>}
 */
async function discoverAgents(service) {
  const res = await axios.get(`${AGENTPAY_BASE}/api/agents/discover`, {
    params: { service },
    timeout: 10_000,
  });
  return res.data.agents ?? [];
}

/**
 * Hire a seller agent and route its callback to our local server.
 *
 * @param {object} opts
 * @param {string} opts.sellerAgentId
 * @param {object} opts.task
 * @param {number} opts.amount
 * @param {string} opts.callbackUrl  URL the seller should POST results to
 * @returns {Promise<object>}  hire response (transactionId, escrowId, fees, …)
 */
async function hire({ sellerAgentId, task, amount, callbackUrl }) {
  const res = await axios.post(
    `${AGENTPAY_BASE}/api/agents/hire`,
    {
      buyerAgentId: BUYER_AGENT_ID,
      sellerAgentId,
      task,
      amount,
      buyerCallbackUrl: callbackUrl, // tell AgentPay to forward callback here
    },
    { headers: authHeaders, timeout: 15_000 },
  );
  return res.data;
}

/**
 * Mark a transaction complete and release the seller's escrow.
 * Called by the buyer after receiving and verifying the seller's output.
 *
 * @param {string} transactionId
 * @param {object} output
 */
async function completeTransaction(transactionId, output) {
  await axios.post(
    `${AGENTPAY_BASE}/api/agents/complete`,
    { transactionId, output },
    { timeout: 10_000 },
  );
}

// ─── Main demo flow ────────────────────────────────────────────────────────────
async function main() {
  // Start the local callback server
  const server = createServer(app);
  await new Promise((resolve) => server.listen(CALLBACK_PORT, resolve));

  const callbackHost = process.env.CALLBACK_HOST ?? `http://localhost:${CALLBACK_PORT}`;
  const callbackUrl  = `${callbackHost}/callback`;

  console.log('\n⚡  HumanProxyBuyerAgent — AgentPay Network Demo');
  console.log(`   API:       ${AGENTPAY_BASE}`);
  console.log(`   Callback:  ${callbackUrl}`);
  console.log(`   Task:      "${taskArg}"\n`);

  let totalSpent = 0;

  try {
    // ── Step 0: Discover agents ──────────────────────────────────────────────
    console.log('🔍  Discovering agents on the network…');

    const [researchAgents, translatorAgents] = await Promise.all([
      discoverAgents('research'),
      discoverAgents('translation'),
    ]);

    const researchAgent   = researchAgents[0];
    const translatorAgent = translatorAgents[0];

    if (!researchAgent) {
      throw new Error(
        'No ResearchAgent found.\n' +
          '    Deploy one: cd examples/agents/ResearchAgent && npm start\n' +
          '    Then register it: agentpay deploy --name ResearchAgent --service research ...',
      );
    }
    if (!translatorAgent) {
      throw new Error(
        'No TranslatorAgent found.\n' +
          '    Deploy one: cd examples/agents/TranslatorAgent && npm start\n' +
          '    Then register it: agentpay deploy --name TranslatorAgent --service translation ...',
      );
    }

    console.log(`   ✓ ResearchAgent:    ${researchAgent.name}  (${researchAgent.agentId.slice(0, 14)}…)`);
    console.log(`   ✓ TranslatorAgent:  ${translatorAgent.name}  (${translatorAgent.agentId.slice(0, 14)}…)\n`);

    // ── Step 1: Hire ResearchAgent ───────────────────────────────────────────
    console.log(`🧪  Step 1 — Hiring ResearchAgent for $${RESEARCH_AMOUNT.toFixed(2)}…`);

    const researchHire = await hire({
      sellerAgentId: researchAgent.agentId,
      task: { query: taskArg, numSources: 5 },
      amount: RESEARCH_AMOUNT,
      callbackUrl,
    });

    totalSpent += RESEARCH_AMOUNT;

    console.log(`   TX:             ${researchHire.transactionId}`);
    console.log(`   Platform fee:   $${researchHire.platformFee?.toFixed(4) ?? '?'}`);
    console.log(`   Seller receives: $${researchHire.sellerReceives?.toFixed(4) ?? '?'}`);
    console.log(`   Callback mode:  ${researchHire.callbackMode}`);
    console.log('   ⏳  Waiting for research output…');

    const researchOutput = await waitForCallback(researchHire.transactionId);

    // Release escrow — verifies delivery and pays the seller
    await completeTransaction(researchHire.transactionId, researchOutput);
    console.log('   ✅  Research done + escrow released.');

    const reportText =
      typeof researchOutput.report === 'string'
        ? researchOutput.report
        : JSON.stringify(researchOutput).slice(0, 3000);

    console.log(`\n📊  Research preview:\n   ${reportText.slice(0, 250).replace(/\n/g, '\n   ')}…\n`);

    // ── Step 2: Hire TranslatorAgent with research output ────────────────────
    console.log(`🌍  Step 2 — Hiring TranslatorAgent for $${TRANSLATE_AMOUNT.toFixed(2)}…`);

    const translateHire = await hire({
      sellerAgentId: translatorAgent.agentId,
      task: {
        text: reportText,
        targetLanguage: 'Spanish',
        sourceLanguage: 'English',
      },
      amount: TRANSLATE_AMOUNT,
      callbackUrl,
    });

    totalSpent += TRANSLATE_AMOUNT;

    console.log(`   TX:              ${translateHire.transactionId}`);
    console.log(`   Platform fee:    $${translateHire.platformFee?.toFixed(4) ?? '?'}`);
    console.log(`   Seller receives: $${translateHire.sellerReceives?.toFixed(4) ?? '?'}`);
    console.log('   ⏳  Waiting for translation…');

    const translateOutput = await waitForCallback(translateHire.transactionId);

    // Release escrow for TranslatorAgent
    await completeTransaction(translateHire.transactionId, translateOutput);
    console.log('   ✅  Translation done + escrow released.');

    // ── Final output ─────────────────────────────────────────────────────────
    const finalText =
      typeof translateOutput.translated === 'string'
        ? translateOutput.translated
        : typeof translateOutput.text === 'string'
          ? translateOutput.text
          : JSON.stringify(translateOutput, null, 2);

    console.log('\n' + '═'.repeat(62));
    console.log('✅  FINAL RESULT (Spanish)');
    console.log('═'.repeat(62));
    console.log(finalText);
    console.log('═'.repeat(62));

    console.log(`\n💰  Money spent in this session`);
    console.log(`    ResearchAgent:    $${RESEARCH_AMOUNT.toFixed(2)}`);
    console.log(`    TranslatorAgent:  $${TRANSLATE_AMOUNT.toFixed(2)}`);
    console.log(`    ─────────────────────`);
    console.log(`    Total:            $${totalSpent.toFixed(2)}`);
    console.log('    (AgentPay Network fees deducted from seller payouts)\n');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌  Error:', err.message ?? err);
  process.exit(1);
});
