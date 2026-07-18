#!/usr/bin/env bash
# Apply governed payment-provider migrations.
# Usage:
#   DATABASE_URL='postgresql://...' ./scripts/apply-secure-payment-migration.sh
# Optional:
#   APPLY_TO=staging|production (label only; does not select credentials)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${APPLY_TO:-unspecified}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required (Direct URL on port 5432)." >&2
  echo "Export the staging Supabase Direct URL, then re-run." >&2
  exit 1
fi

if [[ "${DATABASE_URL}" == *":6543"* ]]; then
  echo "Refusing pooled URL on port 6543. Use the Direct URL on port 5432." >&2
  exit 1
fi

echo "Applying payment migrations (${LABEL})..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f "$ROOT/migrations/20260416_processed_webhook_events.sql" \
  -f "$ROOT/migrations/20260718_secure_payment_providers.sql"

echo "Verifying tables..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "\dt provider_payment_*" -c "\dt processed_webhook_events"
echo "Done."
