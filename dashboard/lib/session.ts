/**
 * Cookie-based session helper using HMAC-SHA256 (Web Crypto API).
 * Works in both Node.js (≥18) and the Next.js Edge runtime.
 *
 * Cookie value format:  <base64url(JSON payload)>.<base64url(HMAC-SHA256 signature)>
 */

export const COOKIE_NAME = 'agentpay_session';
export const SESSION_MAX_AGE = 24 * 60 * 60; // 24 hours in seconds

export interface SessionPayload {
  apiKey: string;
  email: string;
  iat: number;
  exp: number;
}

function getSecret(): string {
  return process.env.DASHBOARD_SESSION_SECRET ?? 'dev-secret-please-change-this-value';
}

async function importKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Signs a session payload and returns the cookie string. */
export async function signSession(
  data: Omit<SessionPayload, 'iat' | 'exp'>,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { ...data, iat: now, exp: now + SESSION_MAX_AGE };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key = await importKey(getSecret());
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${Buffer.from(sig).toString('base64url')}`;
}

/** Verifies and decodes a session cookie. Returns null if invalid or expired. */
export async function verifySession(cookie: string): Promise<SessionPayload | null> {
  const dotIdx = cookie.lastIndexOf('.');
  if (dotIdx === -1) return null;

  const encoded = cookie.slice(0, dotIdx);
  const sigStr = cookie.slice(dotIdx + 1);

  let sigBytes: Uint8Array;
  try {
    sigBytes = new Uint8Array(Buffer.from(sigStr, 'base64url'));
    if (sigBytes.length === 0) return null;
  } catch {
    return null;
  }

  try {
    const key = await importKey(getSecret());
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes.buffer.slice(
        sigBytes.byteOffset,
        sigBytes.byteOffset + sigBytes.byteLength,
      ) as ArrayBuffer,
      new TextEncoder().encode(encoded),
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  try {
    const payload: SessionPayload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString(),
    );
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
