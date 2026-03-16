import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

export interface CreateDelegationParams {
  publicKey: string;
  spendingLimit?: number;
  expiresAt?: string;
}

export async function createDelegation(
  agentId: string,
  params: CreateDelegationParams
): Promise<{ delegationId: string; publicKey: string }> {
  const delegationId = uuidv4();

  await query(
    `INSERT INTO agent_delegations
       (delegation_id, agent_id, public_key, spending_limit, is_active, expires_at, created_at)
     VALUES ($1, $2, $3, $4, false, $5, NOW())`,
    [delegationId, agentId, params.publicKey, params.spendingLimit ?? null, params.expiresAt ?? null]
  );

  logger.info('Delegation created', { delegationId, agentId });
  return { delegationId, publicKey: params.publicKey };
}

export async function authorizeDelegation(delegationId: string, agentId: string): Promise<void> {
  const result = await query(
    `UPDATE agent_delegations SET is_active = true WHERE delegation_id = $1 AND agent_id = $2`,
    [delegationId, agentId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Delegation not found or not owned by agent');
  }
  logger.info('Delegation authorized', { delegationId, agentId });
}

export async function revokeDelegation(delegationId: string, agentId: string): Promise<void> {
  const result = await query(
    `UPDATE agent_delegations SET is_active = false WHERE delegation_id = $1 AND agent_id = $2`,
    [delegationId, agentId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Delegation not found or not owned by agent');
  }
  logger.info('Delegation revoked', { delegationId, agentId });
}
