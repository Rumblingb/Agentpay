import type { MerchantContext } from '../types';
import { hmacSign, hmacVerify } from './hmac';

const TOKEN_PREFIX = 'apmcp_v1';
const DEFAULT_TTL_SECONDS = 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

export interface McpAccessTokenClaims {
  sub: string;
  email: string;
  keyPrefix: string;
  scope: 'remote_mcp';
  audience: 'openai' | 'anthropic' | 'generic';
  iat: number;
  exp: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeClaims(claims: McpAccessTokenClaims): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
}

function decodeClaims(encoded: string): McpAccessTokenClaims | null {
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(encoded));
    const claims = JSON.parse(json) as Partial<McpAccessTokenClaims>;
    if (
      typeof claims.sub !== 'string'
      || typeof claims.email !== 'string'
      || typeof claims.keyPrefix !== 'string'
      || claims.scope !== 'remote_mcp'
      || !['openai', 'anthropic', 'generic'].includes(String(claims.audience))
      || typeof claims.iat !== 'number'
      || typeof claims.exp !== 'number'
    ) {
      return null;
    }
    return claims as McpAccessTokenClaims;
  } catch {
    return null;
  }
}

function clampTtl(ttlSeconds?: number): number {
  if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds)) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(Math.floor(ttlSeconds), MIN_TTL_SECONDS), MAX_TTL_SECONDS);
}

export function extractKeyPrefix(apiKey: string): string {
  return apiKey.substring(0, 8);
}

export async function mintMcpAccessToken(params: {
  merchant: MerchantContext;
  apiKey?: string;
  keyPrefix?: string;
  signingSecret: string;
  ttlSeconds?: number;
  audience?: McpAccessTokenClaims['audience'];
}): Promise<{ accessToken: string; expiresAt: string; claims: McpAccessTokenClaims }> {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = clampTtl(params.ttlSeconds);
  const keyPrefix = typeof params.keyPrefix === 'string' && params.keyPrefix.trim()
    ? params.keyPrefix.trim()
    : params.apiKey
      ? extractKeyPrefix(params.apiKey)
      : '';
  if (!keyPrefix) {
    throw new Error('MCP_KEY_PREFIX_REQUIRED');
  }
  const claims: McpAccessTokenClaims = {
    sub: params.merchant.id,
    email: params.merchant.email,
    keyPrefix,
    scope: 'remote_mcp',
    audience: params.audience ?? 'generic',
    iat: now,
    exp: now + ttlSeconds,
  };
  const encoded = encodeClaims(claims);
  const signature = await hmacSign(`${TOKEN_PREFIX}.${encoded}`, params.signingSecret);
  return {
    accessToken: `${TOKEN_PREFIX}.${encoded}.${signature}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    claims,
  };
}

export async function verifyMcpAccessToken(
  token: string,
  signingSecret: string,
): Promise<McpAccessTokenClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const [, encoded, signature] = parts;
  const valid = await hmacVerify(`${TOKEN_PREFIX}.${encoded}`, signature, signingSecret);
  if (!valid) return null;
  const claims = decodeClaims(encoded);
  if (!claims) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) return null;
  return claims;
}

export function isMcpAccessToken(token: string): boolean {
  return token.startsWith(`${TOKEN_PREFIX}.`);
}
