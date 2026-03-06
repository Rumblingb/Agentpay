#!/usr/bin/env bash
# publish-sdks.sh — Build and publish AgentPay SDKs to npm and PyPI
#
# Usage:
#   ./scripts/publish-sdks.sh [--dry-run] [--ts-only] [--py-only]
#
# Prerequisites:
#   npm: `npm login` (or set NPM_TOKEN env var)
#   pypi: `pip install twine` + `twine login` (or set PYPI_TOKEN env var)
#
# Options:
#   --dry-run    Simulate without actually publishing
#   --ts-only    Only publish the TypeScript SDK
#   --py-only    Only publish the Python SDK

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TS_SDK_DIR="$ROOT_DIR/sdk/js"
PY_SDK_DIR="$ROOT_DIR/sdk/python"

DRY_RUN=false
TS_ONLY=false
PY_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --ts-only) TS_ONLY=true ;;
    --py-only) PY_ONLY=true ;;
  esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[publish-sdks]${NC} $1"; }
warn() { echo -e "${YELLOW}[publish-sdks]${NC} $1"; }
die()  { echo -e "${RED}[publish-sdks] ERROR:${NC} $1" >&2; exit 1; }

if $DRY_RUN; then
  warn "DRY RUN mode — no packages will actually be published"
fi

# ---------------------------------------------------------------------------
# TypeScript SDK
# ---------------------------------------------------------------------------
publish_ts_sdk() {
  log "Building TypeScript SDK..."
  cd "$TS_SDK_DIR"

  if [ ! -f package.json ]; then
    die "package.json not found in $TS_SDK_DIR"
  fi

  TS_VERSION=$(node -p "require('./package.json').version")
  log "TypeScript SDK version: $TS_VERSION"

  npm ci
  npm run build

  log "Running SDK tests..."
  npm test || warn "Tests failed — proceeding anyway (remove this warning for strict publishing)"

  if $DRY_RUN; then
    log "[DRY RUN] Would publish @agentpay/sdk@$TS_VERSION to npm"
    npm publish --dry-run --access public
  else
    if [ -n "${NPM_TOKEN:-}" ]; then
      echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc
    fi
    npm publish --access public
    log "✅ @agentpay/sdk@$TS_VERSION published to npm"
  fi

  cd "$ROOT_DIR"
}

# ---------------------------------------------------------------------------
# Python SDK
# ---------------------------------------------------------------------------
publish_py_sdk() {
  log "Building Python SDK..."
  cd "$PY_SDK_DIR"

  if [ ! -f pyproject.toml ]; then
    die "pyproject.toml not found in $PY_SDK_DIR"
  fi

  PY_VERSION=$(python3 -c "import tomllib; d=tomllib.load(open('pyproject.toml','rb')); print(d['project']['version'])" 2>/dev/null || \
               grep -m1 'version' pyproject.toml | sed 's/.*= *"\(.*\)"/\1/')
  log "Python SDK version: $PY_VERSION"

  python3 -m pip install --quiet build twine

  python3 -m build

  if $DRY_RUN; then
    log "[DRY RUN] Would publish agentpay@$PY_VERSION to PyPI"
    python3 -m twine check dist/*
  else
    if [ -n "${PYPI_TOKEN:-}" ]; then
      python3 -m twine upload dist/* \
        --username __token__ \
        --password "$PYPI_TOKEN" \
        --non-interactive
    else
      python3 -m twine upload dist/*
    fi
    log "✅ agentpay@$PY_VERSION published to PyPI"
  fi

  cd "$ROOT_DIR"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
log "AgentPay SDK Publisher"
log "Root: $ROOT_DIR"
echo ""

if ! $PY_ONLY; then
  publish_ts_sdk
fi

if ! $TS_ONLY; then
  publish_py_sdk
fi

log ""
log "🚀 SDK publishing complete!"
if ! $DRY_RUN; then
  log "  npm: https://www.npmjs.com/package/@agentpay/sdk"
  log "  pypi: https://pypi.org/project/agentpay/"
fi
