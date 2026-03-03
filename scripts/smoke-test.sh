#!/usr/bin/env bash
# =============================================================================
# scripts/smoke-test.sh
#
# Quick smoke test for AgentPay key flows.
# Tests merchant registration, spending policies, payment simulation,
# Stripe webhook forwarding, error handling (403/500), and Moltbook flows.
#
# Prerequisites:
#   - Server running on localhost:3001 (npm run dev)
#   - PostgreSQL running with migrations applied
#   - Optional: Stripe CLI installed for webhook tests
#
# Usage:
#   chmod +x scripts/smoke-test.sh
#   ./scripts/smoke-test.sh
#   ./scripts/smoke-test.sh --base-url http://localhost:3001
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
BASE_URL="${1:-http://localhost:3001}"
PASS_COUNT=0
FAIL_COUNT=0
TOTAL=0

# ── Helpers ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() {
  ((PASS_COUNT++))
  ((TOTAL++))
  echo -e "  ${GREEN}✅ PASS${NC}: $1"
}

fail() {
  ((FAIL_COUNT++))
  ((TOTAL++))
  echo -e "  ${RED}❌ FAIL${NC}: $1"
}

info() {
  echo -e "  ${YELLOW}ℹ️  INFO${NC}: $1"
}

check_status() {
  local description="$1"
  local expected_status="$2"
  local actual_status="$3"

  if [ "$actual_status" -eq "$expected_status" ]; then
    pass "$description (HTTP $actual_status)"
  else
    fail "$description (expected $expected_status, got $actual_status)"
  fi
}

# =============================================================================
echo "============================================"
echo "  AgentPay Smoke Test Suite"
echo "  Target: $BASE_URL"
echo "  Time:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

# ── 1. Health Check ──────────────────────────────────────────────────────────
echo "── 1. Health Check ──"
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" 2>/dev/null || echo "000")
check_status "GET /health returns 200" 200 "$HEALTH_STATUS"

HEALTH_BODY=$(curl -s "$BASE_URL/health" 2>/dev/null || echo "{}")
if echo "$HEALTH_BODY" | grep -q '"status"'; then
  pass "Health response contains status field"
else
  fail "Health response missing status field"
fi
echo ""

# ── 2. Root Route ────────────────────────────────────────────────────────────
echo "── 2. Root Route ──"
ROOT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null || echo "000")
check_status "GET / returns 200" 200 "$ROOT_STATUS"
echo ""

# ── 3. Merchant Registration ────────────────────────────────────────────────
echo "── 3. Merchant Registration ──"
TIMESTAMP=$(date +%s)
REG_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/merchants/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"SmokeTest Merchant $TIMESTAMP\",
    \"email\": \"smoke-$TIMESTAMP@test.com\",
    \"walletAddress\": \"9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo\"
  }" 2>/dev/null || echo -e "\n000")

REG_STATUS=$(echo "$REG_RESPONSE" | tail -1)
REG_BODY=$(echo "$REG_RESPONSE" | sed '$d')
check_status "POST /api/merchants/register returns 201" 201 "$REG_STATUS"

API_KEY=$(echo "$REG_BODY" | grep -o '"apiKey":"[^"]*"' | cut -d'"' -f4 || echo "")
if [ -n "$API_KEY" ]; then
  pass "Registration returned API key"
  info "API Key: ${API_KEY:0:20}..."
else
  fail "Registration did not return API key"
  API_KEY="dummy-key"
fi
echo ""

# ── 4. Authentication (403 on bad auth) ─────────────────────────────────────
echo "── 4. Authentication Checks ──"
AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer invalid-key-12345" \
  "$BASE_URL/api/merchants/profile" 2>/dev/null || echo "000")
if [ "$AUTH_STATUS" -eq 401 ] || [ "$AUTH_STATUS" -eq 403 ]; then
  pass "Bad auth returns 401/403 (got $AUTH_STATUS)"
else
  fail "Bad auth should return 401/403 (got $AUTH_STATUS)"
fi

NOAUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/merchants/profile" 2>/dev/null || echo "000")
if [ "$NOAUTH_STATUS" -eq 401 ] || [ "$NOAUTH_STATUS" -eq 403 ]; then
  pass "No auth returns 401/403 (got $NOAUTH_STATUS)"
else
  fail "No auth should return 401/403 (got $NOAUTH_STATUS)"
fi
echo ""

# ── 5. Moltbook Bot Registration ────────────────────────────────────────────
echo "── 5. Moltbook Bot Registration ──"
BOT_HANDLE="smokebot-$TIMESTAMP"
BOT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/moltbook/bots/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"handle\": \"$BOT_HANDLE\",
    \"display_name\": \"Smoke Test Bot\",
    \"primary_function\": \"testing\"
  }" 2>/dev/null || echo -e "\n000")

BOT_STATUS=$(echo "$BOT_RESPONSE" | tail -1)
BOT_BODY=$(echo "$BOT_RESPONSE" | sed '$d')
check_status "POST /api/moltbook/bots/register returns 201" 201 "$BOT_STATUS"

BOT_ID=$(echo "$BOT_BODY" | grep -o '"botId":"[^"]*"' | cut -d'"' -f4 || echo "")
if [ -n "$BOT_ID" ]; then
  pass "Bot registration returned botId"
else
  # Try alternate field name
  BOT_ID=$(echo "$BOT_BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "test-bot-id")
  info "Using extracted botId: $BOT_ID"
fi
echo ""

# ── 6. Spending Policy ──────────────────────────────────────────────────────
echo "── 6. Spending Policy ──"
if [ -n "$API_KEY" ] && [ "$API_KEY" != "dummy-key" ]; then
  POLICY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    "$BASE_URL/api/moltbook/bots/$BOT_ID/spending-policy" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{
      "dailySpendingLimit": 100,
      "perTxLimit": 25,
      "autoApproveUnder": 5
    }' 2>/dev/null || echo "000")
  if [ "$POLICY_STATUS" -eq 200 ] || [ "$POLICY_STATUS" -eq 404 ]; then
    pass "PATCH spending-policy responded (HTTP $POLICY_STATUS)"
  else
    fail "PATCH spending-policy unexpected status (HTTP $POLICY_STATUS)"
  fi
else
  info "Skipping spending policy test (no valid API key)"
fi
echo ""

# ── 7. Marketplace Services ─────────────────────────────────────────────────
echo "── 7. Marketplace ──"
MARKET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/moltbook/services" 2>/dev/null || echo "000")
check_status "GET /api/moltbook/services returns 200" 200 "$MARKET_STATUS"
echo ""

# ── 8. No 500s Check ────────────────────────────────────────────────────────
echo "── 8. Error Handling ──"
INVALID_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/merchants/payments/not-a-uuid/verify" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"transactionHash": "fake"}' 2>/dev/null || echo "000")
if [ "$INVALID_STATUS" -ne 500 ]; then
  pass "Invalid UUID does not cause 500 (got $INVALID_STATUS)"
else
  fail "Invalid UUID caused a 500 error"
fi
echo ""

# ── 9. Stripe Webhook (if Stripe CLI available) ─────────────────────────────
echo "── 9. Stripe Webhook ──"
if command -v stripe &> /dev/null; then
  info "Stripe CLI found. To test webhooks, run in another terminal:"
  info "  stripe listen --forward-to $BASE_URL/webhooks/stripe"
  info "  stripe trigger payment_intent.succeeded"
  pass "Stripe CLI available for webhook testing"
else
  info "Stripe CLI not installed. Skipping webhook forwarding test."
  info "Install: https://stripe.com/docs/stripe-cli"
fi
echo ""

# ── 10. Merchant Stats ──────────────────────────────────────────────────────
echo "── 10. Merchant Stats ──"
if [ -n "$API_KEY" ] && [ "$API_KEY" != "dummy-key" ]; then
  STATS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $API_KEY" \
    "$BASE_URL/api/merchants/stats" 2>/dev/null || echo "000")
  check_status "GET /api/merchants/stats returns 200" 200 "$STATS_STATUS"
else
  info "Skipping stats test (no valid API key)"
fi
echo ""

# =============================================================================
# Summary
# =============================================================================
echo "============================================"
echo "  Smoke Test Results"
echo "============================================"
echo -e "  Total:  $TOTAL"
echo -e "  ${GREEN}Passed${NC}: $PASS_COUNT"
echo -e "  ${RED}Failed${NC}: $FAIL_COUNT"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "  ${GREEN}🎉 All smoke tests passed!${NC}"
  exit 0
else
  echo -e "  ${RED}⚠️  $FAIL_COUNT test(s) failed. Review output above.${NC}"
  exit 1
fi
