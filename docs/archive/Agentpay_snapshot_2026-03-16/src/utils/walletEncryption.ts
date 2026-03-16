/**
 * AES-256-GCM wallet keypair encryption utilities.
 *
 * The encryption key is derived from AGENTPAY_SIGNING_SECRET via SHA-256,
 * yielding a deterministic 32-byte key without requiring a separate secret.
 *
 * Encrypted format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 * All three components are required for successful decryption (GCM auth tag
 * prevents ciphertext tampering).
 *
 * @module utils/walletEncryption
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV — recommended for GCM
const TAG_BYTES = 16;  // 128-bit authentication tag

/**
 * Derives a 32-byte AES key from AGENTPAY_SIGNING_SECRET.
 * Throws if the secret is not set — this is intentional: callers must
 * handle the missing-secret case before attempting encryption.
 */
function getKey(): Buffer {
  const secret = process.env.AGENTPAY_SIGNING_SECRET;
  if (!secret) {
    throw new Error(
      'AGENTPAY_SIGNING_SECRET is not set — cannot encrypt/decrypt wallet keypairs'
    );
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Encrypts a Solana keypair's secret key bytes using AES-256-GCM.
 *
 * @param secretKeyBytes - The raw 64-byte Solana secret key (`Keypair.secretKey`)
 * @returns Encoded string: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 */
export function encryptKeypair(secretKeyBytes: Uint8Array): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });

  const plaintext = Buffer.from(secretKeyBytes);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM encrypted keypair.
 *
 * @param encoded - The string returned by `encryptKeypair`
 * @returns The original 64-byte secret key bytes
 * @throws If the format is invalid, the key is wrong, or the ciphertext was tampered with
 */
export function decryptKeypair(encoded: string): Uint8Array {
  const parts = encoded.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted keypair format — expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return new Uint8Array(decrypted);
}

/**
 * Returns true if the value looks like a valid encrypted keypair
 * (i.e. has the `iv:authTag:ciphertext` format).
 */
export function isEncrypted(value: string): boolean {
  return value.split(':').length === 3;
}
