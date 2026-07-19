import type { Context, Next } from 'hono';

import { createDb } from '../lib/db';
import { pbkdf2Hex } from '../lib/pbkdf2';
import type { CommercePrincipalContext, Env, Variables } from '../types';

const ORGANIZATION_KEY_PATTERN = /^org_([0-9a-f]{12})_([0-9a-f]{64})$/;

function randomHex(byteLength: number): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(byteLength)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function timingSafeDigestEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function createCommerceOrganizationKey(): Promise<{
  presentedKey: string;
  keyPrefix: string;
  keyHash: string;
  keySalt: string;
}> {
  const rawKey = randomHex(32);
  const keyPrefix = randomHex(6);
  const keySalt = randomHex(32);
  return {
    presentedKey: `org_${keyPrefix}_${rawKey}`,
    keyPrefix,
    keyHash: await pbkdf2Hex(rawKey, keySalt),
    keySalt,
  };
}

function presentedOrganizationKey(c: Context<{ Bindings: Env; Variables: Variables }>): string | null {
  const direct = c.req.header('x-organization-key');
  if (direct) return direct.trim();
  const authorization = c.req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token.startsWith('org_') ? token : null;
}

export async function authenticateCommercePrincipal(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
): Promise<void | Response> {
  const presented = presentedOrganizationKey(c);
  const match = presented ? ORGANIZATION_KEY_PATTERN.exec(presented) : null;
  if (!match) {
    return c.json({
      code: 'COMMERCE_AUTH_MISSING',
      message: 'Provide an AgentPay organization key.',
    }, 401);
  }

  const [, keyPrefix, rawKey] = match;
  const sql = createDb(c.env);
  let authenticatedCredentialId: string | null = null;
  try {
    const rows = await sql<Array<CommercePrincipalContext & {
      credentialId: string;
      keyHash: string;
      keySalt: string;
    }>>`
      SELECT
        credential.id AS "credentialId",
        credential.key_hash AS "keyHash",
        credential.key_salt AS "keySalt",
        credential.organization_id AS "organizationId",
        member.id AS "memberId",
        member.principal_type AS "principalType",
        member.principal_id AS "principalId",
        member.role
      FROM commerce_organization_credentials credential
      JOIN commerce_organization_members member
        ON member.id = credential.member_id
       AND member.organization_id = credential.organization_id
      JOIN commerce_organizations organization
        ON organization.id = credential.organization_id
      WHERE credential.key_prefix = ${keyPrefix}
        AND credential.status = 'active'
        AND (credential.expires_at IS NULL OR credential.expires_at > now())
        AND member.status = 'active'
        AND organization.status = 'active'
      LIMIT 1
    `;
    const credential = rows[0];
    const derivedHash = credential
      ? await pbkdf2Hex(rawKey, credential.keySalt)
      : null;
    if (!credential || !derivedHash || !timingSafeDigestEqual(derivedHash, credential.keyHash)) {
      return c.json({ code: 'COMMERCE_AUTH_INVALID', message: 'Invalid organization key.' }, 401);
    }
    authenticatedCredentialId = credential.credentialId;

    c.set('commercePrincipal', {
      organizationId: credential.organizationId,
      memberId: credential.memberId,
      principalType: credential.principalType,
      principalId: credential.principalId,
      role: credential.role,
    });
    await next();
  } finally {
    const finalize = authenticatedCredentialId
      ? (async () => {
          try {
            await sql`
              UPDATE commerce_organization_credentials
              SET last_used_at = now()
              WHERE id = ${authenticatedCredentialId}
            `;
          } finally {
            await sql.end();
          }
        })()
      : sql.end();
    c.executionCtx.waitUntil(finalize.catch(() => {}));
  }
}
