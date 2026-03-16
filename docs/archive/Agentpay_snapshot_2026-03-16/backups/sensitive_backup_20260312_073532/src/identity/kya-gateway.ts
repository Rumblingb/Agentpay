/**
 * KYA-Gateway — Know Your Agent identity registration and verification.
 *
 * Links an AI agent to a verified human owner via:
 *   - Email verification
 *   - Stripe account connection
 *   - Platform token (API key)
 *
 * Optional: World ID / Privado ID for Proof of Personhood (placeholder).
 *
 * Prisma migration comment — run the SQL below to create the table:
 *
 *   CREATE TABLE IF NOT EXISTS kya_identities (
 *     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     agent_id        TEXT UNIQUE NOT NULL,
 *     owner_email     TEXT NOT NULL,
 *     owner_id        TEXT,
 *     verified        BOOLEAN DEFAULT FALSE,
 *     kyc_status      TEXT NOT NULL DEFAULT 'pending'
 *                     CHECK (kyc_status IN ('pending','verified','rejected','expired')),
 *     risk_score      NUMERIC(5,2) DEFAULT 0,
 *     stripe_account  TEXT,
 *     platform_token  TEXT,
 *     world_id_hash   TEXT,
 *     metadata        JSONB DEFAULT '{}',
 *     created_at      TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at      TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * @module kya-gateway
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KycStatus = 'pending' | 'verified' | 'rejected' | 'expired';

export interface KyaIdentity {
  id: string;
  agentId: string;
  ownerEmail: string;
  ownerId: string | null;
  verified: boolean;
  kycStatus: KycStatus;
  riskScore: number;
  stripeAccount: string | null;
  platformToken: string | null;
  worldIdHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterKyaParams {
  agentId: string;
  ownerEmail: string;
  ownerId?: string;
  stripeAccount?: string;
  platformToken?: string;
  worldIdHash?: string;
}

// ---------------------------------------------------------------------------
// In-memory store (replace with DB when table is migrated)
// ---------------------------------------------------------------------------

let kyaStore: KyaIdentity[] = [];
let idCounter = 1;

function generateId(): string {
  return `kya-${Date.now()}-${idCounter++}`;
}

/** Reset store — useful for tests */
export function _resetStore(): void {
  kyaStore = [];
  idCounter = 1;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Compute a basic risk score (0–100) based on available verification signals.
 * Lower is better. Fully verified agent → 0.
 */
export function computeRiskScore(identity: Partial<KyaIdentity>): number {
  let score = 50; // base risk

  if (identity.verified) score -= 20;
  if (identity.stripeAccount) score -= 15;
  if (identity.platformToken) score -= 10;
  if (identity.worldIdHash) score -= 5;

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Gateway functions
// ---------------------------------------------------------------------------

/**
 * Register an agent identity (KYA).
 */
export function registerKya(params: RegisterKyaParams): KyaIdentity {
  if (!params.agentId) throw new Error('agentId is required');
  if (!params.ownerEmail) throw new Error('ownerEmail is required');
  if (!validateEmail(params.ownerEmail)) throw new Error('Invalid email format');

  // Prevent duplicate registrations
  const existing = kyaStore.find((k) => k.agentId === params.agentId);
  if (existing) throw new Error('Agent is already registered');

  const now = new Date();
  const hasStripe = !!params.stripeAccount;
  const hasPlatformToken = !!params.platformToken;

  // Auto-verify if both Stripe and platform token are provided
  const verified = hasStripe && hasPlatformToken;
  const kycStatus: KycStatus = verified ? 'verified' : 'pending';

  const identity: KyaIdentity = {
    id: generateId(),
    agentId: params.agentId,
    ownerEmail: params.ownerEmail,
    ownerId: params.ownerId ?? null,
    verified,
    kycStatus,
    riskScore: 0,
    stripeAccount: params.stripeAccount ?? null,
    platformToken: params.platformToken ?? null,
    worldIdHash: params.worldIdHash ?? null,
    createdAt: now,
    updatedAt: now,
  };

  identity.riskScore = computeRiskScore(identity);
  kyaStore.push(identity);

  return identity;
}

/**
 * Retrieve a KYA identity by agent ID.
 */
export function getKya(agentId: string): KyaIdentity | null {
  return kyaStore.find((k) => k.agentId === agentId) ?? null;
}

/**
 * Verify an agent identity (e.g. after email confirmation).
 */
export function verifyKya(agentId: string): KyaIdentity {
  const identity = kyaStore.find((k) => k.agentId === agentId);
  if (!identity) throw new Error('KYA identity not found');

  identity.verified = true;
  identity.kycStatus = 'verified';
  identity.riskScore = computeRiskScore(identity);
  identity.updatedAt = new Date();

  return identity;
}
