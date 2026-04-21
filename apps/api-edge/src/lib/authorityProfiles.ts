import type { Env } from '../types';
import { createDb, parseJsonb, type Sql } from './db';

export type AuthorityProfileStatus = 'active' | 'revoked' | 'paused';
export type AuthorityWalletStatus = 'missing' | 'pending' | 'ready';

type AuthorityProfileRow = {
  id: string;
  merchant_id: string;
  principal_id: string;
  operator_id: string | null;
  status: AuthorityProfileStatus;
  wallet_status: AuthorityWalletStatus;
  preferred_funding_rail: string | null;
  default_payment_method_type: string | null;
  default_payment_reference: string | null;
  contact_email: string | null;
  contact_name: string | null;
  autonomy_policy_json: unknown;
  limits_json: unknown;
  metadata_json: unknown;
  created_at: Date;
  updated_at: Date;
};

type DbEnv = Pick<Env, 'DATABASE_URL' | 'HYPERDRIVE'>;

export type AuthorityProfileView = {
  id: string;
  merchantId: string;
  principalId: string;
  operatorId: string | null;
  status: AuthorityProfileStatus;
  walletStatus: AuthorityWalletStatus;
  preferredFundingRail: string | null;
  defaultPaymentMethodType: string | null;
  defaultPaymentReference: string | null;
  contactEmail: string | null;
  contactName: string | null;
  autonomyPolicy: Record<string, unknown>;
  limits: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const memoryProfiles = new Map<string, AuthorityProfileView>();

function isMissingRelationError(err: unknown): boolean {
  return err instanceof Error
    && /authority_profiles/i.test(err.message)
    && /does not exist|relation/i.test(err.message);
}

function toView(row: AuthorityProfileRow): AuthorityProfileView {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    principalId: row.principal_id,
    operatorId: row.operator_id,
    status: row.status,
    walletStatus: row.wallet_status,
    preferredFundingRail: row.preferred_funding_rail,
    defaultPaymentMethodType: row.default_payment_method_type,
    defaultPaymentReference: row.default_payment_reference,
    contactEmail: row.contact_email,
    contactName: row.contact_name,
    autonomyPolicy: parseJsonb<Record<string, unknown>>(row.autonomy_policy_json, {}),
    limits: parseJsonb<Record<string, unknown>>(row.limits_json, {}),
    metadata: parseJsonb<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function memoryKey(merchantId: string, principalId: string): string {
  return `${merchantId}:${principalId}`;
}

export async function getAuthorityProfile(
  env: DbEnv,
  merchantId: string,
  principalId: string,
): Promise<AuthorityProfileView | null> {
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<AuthorityProfileRow[]>`
      SELECT *
      FROM authority_profiles
      WHERE merchant_id = ${merchantId}::uuid
        AND principal_id = ${principalId}
      LIMIT 1
    `;
    return rows[0] ? toView(rows[0]) : null;
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    return memoryProfiles.get(memoryKey(merchantId, principalId)) ?? null;
  } finally {
    await sql?.end().catch(() => {});
  }
}

export async function upsertAuthorityProfile(
  env: DbEnv,
  input: {
    merchantId: string;
    principalId: string;
    operatorId?: string | null;
    status?: AuthorityProfileStatus;
    walletStatus?: AuthorityWalletStatus;
    preferredFundingRail?: string | null;
    defaultPaymentMethodType?: string | null;
    defaultPaymentReference?: string | null;
    contactEmail?: string | null;
    contactName?: string | null;
    autonomyPolicy?: Record<string, unknown>;
    limits?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<AuthorityProfileView> {
  const now = new Date();
  let sql: Sql | undefined;
  try {
    sql = createDb(env);
    const rows = await sql<AuthorityProfileRow[]>`
      INSERT INTO authority_profiles (
        id,
        merchant_id,
        principal_id,
        operator_id,
        status,
        wallet_status,
        preferred_funding_rail,
        default_payment_method_type,
        default_payment_reference,
        contact_email,
        contact_name,
        autonomy_policy_json,
        limits_json,
        metadata_json
      ) VALUES (
        ${crypto.randomUUID()}::uuid,
        ${input.merchantId}::uuid,
        ${input.principalId},
        ${input.operatorId ?? null},
        ${input.status ?? 'active'},
        ${input.walletStatus ?? 'missing'},
        ${input.preferredFundingRail ?? null},
        ${input.defaultPaymentMethodType ?? null},
        ${input.defaultPaymentReference ?? null},
        ${input.contactEmail ?? null},
        ${input.contactName ?? null},
        ${JSON.stringify(input.autonomyPolicy ?? {})}::jsonb,
        ${JSON.stringify(input.limits ?? {})}::jsonb,
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
      ON CONFLICT (merchant_id, principal_id)
      DO UPDATE SET
        operator_id = COALESCE(EXCLUDED.operator_id, authority_profiles.operator_id),
        status = EXCLUDED.status,
        wallet_status = EXCLUDED.wallet_status,
        preferred_funding_rail = COALESCE(EXCLUDED.preferred_funding_rail, authority_profiles.preferred_funding_rail),
        default_payment_method_type = COALESCE(EXCLUDED.default_payment_method_type, authority_profiles.default_payment_method_type),
        default_payment_reference = COALESCE(EXCLUDED.default_payment_reference, authority_profiles.default_payment_reference),
        contact_email = COALESCE(EXCLUDED.contact_email, authority_profiles.contact_email),
        contact_name = COALESCE(EXCLUDED.contact_name, authority_profiles.contact_name),
        autonomy_policy_json = COALESCE(authority_profiles.autonomy_policy_json, '{}'::jsonb) || EXCLUDED.autonomy_policy_json,
        limits_json = COALESCE(authority_profiles.limits_json, '{}'::jsonb) || EXCLUDED.limits_json,
        metadata_json = COALESCE(authority_profiles.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
        updated_at = NOW()
      RETURNING *
    `;
    return toView(rows[0]);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    const existing = memoryProfiles.get(memoryKey(input.merchantId, input.principalId));
    const next: AuthorityProfileView = {
      id: existing?.id ?? crypto.randomUUID(),
      merchantId: input.merchantId,
      principalId: input.principalId,
      operatorId: input.operatorId ?? existing?.operatorId ?? null,
      status: input.status ?? existing?.status ?? 'active',
      walletStatus: input.walletStatus ?? existing?.walletStatus ?? 'missing',
      preferredFundingRail: input.preferredFundingRail ?? existing?.preferredFundingRail ?? null,
      defaultPaymentMethodType: input.defaultPaymentMethodType ?? existing?.defaultPaymentMethodType ?? null,
      defaultPaymentReference: input.defaultPaymentReference ?? existing?.defaultPaymentReference ?? null,
      contactEmail: input.contactEmail ?? existing?.contactEmail ?? null,
      contactName: input.contactName ?? existing?.contactName ?? null,
      autonomyPolicy: {
        ...(existing?.autonomyPolicy ?? {}),
        ...(input.autonomyPolicy ?? {}),
      },
      limits: {
        ...(existing?.limits ?? {}),
        ...(input.limits ?? {}),
      },
      metadata: {
        ...(existing?.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    memoryProfiles.set(memoryKey(input.merchantId, input.principalId), next);
    return next;
  } finally {
    await sql?.end().catch(() => {});
  }
}
