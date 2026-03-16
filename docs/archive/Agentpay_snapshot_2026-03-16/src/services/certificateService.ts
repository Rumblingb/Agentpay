import crypto from 'crypto';

/** Sign a payload object and return a base64-encoded certificate string. */
export function signCertificate(payload: Record<string, unknown>): string {
  const secret = process.env.VERIFICATION_SECRET;
  if (!secret) {
    throw new Error('VERIFICATION_SECRET environment variable is not set');
  }

  const payloadJson = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadJson)
    .digest('hex');

  const certificate = { payload, signature };
  return Buffer.from(JSON.stringify(certificate)).toString('base64');
}

/** Validate a base64-encoded certificate string.
 *  Returns the payload if valid, or null if invalid.
 */
export function validateCertificate(encoded: string): Record<string, unknown> | null {
  const secret = process.env.VERIFICATION_SECRET;
  if (!secret) {
    throw new Error('VERIFICATION_SECRET environment variable is not set');
  }

  let certificate: { payload: Record<string, unknown>; signature: string };
  try {
    certificate = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    return null;
  }

  if (!certificate.payload || typeof certificate.signature !== 'string') {
    return null;
  }

  const payloadJson = JSON.stringify(certificate.payload);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadJson)
    .digest('hex');

  // Validate that the stored signature is a 64-character hex string (sha256 output)
  if (!/^[0-9a-f]{64}$/i.test(certificate.signature)) {
    return null;
  }

  // Timing-safe comparison
  const expected = Buffer.from(expectedSignature, 'hex');
  const actual = Buffer.from(certificate.signature, 'hex');

  if (expected.length !== actual.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  return certificate.payload;
}

export default { signCertificate, validateCertificate };
