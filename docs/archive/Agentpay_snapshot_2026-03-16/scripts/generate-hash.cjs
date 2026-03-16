#!/usr/bin/env node
/**
 * generate-hash.cjs
 *
 * Generates the correct PBKDF2 hash for an existing API key so you can
 * update a database record and unblock login.
 *
 * This script uses the EXACT same algorithm as src/services/merchants.ts:
 *   - Algorithm : PBKDF2
 *   - Iterations: 100 000
 *   - Key length : 32 bytes  (64 hex chars in the output)
 *   - Digest     : sha256
 *
 * NOTE: Gemini suggested keylen=64 — that is WRONG for this codebase.
 * Using keylen=64 produces a 128-char hex hash that the backend will never
 * accept (it always expects a 64-char hex hash).
 *
 * Usage:
 *   node scripts/generate-hash.cjs <apiKey> [email]
 *
 * Example:
 *   node scripts/generate-hash.cjs ak_live_fcbb663e3332cc240782cb284f8be2eb demo@example.com
 *
 * The script prints a ready-to-run SQL UPDATE statement.
 * Paste it into the Supabase SQL editor (or psql) to fix the database record.
 */

'use strict';

const crypto = require('crypto');

// ── Parameters — must match src/services/merchants.ts exactly ──────────────
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN     = 32;        // ← 32 bytes → 64-char hex hash
const PBKDF2_DIGEST     = 'sha256';
// ───────────────────────────────────────────────────────────────────────────

const inputKey = process.argv[2];
const email    = process.argv[3];

if (!inputKey) {
  console.error('Usage: node scripts/generate-hash.cjs <apiKey> [email]');
  console.error('');
  console.error('Accepts either format:');
  console.error('  Raw key  : node scripts/generate-hash.cjs 5f16cbbedd9d2199...          demo@example.com');
  console.error('  Prefixed : node scripts/generate-hash.cjs 5f16cbbe_5f16cbbedd9d2199... demo@example.com');
  process.exit(1);
}

// If the key is in "{8-char-prefix}_{rawKey}" format (underscore at position 8),
// extract only the raw key portion for hashing — this is what the backend stores.
// NOTE: This detection mirrors the extractRawKey() helper in src/services/merchants.ts.
//       Keep both in sync if the format rules ever change.
const PREFIX_PLUS_SEPARATOR_LEN = 9; // 8-char hex prefix + 1 underscore
let apiKey = inputKey;
if (
  inputKey.length > PREFIX_PLUS_SEPARATOR_LEN &&
  inputKey[8] === '_' &&
  /^[0-9a-f]{8}$/i.test(inputKey.substring(0, 8))
) {
  apiKey = inputKey.slice(PREFIX_PLUS_SEPARATOR_LEN);
  console.error(`[info] Detected prefixed key format — using raw key portion for hashing: ${apiKey.substring(0, 8)}...`);
}

// Generate a fresh random 16-byte salt (32 hex chars)
const salt = crypto.randomBytes(16).toString('hex');

// Derive the hash using the SAME parameters the backend uses
const hashBuf = crypto.pbkdf2Sync(
  apiKey,
  salt,
  PBKDF2_ITERATIONS,
  PBKDF2_KEYLEN,
  PBKDF2_DIGEST,
);
const hash      = hashBuf.toString('hex');
const keyPrefix = apiKey.substring(0, 8);

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           AgentPay — PBKDF2 Hash Generator                  ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('Algorithm parameters (verified against src/services/merchants.ts):');
console.log(`  iterations : ${PBKDF2_ITERATIONS}`);
console.log(`  keylen     : ${PBKDF2_KEYLEN} bytes → ${PBKDF2_KEYLEN * 2}-char hex hash`);
console.log(`  digest     : ${PBKDF2_DIGEST}`);
console.log('');
console.log('Generated values:');
console.log(`  salt       : ${salt}`);
console.log(`  hash       : ${hash}`);
console.log(`  key_prefix : ${keyPrefix}`);
console.log('');

if (email) {
  console.log('--- PASTE THIS SQL INTO SUPABASE (or psql) ---');
  console.log('');
  console.log(`UPDATE public.merchants`);
  console.log(`SET`);
  console.log(`    api_key_hash = '${hash}',`);
  console.log(`    api_key_salt = '${salt}',`);
  console.log(`    key_prefix   = '${keyPrefix}',`);
  console.log(`    updated_at   = NOW()`);
  console.log(`WHERE email = '${email}';`);
  console.log('');
  console.log('--- OR (if creating a new row) ---');
} else {
  console.log('--- SQL UPDATE (replace <your-merchant-id> and <email>) ---');
  console.log('');
  console.log(`UPDATE public.merchants`);
  console.log(`SET`);
  console.log(`    api_key_hash = '${hash}',`);
  console.log(`    api_key_salt = '${salt}',`);
  console.log(`    key_prefix   = '${keyPrefix}',`);
  console.log(`    updated_at   = NOW()`);
  console.log(`WHERE email = '<your-email>';`);
  console.log('');
}

console.log('After running the SQL:');
console.log('  1. Log in at your dashboard with your email + the API key above.');
console.log('  2. The backend will re-derive the PBKDF2 hash and compare — it will match.');
console.log('  3. fetchProfile() returns 200 OK and the session cookie is set.');
console.log('');
