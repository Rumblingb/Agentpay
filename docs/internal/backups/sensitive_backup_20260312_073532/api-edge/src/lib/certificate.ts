/**
 * Certificate service for the AgentPay Workers API.
 *
 * Workers-native port of src/services/certificateService.ts.
 *
 * Changes:
 *   - `crypto.createHmac` → hmacSign / hmacVerify (SubtleCrypto)
 *   - `Buffer.from(str, 'base64')` → `atob(str)` (Web API)
 *   - `Buffer.from(str).toString('base64')` → `btoa(str)` (Web API)
 *   - `crypto.timingSafeEqual` → `hmacVerify` which uses `crypto.subtle.verify`
 *     (inherently timing-safe)
 *   - Secret read from `secret` parameter instead of `process.env`
 *
 * Preserved:
 *   - Exact same certificate format: base64(JSON({payload, signature}))
 *   - HMAC-SHA256 with the VERIFICATION_SECRET
 *   - Same validation logic (null on any invalid input)
 *
 * Usage:
 *   const cert = await signCertificate(payload, c.env.VERIFICATION_SECRET);
 *   const payload = await validateCertificate(encoded, c.env.VERIFICATION_SECRET);
 */

import { hmacSign, hmacVerify } from './hmac';

/**
 * Signs a payload object and returns a base64-encoded certificate string.
 *
 * Output format: base64(JSON.stringify({ payload, signature }))
 * where signature = HMAC-SHA256(JSON.stringify(payload), VERIFICATION_SECRET)
 *
 * This mirrors src/services/certificateService.ts signCertificate() exactly.
 */
export async function signCertificate(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const signature = await hmacSign(payloadJson, secret);
  const certificate = JSON.stringify({ payload, signature });
  return btoa(certificate);
}

/**
 * Validates a base64-encoded certificate string.
 * Returns the payload object if the signature is valid, or null otherwise.
 *
 * This mirrors src/services/certificateService.ts validateCertificate() exactly,
 * using timing-safe comparison via crypto.subtle.verify.
 */
export async function validateCertificate(
  encoded: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  let certificate: { payload: Record<string, unknown>; signature: string };
  try {
    certificate = JSON.parse(atob(encoded));
  } catch {
    return null;
  }

  if (!certificate.payload || typeof certificate.signature !== 'string') {
    return null;
  }

  const payloadJson = JSON.stringify(certificate.payload);
  const isValid = await hmacVerify(payloadJson, certificate.signature, secret);

  return isValid ? certificate.payload : null;
}
