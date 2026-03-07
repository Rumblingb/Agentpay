#!/bin/bash

# Configuration
API_URL="https://apay-delta.vercel.app/api"
TEST_USER_EMAIL="test@agentpay.com"

echo "🚀 Starting Production Smoke Test for AgentPay..."

# 1. Check if the Frontend is up
echo -n "Checking Frontend availability... "
STATUS=$(curl -o /dev/null -s -w "%{http_code}" https://apay-delta.vercel.app)
if [ "$STATUS" -eq 200 ]; then echo "✅ PASS"; else echo "❌ FAIL ($STATUS)"; exit 1; fi

# 2. Check the API Proxy (The Rewrite)
echo -n "Checking API Proxy (Vercel -> Render)... "
# We expect a 401 or 403 here because we aren't sending a token yet, 
# but a 404 means your 'next.config.js' rewrites failed.
PROXY_STATUS=$(curl -o /dev/null -s -w "%{http_code}" "$API_URL/merchants/profile")
if [ "$PROXY_STATUS" -eq 401 ] || [ "$PROXY_STATUS" -eq 403 ]; then 
    echo "✅ PASS (Proxy active, Auth required)"
else 
    echo "❌ FAIL ($PROXY_STATUS) - Rewrite might be broken"; exit 1
fi

# 3. Check Database Data (Public Health Check)
echo -n "Checking AgentRank Registry... "
REGISTRY_STATUS=$(curl -o /dev/null -s -w "%{http_code}" "$API_URL/registry/agentTrust850")
if [ "$REGISTRY_STATUS" -eq 200 ]; then echo "✅ PASS"; else echo "❌ FAIL"; exit 1; fi

echo "🎉 All critical systems are GO."
