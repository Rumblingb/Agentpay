import { query } from '../db/index.js';
import { logger } from '../logger.js';

export interface AuditEntry {
  merchantId?: string | null;
  ipAddress?: string | null;
  transactionSignature?: string | null;
  transactionId?: string | null;
  endpoint: string;
  method: string;
  succeeded: boolean;
  failureReason?: string | null;
}

/**
 * Records every payment verification attempt in the append-only payment_audit_log.
 * FCA-required: captures IP, signature, and outcome regardless of success/failure.
 * Wrapped in try/catch — a logging failure must never fail the API request itself.
 */
export async function logVerifyAttempt(entry: AuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO payment_audit_log
         (merchant_id, ip_address, transaction_signature, transaction_id,
          endpoint, method, succeeded, failure_reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        entry.merchantId ?? null,
        entry.ipAddress ?? null,
        entry.transactionSignature ?? null,
        entry.transactionId ?? null,
        entry.endpoint,
        entry.method,
        entry.succeeded,
        entry.failureReason ?? null,
      ]
    );
  } catch (err) {
    // Deliberately swallow — audit log failure must not break the main request
    logger.error('Failed to write to payment_audit_log', { err });
  }
}

export default { logVerifyAttempt };
