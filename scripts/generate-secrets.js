#!/usr/bin/env node
/**
 * generate-secrets.js
 *
 * Generates cryptographically-secure random values for all secrets that are
 * required in production.  Copy the output into your Render environment
 * variables (or into a local .env file for development).
 *
 * Usage:
 *   node scripts/generate-secrets.js
 *   npm run generate:secrets
 */

import { randomBytes } from 'crypto';

const secrets = [
  'WEBHOOK_SECRET',
  'AGENTPAY_SIGNING_SECRET',
  'VERIFICATION_SECRET',
  'DASHBOARD_SESSION_SECRET',
];

console.log('# Generated production secrets — copy into your Render environment variables');
console.log('# DO NOT commit these values to source control.\n');

for (const name of secrets) {
  const value = randomBytes(32).toString('hex');
  console.log(`${name}=${value}`);
}

console.log(
  '\n# To apply on Render: Dashboard → <service> → Environment → Add Environment Variable',
);
