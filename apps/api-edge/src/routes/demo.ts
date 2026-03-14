import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

function isoNow(): string {
  return new Date().toISOString();
}

/** Minimal hex helper for salts/keys if needed */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

router.post('/spawn-agent', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const amount = 0.1;
    const finalState = 'U';

    // find or create demo agent
    const rows = await sql`
      SELECT id, display_name, service, operator_id, trust_score, created_at
      FROM agents
      WHERE display_name = 'DemoAgent'
      LIMIT 1
    `;

    let agent: any;
    if (rows.length) {
      agent = rows[0];
    } else {
      const agentId = crypto.randomUUID();
      const displayName = 'DemoAgent';
      const now = new Date().toISOString();
      try {
        await sql`
          INSERT INTO agents (id, merchant_id, display_name, service, operator_id, trust_score, created_at, updated_at)
          VALUES (${agentId}, ${merchant.id}, ${displayName}, 'DemoService', NULL, 50, ${now}, ${now})
        `;
      } catch (err: any) {
        if (String(err).includes('CONNECTION_CLOSED')) {
          console.warn('Retrying agents INSERT after Hyperdrive CONNECTION_CLOSED');
          await sql`
            INSERT INTO agents (id, merchant_id, display_name, service, operator_id, trust_score, created_at, updated_at)
            VALUES (${agentId}, ${merchant.id}, ${displayName}, 'DemoService', NULL, 50, ${now}, ${now})
          `;
        } else {
          throw err;
        }
      }
      const created = await sql`
        SELECT id, display_name, service, operator_id, trust_score, created_at
        FROM agents
        WHERE id = ${agentId}
        LIMIT 1
      `;
      agent = created[0];
    }

    // insert a simple transactions row (demo only)
    const transactionId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO transactions (id, merchant_id, payment_id, amount_usdc, recipient_address, status, metadata, created_at)
        VALUES (
          ${transactionId},
          ${merchant.id},
          ${paymentId},
          ${amount},
          ${merchant.walletAddress ?? 'demo-recipient'},
          'confirmed',
          ${JSON.stringify({ demo: true, spawn: true, agentId: agent.id })},
          NOW()
        )
      `;
    } catch (err: any) {
      if (String(err).includes('CONNECTION_CLOSED')) {
        console.warn('Retrying transactions INSERT after Hyperdrive CONNECTION_CLOSED');
        await sql`
          INSERT INTO transactions (id, merchant_id, payment_id, amount_usdc, recipient_address, status, metadata, created_at)
          VALUES (
            ${transactionId},
            ${merchant.id},
            ${paymentId},
            ${amount},
            ${merchant.walletAddress ?? 'demo-recipient'},
            'confirmed',
            ${JSON.stringify({ demo: true, spawn: true, agentId: agent.id })},
            NOW()
          )
        `;
      } else {
        throw err;
      }
    }

    // Skip reputation lookup in demo flow to avoid schema-dependent failures
    // (some deployments may not have `agent_reputation.total_tx` present).
    const rep: any = null;

    const receiptSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><rect width="100%" height="100%" fill="#071017" rx="8"/><text x="20" y="36" fill="#9AA4AF" font-family="Inter, sans-serif" font-size="14">AgentPay Demo Receipt</text><text x="20" y="64" fill="#F5F7FA" font-family="Inter, sans-serif" font-size="18">Tx: ${transactionId.slice(0, 8)}</text><text x="20" y="92" fill="#38BDF8" font-family="Inter, sans-serif" font-size="16">Amount: $${amount.toFixed(2)}</text></svg>`;

    const payload = {
      transactionId,
      state: finalState,
      uiStatus: 'Completed',
      amount,
      receiptSvg,
      agent: {
        id: agent.id,
        name: agent.display_name ?? null,
        role: agent.operator_id ?? 'agent',
        services: agent.service ? [agent.service] : [],
        trust_score: agent.trust_score ?? 50,
        txn_count: rep?.totalTx ?? 0,
        success_rate: rep?.successRate ?? 1.0,
        created_at: agent.created_at,
      },
      feedEvent: {
        id: crypto.randomUUID(),
        source: agent.display_name ?? 'DemoAgent',
        target: merchant.name ?? 'DemoMerchant',
        status: finalState,
        timestamp: isoNow(),
        value: amount,
      },
      message: 'Demo agent spawned and settlement simulated',
    } as const;

    return c.json(payload, 201);
  } catch (err: any) {
    console.error('spawn-agent error', err);
    return c.json(
      {
        error: 'Failed to spawn demo agent',
        debug: err?.message ?? String(err),
      },
      500,
    );
  } finally {
    // Schedule connection close without blocking the response
    try {
      c.executionCtx.waitUntil(sql.end().catch(() => {}));
    } catch (e) {
      // Fallback if executionCtx is not available for some reason
      sql.end().catch(() => {});
    }
  }
});

export { router as demoRouter };
