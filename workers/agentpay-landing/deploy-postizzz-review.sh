#!/usr/bin/env bash
set -euo pipefail

EXPECTED_CONFIRMATION='agentpay.so/postizzz'
if [[ "${CONFIRM_DEPLOY_POSTIZZZ:-}" != "$EXPECTED_CONFIRMATION" ]]; then
  echo "Refusing production deploy. Set CONFIRM_DEPLOY_POSTIZZZ=$EXPECTED_CONFIRMATION after action-time approval." >&2
  exit 2
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo 'CLOUDFLARE_API_TOKEN is required.' >&2
  exit 2
fi

ROOT=$(cd "$(dirname "$0")" && pwd)
RECEIPT_DIR=${RECEIPT_DIR:-/Users/brain/Documents/Codex/2026-06-12/i-also-want-you-to-connect/outputs/tiktok-review}
WRANGLER_VERSION=${WRANGLER_VERSION:-4.103.0}
WORKER_NAME=${WORKER_NAME:-agentpay-landing-production}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$RECEIPT_DIR"

cd "$ROOT"
node --test worker.test.mjs
node --check worker.js
npx --yes "wrangler@$WRANGLER_VERSION" deploy --strict --dry-run --outdir "/tmp/agentpay-landing-$STAMP"
npx --yes "wrangler@$WRANGLER_VERSION" versions list --name "$WORKER_NAME" --json > "$RECEIPT_DIR/cloudflare-versions-before-$STAMP.json"
npx --yes "wrangler@$WRANGLER_VERSION" deployments list --name "$WORKER_NAME" --json > "$RECEIPT_DIR/cloudflare-deployments-before-$STAMP.json"

PREVIOUS_VERSION=$(python3 - "$RECEIPT_DIR/cloudflare-deployments-before-$STAMP.json" <<'PY'
import json, sys
rows = json.load(open(sys.argv[1]))
if not rows:
    raise SystemExit('No previous deployment available for rollback')
latest = max(rows, key=lambda row: row['created_on'])
versions = [item for item in latest['versions'] if item['percentage'] == 100]
if len(versions) != 1:
    raise SystemExit('Expected one previous version at 100% traffic')
print(versions[0]['version_id'])
PY
)

npx --yes "wrangler@$WRANGLER_VERSION" versions upload worker-entry.mjs \
  --name "$WORKER_NAME" \
  --compatibility-date 2026-06-21 \
  --keep-vars \
  --message "TikTok review: align AgentPay website, legal pages, and social product"
npx --yes "wrangler@$WRANGLER_VERSION" versions list --name "$WORKER_NAME" --json > "$RECEIPT_DIR/cloudflare-versions-after-upload-$STAMP.json"

NEW_VERSION=$(python3 - \
  "$RECEIPT_DIR/cloudflare-versions-before-$STAMP.json" \
  "$RECEIPT_DIR/cloudflare-versions-after-upload-$STAMP.json" <<'PY'
import json, sys
before = {row['id'] for row in json.load(open(sys.argv[1]))}
after = [row['id'] for row in json.load(open(sys.argv[2])) if row['id'] not in before]
if len(after) != 1:
    raise SystemExit(f'Expected one uploaded version, found {after}')
print(after[0])
PY
)

npx --yes "wrangler@$WRANGLER_VERSION" versions deploy \
  --name "$WORKER_NAME" \
  --version-id "$NEW_VERSION" \
  --percentage 100 \
  --message "TikTok review: publish coherent AgentPay review surface" \
  --yes

if ! node verify-postizzz-review.mjs > "$RECEIPT_DIR/postizzz-public-verification-$STAMP.json"; then
  npx --yes "wrangler@$WRANGLER_VERSION" versions deploy \
    --name "$WORKER_NAME" \
    --version-id "$PREVIOUS_VERSION" \
    --percentage 100 \
    --message "Automatic rollback after Postizzz public verification failure" \
    --yes
  echo "Public verification failed; rolled back to $PREVIOUS_VERSION." >&2
  exit 1
fi

npx --yes "wrangler@$WRANGLER_VERSION" deployments list --name "$WORKER_NAME" --json > "$RECEIPT_DIR/cloudflare-deployments-after-$STAMP.json"
npx --yes "wrangler@$WRANGLER_VERSION" versions list --name "$WORKER_NAME" --json > "$RECEIPT_DIR/cloudflare-versions-after-$STAMP.json"

echo "Deployment $NEW_VERSION and verification passed. Receipts: $RECEIPT_DIR/*-$STAMP.json"
