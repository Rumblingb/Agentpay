/**
 * tests/helpers/mockDb.ts
 *
 * In-memory database mock for `src/db/index.ts`.
 *
 * Provides a drop-in replacement for the `query()` function that routes
 * SQL queries to in-memory arrays, simulating PostgreSQL behaviour for
 * integration / E2E / reputation tests that previously required a live
 * Supabase connection.
 *
 * Usage in test files:
 *   jest.mock('../src/db/index', () => require('./helpers/mockDb').createMockDb());
 */

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function createMockDb() {
  // In-memory tables — keys are table names.
  const store: Record<string, any[]> = {};

  function getTable(name: string): any[] {
    if (!store[name]) store[name] = [];
    return store[name];
  }

  /* ---------- query dispatcher ----------------------------------- */

  const mockQuery = jest.fn(
    async (sql: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }> => {
      const text = sql.replace(/\s+/g, ' ').trim();
      const p = params || [];

      /* ---- TRUNCATE --------------------------------------------- */
      if (/^TRUNCATE/i.test(text)) {
        const tablesPart = text
          .replace(/^TRUNCATE\s+/i, '')
          .replace(/\s+RESTART\s+.*/i, '');
        tablesPart.split(',').forEach((t) => {
          store[t.trim()] = [];
        });
        return { rows: [], rowCount: 0 };
      }

      /* ---- DELETE ------------------------------------------------ */
      if (/^DELETE FROM\s+(\w+)/i.test(text)) {
        const table = text.match(/^DELETE FROM\s+(\w+)/i)![1];
        store[table] = [];
        return { rows: [], rowCount: 0 };
      }

      /* ---- INSERT INTO merchants -------------------------------- */
      if (/INSERT INTO merchants/i.test(text)) {
        const merchants = getTable('merchants');
        const email = p[2];
        const walletAddress = p[6];

        if (merchants.some((m) => m.email === email)) {
          const err: any = new Error(
            'duplicate key value violates unique constraint "merchants_email_key"'
          );
          err.code = '23505';
          throw err;
        }
        if (merchants.some((m) => m.wallet_address === walletAddress)) {
          const err: any = new Error(
            'duplicate key value violates unique constraint "merchants_wallet_address_key"'
          );
          err.code = '23505';
          throw err;
        }

        const record = {
          id: p[0],
          name: p[1],
          email: p[2],
          api_key_hash: p[3],
          api_key_salt: p[4],
          key_prefix: p[5],
          wallet_address: p[6],
          webhook_url: p[7] ?? null,
          is_active: p[8] ?? true,
          created_at: new Date(),
          updated_at: new Date(),
        };
        merchants.push(record);
        return { rows: [record], rowCount: 1 };
      }

      /* ---- SELECT merchants (auth by key_prefix) ---------------- */
      if (/SELECT.*FROM merchants WHERE key_prefix/i.test(text)) {
        const merchants = getTable('merchants');
        const matching = merchants.filter(
          (m) => m.key_prefix === p[0] && m.is_active !== false
        );
        const rows = matching.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          walletAddress: m.wallet_address,
          webhookUrl: m.webhook_url,
          createdAt: m.created_at,
          apiKeyHash: m.api_key_hash,
          apiKeySalt: m.api_key_salt,
        }));
        return { rows, rowCount: rows.length };
      }

      /* ---- SELECT merchants (by id) ----------------------------- */
      if (/SELECT.*FROM merchants WHERE id/i.test(text)) {
        const merchants = getTable('merchants');
        const matching = merchants.filter((m) => m.id === p[0]);
        const rows = matching.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          walletAddress: m.wallet_address,
          webhookUrl: m.webhook_url,
          createdAt: m.created_at,
        }));
        return { rows, rowCount: rows.length };
      }

      /* ---- UPDATE merchants ------------------------------------- */
      if (/UPDATE merchants/i.test(text)) {
        const merchants = getTable('merchants');
        if (/webhook_url/i.test(text)) {
          const merchant = merchants.find((m) => m.id === p[1]);
          if (merchant) {
            merchant.webhook_url = p[0];
            merchant.updated_at = new Date();
          }
          return { rows: [], rowCount: merchant ? 1 : 0 };
        }
        return { rows: [], rowCount: 0 };
      }

      /* ---- INSERT INTO transactions ----------------------------- */
      if (/INSERT INTO transactions/i.test(text)) {
        const transactions = getTable('transactions');
        const record = {
          id: p[0],
          merchant_id: p[1],
          payment_id: p[2],
          amount_usdc: p[3],
          recipient_address: p[4],
          status: p[5] ?? 'pending',
          confirmation_depth: p[6] ?? 0,
          required_depth: p[7] ?? 2,
          expires_at: p[8],
          created_at: p[9] ?? new Date(),
          payer_address: null,
          transaction_hash: null,
          webhook_status: 'not_sent',
          updated_at: null,
        };
        transactions.push(record);
        return { rows: [record], rowCount: 1 };
      }

      /* ---- SELECT transactions WHERE id ------------------------- */
      if (/SELECT.*FROM transactions WHERE id/i.test(text)) {
        const transactions = getTable('transactions');
        const matching = transactions.filter((t) => t.id === p[0]);
        const rows = matching.map((t) => ({
          id: t.id,
          merchantId: t.merchant_id,
          paymentId: t.payment_id,
          amountUsdc: t.amount_usdc,
          recipientAddress: t.recipient_address,
          payerAddress: t.payer_address,
          transactionHash: t.transaction_hash,
          status: t.status,
          confirmationDepth: t.confirmation_depth,
          requiredDepth: t.required_depth,
          expiresAt: t.expires_at,
          createdAt: t.created_at,
        }));
        return { rows, rowCount: rows.length };
      }

      /* ---- SELECT transactions WHERE merchant_id (stats) -------- */
      if (/SELECT.*FROM transactions WHERE merchant_id/i.test(text)) {
        const transactions = getTable('transactions');
        const merchantId = p[0];
        const merchantTxs = transactions.filter(
          (t) => t.merchant_id === merchantId
        );

        // Stats query (COUNT/SUM)
        if (/COUNT|SUM/i.test(text)) {
          const totalCount = merchantTxs.length;
          const confirmedCount = merchantTxs.filter(
            (t) => t.status === 'confirmed'
          ).length;
          const pendingCount = merchantTxs.filter(
            (t) => t.status === 'pending'
          ).length;
          const failedCount = merchantTxs.filter(
            (t) => t.status === 'failed'
          ).length;
          const totalConfirmedUsdc = merchantTxs
            .filter((t) => t.status === 'confirmed')
            .reduce(
              (sum: number, t: any) => sum + (parseFloat(t.amount_usdc) || 0),
              0
            );
          return {
            rows: [
              {
                totalCount: String(totalCount),
                confirmedCount: String(confirmedCount),
                pendingCount: String(pendingCount),
                failedCount: String(failedCount),
                totalConfirmedUsdc: String(totalConfirmedUsdc),
              },
            ],
            rowCount: 1,
          };
        }

        // List query
        const limit = p[1] ?? 50;
        const offset = p[2] ?? 0;
        const sliced = merchantTxs
          .sort(
            (a: any, b: any) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime()
          )
          .slice(offset, offset + limit);

        const rows = sliced.map((t: any) => ({
          id: t.id,
          merchantId: t.merchant_id,
          paymentId: t.payment_id,
          amountUsdc: t.amount_usdc,
          recipientAddress: t.recipient_address,
          payerAddress: t.payer_address,
          transactionHash: t.transaction_hash,
          status: t.status,
          confirmationDepth: t.confirmation_depth,
          requiredDepth: t.required_depth,
          expiresAt: t.expires_at,
          createdAt: t.created_at,
        }));
        return { rows, rowCount: rows.length };
      }

      /* ---- UPDATE transactions ---------------------------------- */
      if (/UPDATE transactions/i.test(text)) {
        const transactions = getTable('transactions');

        // Force-verify pattern: SET status = 'confirmed', transaction_hash = $1, ... WHERE id = $2
        if (/status\s*=\s*'confirmed'/i.test(text)) {
          const txHash = p[0];
          const txId = p[1];
          const tx = transactions.find((t) => t.id === txId);
          if (tx) {
            tx.status = 'confirmed';
            tx.transaction_hash = txHash;
            tx.confirmation_depth = tx.required_depth;
            tx.updated_at = new Date();
            return { rows: [tx], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }

        // General update: SET status = $1, transaction_hash = $2, payer_address = $3,
        //                 confirmation_depth = $4, updated_at = $5 WHERE id = $6
        if (/status\s*=\s*\$1/i.test(text)) {
          const txId = p[5];
          const tx = transactions.find((t) => t.id === txId);
          if (tx) {
            tx.status = p[0];
            tx.transaction_hash = p[1];
            tx.payer_address = p[2];
            tx.confirmation_depth = p[3];
            tx.updated_at = p[4];
            return { rows: [tx], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }

        return { rows: [], rowCount: 0 };
      }

      /* ---- INSERT INTO bots ------------------------------------- */
      if (/INSERT INTO bots/i.test(text)) {
        const bots = getTable('bots');
        const handle = p[1];

        if (bots.some((b: any) => b.handle === handle)) {
          const err: any = new Error(
            'duplicate key value violates unique constraint'
          );
          err.code = '23505';
          throw err;
        }

        const botId = generateId();
        const record = {
          id: botId,
          platform_bot_id: p[0],
          handle: p[1],
          display_name: p[2],
          bio: p[3],
          created_by: p[4],
          primary_function: p[5],
          wallet_address: p[6],
          wallet_keypair_encrypted: p[7],
          daily_spending_limit: p[8],
          per_tx_limit: p[9],
          auto_approve_under: p[10],
          daily_auto_approve_cap: p[11],
          created_at: new Date(),
        };
        bots.push(record);
        return { rows: [record], rowCount: 1 };
      }

      /* ---- SELECT bots ------------------------------------------ */
      if (/SELECT.*FROM bots/i.test(text)) {
        const bots = getTable('bots');
        const matching = bots.filter(
          (b: any) => b.id === p[0] || b.platform_bot_id === p[0]
        );
        return { rows: matching, rowCount: matching.length };
      }

      /* ---- agent_reputation SELECT ------------------------------ */
      if (/SELECT.*FROM agent_reputation/i.test(text)) {
        const reps = getTable('agent_reputation');
        const matching = reps.filter((r: any) => r.agent_id === p[0]);
        return { rows: matching, rowCount: matching.length };
      }

      /* ---- agent_reputation INSERT ------------------------------ */
      if (/INSERT INTO agent_reputation/i.test(text)) {
        const reps = getTable('agent_reputation');
        const record = {
          agent_id: p[0],
          total_payments: 1,
          success_rate: p[1],
          trust_score: p[2],
          dispute_rate: 0,
          last_payment_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        };
        reps.push(record);
        return { rows: [record], rowCount: 1 };
      }

      /* ---- agent_reputation UPDATE ------------------------------ */
      if (/UPDATE agent_reputation/i.test(text)) {
        const reps = getTable('agent_reputation');
        const agentId = p[3];
        const rep = reps.find((r: any) => r.agent_id === agentId);
        if (rep) {
          rep.total_payments = p[0];
          rep.success_rate = p[1];
          rep.trust_score = p[2];
          rep.last_payment_at = new Date();
          rep.updated_at = new Date();
          return { rows: [rep], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      /* ---- webhook_events INSERT -------------------------------- */
      if (/INSERT INTO webhook_events/i.test(text)) {
        const events = getTable('webhook_events');
        const id = generateId();
        const record = {
          id,
          merchant_id: p[0],
          event_type: p[1],
          transaction_id: p[2],
          webhook_url: p[3],
          payload: p[4],
          status: 'pending',
          max_retries: p[5],
          retry_count: 0,
          response_status: null,
          response_body: null,
          last_attempt_at: null,
          created_at: new Date(),
        };
        events.push(record);
        return { rows: [{ id }], rowCount: 1 };
      }

      /* ---- webhook_events UPDATE -------------------------------- */
      if (/UPDATE webhook_events/i.test(text)) {
        const events = getTable('webhook_events');
        const eventId = p[4];
        const event = events.find((e: any) => e.id === eventId);
        if (event) {
          event.status = p[0];
          event.retry_count = p[1];
          event.response_status = p[2];
          event.response_body = p[3];
          event.last_attempt_at = new Date();
          return { rows: [event], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      /* ---- webhook_events SELECT -------------------------------- */
      if (/SELECT.*FROM webhook_events/i.test(text)) {
        const events = getTable('webhook_events');
        const merchantId = p[0];
        let matching = events.filter(
          (e: any) => e.merchant_id === merchantId
        );

        if (/status\s*=\s*'sent'/i.test(text)) {
          matching = matching.filter((e: any) => e.status === 'sent');
        }

        matching.sort(
          (a: any, b: any) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );

        if (/LIMIT 1$/i.test(text.trim())) {
          matching = matching.slice(0, 1);
        } else if (/LIMIT 50$/i.test(text.trim())) {
          matching = matching.slice(0, 50);
        }

        return { rows: matching, rowCount: matching.length };
      }

      /* ---- payment_audit_log INSERT (fire-and-forget) ----------- */
      if (/INSERT INTO payment_audit_log/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }

      /* ---- verification_certificates INSERT (fire-and-forget) --- */
      if (/INSERT INTO verification_certificates/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }

      /* ---- UPDATE intents (Stripe webhook handler) -------------- */
      if (/UPDATE intents/i.test(text)) {
        return { rows: [], rowCount: 0 };
      }

      /* ---- Default: return empty result ------------------------- */
      return { rows: [], rowCount: 0 };
    }
  );

  return {
    query: mockQuery,
    closePool: jest.fn().mockResolvedValue(undefined),
    pool: {
      on: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
      ending: false,
    },
    getClient: jest.fn(),
  };
}
