/**
 * HMAC-SHA256 helpers using the Web Crypto API (SubtleCrypto).
 *
 * Replaces Node.js `crypto.createHmac('sha256', secret)` in the Workers runtime.
 *
 * Functions:
 *   hmacSign(data, secret)             — signs `data` and returns lowercase hex
 *   hmacVerify(data, signatureHex, secret) — timing-safe HMAC verification
 *
 * Timing safety:
 *   `crypto.subtle.verify` is specified to run in constant time with respect to
 *   the secret and signature bytes, making it safe for comparing HMAC values
 *   without leaking information via timing side-channels.
 *   This replaces the `crypto.timingSafeEqual` call in certificateService.ts.
 */

const enc = new TextEncoder();

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Computes HMAC-SHA256 of `data` using `secret`.
 * Returns a 64-character lowercase hex string — identical to Node.js
 * `crypto.createHmac('sha256', secret).update(data).digest('hex')`.
 */
export async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Timing-safe verification of an HMAC-SHA256 hex signature.
 *
 * Returns true iff `signatureHex` is a valid HMAC-SHA256 signature of `data`
 * under `secret`.  Returns false for malformed signatures without leaking
 * timing information.
 *
 * @param data         The original data that was signed.
 * @param signatureHex The signature to verify — 64-char lowercase hex.
 * @param secret       The HMAC secret.
 */
export async function hmacVerify(
  data: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  // Guard against non-hex or wrong-length input before touching the crypto API.
  if (!/^[0-9a-f]{64}$/i.test(signatureHex)) return false;

  const sigBytes = new Uint8Array(
    (signatureHex.match(/.{2}/g) as string[]).map((h) => parseInt(h, 16)),
  );

  const key = await importHmacKey(secret);
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
}
