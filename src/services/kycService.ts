/**
 * KYC/AML Compliance Service
 *
 * Provides scaffolding for Know-Your-Customer and Anti-Money-Laundering
 * workflows. Initially operates in "flag-only" mode — no transactions are
 * blocked; compliance events are logged and passed to the risk engine.
 *
 * AML signals checked:
 *   - Velocity: too many transactions in a short window
 *   - Region limits: per-region daily caps
 *   - Blacklisted wallets + IP ranges
 *
 * Tables used (created via migration 025_kyc_aml):
 *   kyc_submissions, kyc_documents, aml_flags
 */

import { query } from '../db/index.js';
import { logger } from '../logger.js';
import { metrics } from './metrics.js';

// ---------------------------------------------------------------------------
// Blacklists (extend from env / DB in production)
// ---------------------------------------------------------------------------
const BLACKLISTED_WALLETS = new Set<string>(
  (process.env.BLACKLISTED_WALLETS || '').split(',').filter(Boolean),
);

const BLACKLISTED_IP_PREFIXES: string[] = (
  process.env.BLACKLISTED_IP_PREFIXES || ''
)
  .split(',')
  .filter(Boolean);

// High-risk region codes (ISO 3166-1 alpha-2)
const HIGH_RISK_REGIONS = new Set<string>(
  (process.env.HIGH_RISK_REGIONS || 'KP,IR,SY,CU,VE').split(',').filter(Boolean),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface KycSubmission {
  agentId: string;
  ownerEmail: string;
  ownerId?: string;
  kycProvider?: string;
  documentType?: string;
  documentRef?: string;
  regionCode?: string;
  metadata?: Record<string, unknown>;
}

export interface AmlCheckInput {
  agentId: string;
  walletAddress?: string;
  ipAddress?: string;
  regionCode?: string;
  amountUsdc?: number;
  merchantId?: string;
}

export interface AmlResult {
  flagged: boolean;
  flags: string[];
  score: number; // 0–100; higher = more suspicious
}

// ---------------------------------------------------------------------------
// KYC submission
// ---------------------------------------------------------------------------
export async function submitKyc(submission: KycSubmission): Promise<{ id: string; status: string }> {
  try {
    const result = await query(
      `INSERT INTO kyc_submissions
         (agent_id, owner_email, owner_id, kyc_provider, document_type, document_ref, region_code, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (agent_id)
         DO UPDATE SET
           owner_email   = EXCLUDED.owner_email,
           owner_id      = EXCLUDED.owner_id,
           kyc_provider  = EXCLUDED.kyc_provider,
           document_type = EXCLUDED.document_type,
           document_ref  = EXCLUDED.document_ref,
           region_code   = EXCLUDED.region_code,
           metadata      = EXCLUDED.metadata,
           status        = 'pending',
           updated_at    = NOW()
       RETURNING id`,
      [
        submission.agentId,
        submission.ownerEmail,
        submission.ownerId ?? null,
        submission.kycProvider ?? 'manual',
        submission.documentType ?? null,
        submission.documentRef ?? null,
        submission.regionCode ?? null,
        JSON.stringify(submission.metadata ?? {}),
      ],
    );

    metrics.increment('kyc_submissions_total', { status: 'submitted' });
    logger.info({ agentId: submission.agentId }, '[KYC] Submission recorded');

    return { id: result.rows[0].id, status: 'pending' };
  } catch (err: any) {
    logger.error({ err: err.message, agentId: submission.agentId }, '[KYC] Submit failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// KYC status lookup
// ---------------------------------------------------------------------------
export async function getKycStatus(
  agentId: string,
): Promise<{ status: string; submittedAt: string | null } | null> {
  const result = await query(
    `SELECT status, created_at FROM kyc_submissions WHERE agent_id = $1`,
    [agentId],
  );

  if (result.rows.length === 0) return null;

  return {
    status: result.rows[0].status,
    submittedAt: result.rows[0].created_at,
  };
}

// ---------------------------------------------------------------------------
// AML scoring
// ---------------------------------------------------------------------------
export async function runAmlCheck(input: AmlCheckInput): Promise<AmlResult> {
  const flags: string[] = [];
  let score = 0;

  // 1. Blacklisted wallet
  if (input.walletAddress && BLACKLISTED_WALLETS.has(input.walletAddress)) {
    flags.push('BLACKLISTED_WALLET');
    score += 80;
  }

  // 2. Blacklisted IP prefix
  if (input.ipAddress) {
    for (const prefix of BLACKLISTED_IP_PREFIXES) {
      if (input.ipAddress.startsWith(prefix)) {
        flags.push('BLACKLISTED_IP');
        score += 60;
        break;
      }
    }
  }

  // 3. High-risk region
  if (input.regionCode && HIGH_RISK_REGIONS.has(input.regionCode.toUpperCase())) {
    flags.push('HIGH_RISK_REGION');
    score += 30;
  }

  // 4. Velocity check — > 10 transactions in last 60 minutes
  try {
    const velocityResult = await query(
      `SELECT COUNT(*) AS count
         FROM kyc_submissions
        WHERE agent_id = $1
          AND created_at > NOW() - INTERVAL '60 minutes'`,
      [input.agentId],
    );
    const recentCount = parseInt(velocityResult.rows[0]?.count ?? '0', 10);
    if (recentCount > 10) {
      flags.push('HIGH_VELOCITY');
      score += 40;
    }
  } catch {
    // Non-fatal — velocity check best-effort
  }

  // 5. Large single transaction (> $10 000 USDC)
  if (input.amountUsdc && input.amountUsdc > 10_000) {
    flags.push('LARGE_TRANSACTION');
    score += 20;
  }

  const flagged = flags.length > 0;
  const finalScore = Math.min(score, 100);

  if (flagged) {
    // Persist AML flag (best-effort — do not block transaction)
    try {
      await query(
        `INSERT INTO aml_flags (agent_id, flags, score, ip_address, wallet_address, region_code, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.agentId,
          JSON.stringify(flags),
          finalScore,
          input.ipAddress ?? null,
          input.walletAddress ?? null,
          input.regionCode ?? null,
          JSON.stringify({ merchantId: input.merchantId }),
        ],
      );
    } catch (err: any) {
      logger.warn({ err: err.message }, '[AML] Failed to persist flag — continuing');
    }

    logger.warn(
      { agentId: input.agentId, flags, score: finalScore },
      '[AML] Flag(s) raised',
    );
  }

  return { flagged, flags, score: finalScore };
}
