#!/usr/bin/env bash
set -euo pipefail

# Deploys the routing fix: known routes unchanged, /awesome-free-dev-tools/buy
# redirects to Stripe again, unknown paths 404 instead of serving the landing
# page with HTTP 200. Records the current 100%-traffic version first and rolls
# back automatically if public verification fails.

EXPECTED_CONFIRMATION='agentpay.so/routing-404'
if [[ "${CONFIRM_DEPLOY_ROUTING:-}" != "$EXPECTED_CONFIRMATION" ]]; then
  echo "Refusing production deploy. Set CONFIRM_DEPLOY_ROUTING=$EXPECTED_CONFIRMATION after action-time approval." >&2
  exit 2
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo 'CLOUDFLARE_API_TOKEN is required.' >&2
  exit 2
fi

# wrangler 4.x requires Node >= 22; this repo's default runtime is 20.18.0.
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if (( NODE_MAJOR < 22 )); then
  echo "Node >=22 required for wrangler (found $(node --version)). Run: nvm use 22" >&2
  exit 2
fi

ROOT=$(cd "$(dirname "$0")" && pwd)
RECEIPT_DIR=${RECEIPT_DIR:-/Users/brain/Documents/memorybrain/Shared-Brain/Agent-Claude/deploy-receipts}
WRANGLER_VERSION=${WRANGLER_VERSION:-4.103.0}
WORKER_NAME=${WORKER_NAME:-agentpay-landing-production}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$RECEIPT_DIR"

cd "$ROOT"
node --test worker.test.mjs
node --check worker.js
npx --yes "wrangler@$WRANGLER_VERSION" deploy --strict --dry-run --outdir "/tmp/agentpay-landing-$STAMP"
npx --yes "wrangler@$WRANGLER_VERSION" versions list --name "$WORKER_NAME" --json > "$RECEIPT_DIR/versions-before-$STAMP.json"
npx --yes "wrangler@$WRANGLER_VERSION" deployments list --name "$WORKER_NAME" --json > "$RECEIPT_DIR/deployments-before-$STAMP.json"

PREVIOUS_VERSION=$(python3 - "$RECEIPT_DIR/deployments-before-$STAMP.json" <<'PY'
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
echo "Rollback target: $PREVIOUS_VERSION"

npx --yes "wrangler@$WRANGLER_VERSION" versions upload worker-entry.mjs \
  --name "$WORKER_NAME" \
  --compatibility-date 2026-06-21 \
  --keep-vars \
  --message "Routing: 404 unknown paths, restore /awesome-free-dev-tools/buy redirect"
npx --yes "wrangler@$WRANGLER_VERSION" versions list --name "$WORKER_NAME" --json > "$RECEIPT_DIR/versions-after-upload-$STAMP.json"

NEW_VERSION=$(python3 - \
  "$RECEIPT_DIR/versions-before-$STAMP.json" \
  "$RECEIPT_DIR/versions-after-upload-$STAMP.json" <<'PY'
import json, sys
before = {row['id'] for row in json.load(open(sys.argv[1]))}
after = [row['id'] for row in json.load(open(sys.argv[2])) if row['id'] not in before]
if len(after) != 1:
    raise SystemExit(f'Expected one uploaded version, found {after}')
print(after[0])
PY
)
echo "Uploaded version: $NEW_VERSION"

npx --yes "wrangler@$WRANGLER_VERSION" versions deploy \
  --name "$WORKER_NAME" \
  --version-id "$NEW_VERSION" \
  --percentage 100 \
  --message "Routing fix: real 404s, working paid-product redirect" \
  --yes

if ! node verify-routing.mjs > "$RECEIPT_DIR/routing-verification-$STAMP.json"; then
  npx --yes "wrangler@$WRANGLER_VERSION" versions deploy \
    --name "$WORKER_NAME" \
    --version-id "$PREVIOUS_VERSION" \
    --percentage 100 \
    --message "Automatic rollback after routing verification failure" \
    --yes
  echo "Public verification failed; rolled back to $PREVIOUS_VERSION." >&2
  echo "Receipt: $RECEIPT_DIR/routing-verification-$STAMP.json" >&2
  exit 1
fi

npx --yes "wrangler@$WRANGLER_VERSION" deployments list --name "$WORKER_NAME" --json > "$RECEIPT_DIR/deployments-after-$STAMP.json"
echo "Deployment $NEW_VERSION verified. Rollback target was $PREVIOUS_VERSION. Receipts: $RECEIPT_DIR/*-$STAMP.json"
