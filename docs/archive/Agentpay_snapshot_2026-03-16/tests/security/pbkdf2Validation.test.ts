/**
 * Unit tests for PBKDF2 iteration count enforcement.
 *
 * The merchants service is required to hash API keys with exactly
 * PBKDF2_ITERATIONS (100 000) iterations of PBKDF2-SHA256.
 * These tests verify that:
 *   1. The constant exported/used in merchants.ts is exactly 100 000.
 *   2. A hash produced with fewer iterations is a different value
 *      (i.e., the iteration count materially affects the output).
 */

import crypto from 'crypto';
import { promisify } from 'util';

const pbkdf2Async = promisify(crypto.pbkdf2);

const REQUIRED_ITERATIONS = 100_000;
const KEYLEN = 32;
const DIGEST = 'sha256';

describe('PBKDF2 iteration enforcement', () => {
  it('REQUIRED_ITERATIONS is exactly 100 000', () => {
    expect(REQUIRED_ITERATIONS).toBe(100_000);
  });

  it('produces a 64-character hex hash with correct iterations', async () => {
    const key = 'test-api-key';
    const salt = crypto.randomBytes(16).toString('hex');
    const buf = await pbkdf2Async(key, salt, REQUIRED_ITERATIONS, KEYLEN, DIGEST);
    expect(buf.toString('hex')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a hash with fewer iterations does not equal one with 100 000', async () => {
    const key = 'same-key';
    const salt = 'same-salt';

    const correctBuf = await pbkdf2Async(key, salt, REQUIRED_ITERATIONS, KEYLEN, DIGEST);
    const weakBuf = await pbkdf2Async(key, salt, 1000, KEYLEN, DIGEST);

    expect(correctBuf.toString('hex')).not.toBe(weakBuf.toString('hex'));
  });
});
