import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index';
import { logger } from '../logger';

const SALT_ROUNDS = 12;

export interface RegisterAgentParams {
  agentPublicKey?: string;
  spendingLimit?: number;
  pin?: string;
  deviceFingerprint?: string;
}

export async function registerAgent(params: RegisterAgentParams): Promise<{ agentId: string }> {
  const agentId = uuidv4();
  const pinHash = params.pin ? await bcrypt.hash(params.pin, SALT_ROUNDS) : null;

  await query(
    `INSERT INTO agent_identities
       (agent_id, agent_public_key, spending_limit, pin_hash, device_fingerprint, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [agentId, params.agentPublicKey ?? null, params.spendingLimit ?? null, pinHash, params.deviceFingerprint ?? null]
  );

  logger.info('Agent registered', { agentId });
  return { agentId };
}

export async function updateAgent(agentId: string, params: Partial<RegisterAgentParams>): Promise<void> {
  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  let idx = 1;

  if (params.agentPublicKey !== undefined) {
    updates.push(`agent_public_key = $${idx++}`);
    values.push(params.agentPublicKey);
  }
  if (params.spendingLimit !== undefined) {
    updates.push(`spending_limit = $${idx++}`);
    values.push(params.spendingLimit);
  }
  if (params.pin !== undefined) {
    updates.push(`pin_hash = $${idx++}`);
    values.push(await bcrypt.hash(params.pin, SALT_ROUNDS));
  }
  if (params.deviceFingerprint !== undefined) {
    updates.push(`device_fingerprint = $${idx++}`);
    values.push(params.deviceFingerprint);
  }

  if (updates.length === 0) return;

  updates.push(`updated_at = NOW()`);
  values.push(agentId);

  await query(
    `UPDATE agent_identities SET ${updates.join(', ')} WHERE agent_id = $${idx}`,
    values
  );

  logger.info('Agent updated', { agentId });
}

export async function verifyPin(agentId: string, pin: string): Promise<boolean> {
  const result = await query(
    `SELECT pin_hash FROM agent_identities WHERE agent_id = $1`,
    [agentId]
  );

  if (result.rows.length === 0) return false;
  const { pin_hash } = result.rows[0];
  if (!pin_hash) return false;

  return bcrypt.compare(pin, pin_hash);
}
