/**
 * PBKDF2 using the Web Crypto API (SubtleCrypto).
 *
 * This is the Cloudflare Workers replacement for Node.js
 * `util.promisify(crypto.pbkdf2)` used in src/services/merchants.ts.
 *
 * MUST produce byte-for-byte identical output to the Node.js version for
 * every API key stored in the database.  If it doesn't, all existing API
 * keys break and merchants cannot authenticate.
 *
 * Verified equivalent parameters (from src/services/merchants.ts):
 *   PBKDF2_ITERATIONS = 100_000
 *   PBKDF2_KEYLEN     = 32  (bytes → 256 bits)
 *   PBKDF2_DIGEST     = 'sha256'
 *
 * Node.js string handling:
 *   crypto.pbkdf2(password: string, salt: string, ...) encodes both as UTF-8.
 *   SubtleCrypto requires a BufferSource, so we encode with TextEncoder which
 *   also produces UTF-8.  The output is identical.
 *
 * Output format:
 *   Node.js: hashBuf.toString('hex') — lowercase hex
 *   SubtleCrypto: Array.from(new Uint8Array(bits)).map(hex) — same lowercase hex
 */

export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_KEYLEN = 32; // bytes
export const PBKDF2_DIGEST = 'SHA-256'; // SubtleCrypto uses uppercase

const enc = new TextEncoder();

/**
 * Derive a PBKDF2 key from a password and salt string.
 * Returns the derived key as a lowercase hex string.
 *
 * Parameters mirror src/services/merchants.ts exactly so existing hashes match.
 */
export async function pbkdf2Hex(password: string, salt: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_DIGEST,
    },
    keyMaterial,
    PBKDF2_KEYLEN * 8, // deriveBits takes bits, not bytes
  );

  // Convert ArrayBuffer to lowercase hex string — identical to Node.js
  // Buffer.toString('hex').
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
