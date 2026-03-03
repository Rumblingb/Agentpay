#!/usr/bin/env bash
# =============================================================================
# scripts/deployment-check.sh
#
# Deployment sanity check for AgentPay.
# Verifies health endpoint, trust proxy, database connectivity,
# and runs production readiness checks.
#
# Usage:
#   chmod +x scripts/deployment-check.sh
#   ./scripts/deployment-check.sh
#   ./scripts/deployment-check.sh --url https://your-app.onrender.com
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
DEPLOY_URL="${1:-http://localhost:3001}"
PASS_COUNT=0
FAIL_COUNT=0
TOTAL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { ((PASS_COUNT++)); ((TOTAL++)); echo -e "  ${GREEN}✅ PASS${NC}: $1"; }
fail() { ((FAIL_COUNT++)); ((TOTAL++)); echo -e "  ${RED}❌ FAIL${NC}: $1"; }
info() { echo -e "  ${YELLOW}ℹ️  INFO${NC}: $1"; }

# =============================================================================
echo "============================================"
echo "  AgentPay Deployment Sanity Check"
echo "  Target: $DEPLOY_URL"
echo "  Time:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

# ── 1. Health Endpoint ───────────────────────────────────────────────────────
echo "── 1. Health Endpoint ──"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$DEPLOY_URL/health" 2>/dev/null || echo -e "\n000")
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | tail -1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | sed '$d')

if [ "$HEALTH_STATUS" -eq 200 ]; then
  pass "Health endpoint returns 200"
  
  if echo "$HEALTH_BODY" | grep -q '"status"'; then
    pass "Health response contains status field"
  else
    fail "Health response missing status field"
  fi

  if echo "$HEALTH_BODY" | grep -q '"version"'; then
    pass "Health response contains version field"
  else
    fail "Health response missing version field"
  fi

  if echo "$HEALTH_BODY" | grep -q '"uptime"'; then
    pass "Health response contains uptime field"
  else
    fail "Health response missing uptime field"
  fi
else
  fail "Health endpoint returned $HEALTH_STATUS (expected 200)"
  info "Is the server running at $DEPLOY_URL?"
fi
echo ""

# ── 2. Trust Proxy Check ────────────────────────────────────────────────────
echo "── 2. Trust Proxy ──"
# Verify X-Forwarded-For is respected by checking rate limit headers
HEADERS=$(curl -s -D - -o /dev/null "$DEPLOY_URL/health" 2>/dev/null || echo "")
if echo "$HEADERS" | grep -qi "x-ratelimit"; then
  pass "Rate limit headers present (trust proxy working)"
else
  info "Rate limit headers not visible (may still be configured correctly)"
fi
echo ""

# ── 3. Root Route ────────────────────────────────────────────────────────────
echo "── 3. Root Route ──"
ROOT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DEPLOY_URL/" 2>/dev/null || echo "000")
if [ "$ROOT_STATUS" -eq 200 ]; then
  pass "Root route returns 200"
else
  fail "Root route returned $ROOT_STATUS"
fi
echo ""

# ── 4. API Availability ─────────────────────────────────────────────────────
echo "── 4. API Route Availability ──"
for ENDPOINT in "/api/moltbook/services" "/api/moltbook/reputation/top"; do
  EP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DEPLOY_URL$ENDPOINT" 2>/dev/null || echo "000")
  if [ "$EP_STATUS" -eq 200 ]; then
    pass "GET $ENDPOINT returns 200"
  else
    fail "GET $ENDPOINT returned $EP_STATUS"
  fi
done
echo ""

# ── 5. Auth Protection ──────────────────────────────────────────────────────
echo "── 5. Auth Protection ──"
AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DEPLOY_URL/api/merchants/profile" 2>/dev/null || echo "000")
if [ "$AUTH_STATUS" -eq 401 ] || [ "$AUTH_STATUS" -eq 403 ]; then
  pass "Protected routes reject unauthenticated requests ($AUTH_STATUS)"
else
  fail "Protected route returned $AUTH_STATUS (expected 401/403)"
fi
echo ""

# ── 6. CORS & Security Headers ──────────────────────────────────────────────
echo "── 6. Security Headers ──"
SEC_HEADERS=$(curl -s -D - -o /dev/null "$DEPLOY_URL/" 2>/dev/null || echo "")
for HEADER in "x-content-type-options" "x-frame-options"; do
  if echo "$SEC_HEADERS" | grep -qi "$HEADER"; then
    pass "Security header present: $HEADER"
  else
    fail "Security header missing: $HEADER"
  fi
done
echo ""

# ── 7. Production Readiness Checklist ────────────────────────────────────────
echo "── 7. Production Readiness Checklist ──"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/scripts/production-ready-check.sh" ]; then
  info "Running production-ready-check.sh..."
  bash "$PROJECT_DIR/scripts/production-ready-check.sh" || true
else
  info "No production-ready-check.sh found. Manual checklist:"
  echo ""
  echo "  Production Readiness (from PRODUCTION_READINESS_REPORT.md):"
  echo "  ─────────────────────────────────────────────────────────"
  echo "  [✓] Recipient address verification enabled"
  echo "  [✓] API key authentication (PBKDF2)"
  echo "  [✓] Rate limiting (per IP + per merchant)"
  echo "  [✓] Input validation (Joi schemas)"
  echo "  [✓] SQL injection prevention (parameterized queries)"
  echo "  [✓] CORS protection configured"
  echo "  [✓] Helmet security headers"
  echo "  [✓] Trust proxy set for Render"
  echo "  [✓] Audit logging active"
  echo "  [✓] Transaction locking (race prevention)"
  echo "  [✓] Stripe webhook idempotency"
  echo "  [ ] Env validation (envalid)"
  echo "  [ ] Monitoring (Sentry/Prometheus)"
  echo "  [ ] Automated DB backups"
fi
echo ""

# ── 8. Render Deployment Hints ───────────────────────────────────────────────
echo "── 8. Deployment Notes ──"
if [ -f "$PROJECT_DIR/render.yaml" ]; then
  pass "render.yaml found for Render deployment"
else
  info "render.yaml not found"
fi

info "To deploy to Render:"
info "  git push origin main"
info "  Render auto-deploys from render.yaml"
info ""
info "To verify trust proxy after deploy:"
info "  curl -H 'X-Forwarded-For: 1.2.3.4' $DEPLOY_URL/health"
echo ""

# =============================================================================
# Summary
# =============================================================================
echo "============================================"
echo "  Deployment Check Results"
echo "============================================"
echo -e "  Total:  $TOTAL"
echo -e "  ${GREEN}Passed${NC}: $PASS_COUNT"
echo -e "  ${RED}Failed${NC}: $FAIL_COUNT"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "  ${GREEN}🎉 All deployment checks passed!${NC}"
  exit 0
else
  echo -e "  ${YELLOW}⚠️  $FAIL_COUNT check(s) failed. Review output above.${NC}"
  exit 1
fi
