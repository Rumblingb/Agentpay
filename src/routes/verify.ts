import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

const router = Router();

// Valid transaction hashes: relaxed alphanumeric pattern covering Solana base58 and EVM hex formats
const TX_HASH_PATTERN = /^[a-zA-Z0-9]{16,128}$/;

router.get('/:txHash', async (req: Request, res: Response) => {
  const { txHash } = req.params;

  if (!txHash || !TX_HASH_PATTERN.test(txHash)) {
    res.status(400).json({ error: 'Invalid or missing txHash format' });
    return;
  }

  try {
    const result = await query(
      `SELECT id, merchant_id, agent_id, status, created_at
         FROM transactions WHERE transaction_hash = $1`,
      [txHash]
    );

    const row = result.rows[0] ?? null;
    const verified = row !== null && row.status === 'confirmed';

    const payload = {
      verified,
      intentId: row?.id ?? null,
      agentId: row?.agent_id ?? null,
      merchantId: row?.merchant_id ?? null,
      settlementTimestamp: row?.created_at ? new Date(row.created_at).toISOString() : null,
    };

    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      logger.error('HMAC secret not configured for verify endpoint');
      res.status(500).json({ error: 'Server misconfiguration: HMAC secret not set' });
      return;
    }
    const signature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    res.json({ ...payload, signature });
  } catch (err: any) {
    logger.error('Verify endpoint error', { err });
    res.status(500).json({ error: 'Failed to verify transaction' });
  }
});

export default router;
