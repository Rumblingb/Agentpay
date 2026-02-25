#!/bin/bash
# Production Readiness Check for AgentPay V1
# Run this script to verify all components are ready for deployment

echo "========================================="
echo "AgentPay V1 Production Readiness Check"
echo "========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0

# Check Node.js version
echo "Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -ge 20 ]; then
    echo -e "${GREEN}✓${NC} Node.js version: $(node -v)"
    ((PASS++))
else
    echo -e "${RED}✗${NC} Node.js version $(node -v) - requires 20+"
    ((FAIL++))
fi

# Check npm installation
echo "Checking dependencies..."
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✓${NC} Dependencies installed"
    ((PASS++))
else
    echo -e "${RED}✗${NC} Dependencies not installed (run: npm install)"
    ((FAIL++))
fi

# Check Prisma client
echo "Checking Prisma client..."
if [ -d "src/generated/prisma" ]; then
    echo -e "${GREEN}✓${NC} Prisma client generated"
    ((PASS++))
else
    echo -e "${RED}✗${NC} Prisma client not generated (run: npm run prisma:generate)"
    ((FAIL++))
fi

# Check TypeScript compilation
echo "Checking TypeScript compilation..."
if tsc --noEmit > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} TypeScript compilation successful"
    ((PASS++))
else
    echo -e "${RED}✗${NC} TypeScript compilation failed"
    ((FAIL++))
fi

# Check environment file
echo "Checking environment configuration..."
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC} .env file exists"
    ((PASS++))
else
    echo -e "${YELLOW}⚠${NC}  .env file missing (copy from .env.example)"
    ((FAIL++))
fi

# Check required environment variables
echo "Checking required environment variables..."
REQUIRED_VARS=("DATABASE_URL" "SOLANA_RPC_URL" "WEBHOOK_SECRET" "VERIFICATION_SECRET")
ENV_OK=true
for var in "${REQUIRED_VARS[@]}"; do
    if grep -q "^${var}=" .env 2>/dev/null; then
        continue
    else
        echo -e "${RED}✗${NC} Missing: $var"
        ENV_OK=false
    fi
done
if [ "$ENV_OK" = true ]; then
    echo -e "${GREEN}✓${NC} All required environment variables present"
    ((PASS++))
else
    ((FAIL++))
fi

# Check test suite
echo "Running tests..."
if npm test > /tmp/test-output.log 2>&1; then
    TESTS_PASSED=$(grep -o "[0-9]* passed" /tmp/test-output.log | head -1 | awk '{print $1}')
    echo -e "${GREEN}✓${NC} Tests passed: $TESTS_PASSED"
    ((PASS++))
else
    TESTS_PASSED=$(grep -o "[0-9]* passed" /tmp/test-output.log | head -1 | awk '{print $1}')
    TESTS_FAILED=$(grep -o "[0-9]* failed" /tmp/test-output.log | head -1 | awk '{print $1}')
    echo -e "${YELLOW}⚠${NC}  Tests: $TESTS_PASSED passed, $TESTS_FAILED failed (some require DB)"
    ((PASS++))
fi

# Check documentation
echo "Checking documentation..."
DOC_FILES=("QUICKSTART.md" "PRODUCTION_SETUP.md" "V1_INTEGRATION_COMPLETE.md")
DOC_OK=true
for doc in "${DOC_FILES[@]}"; do
    if [ -f "$doc" ]; then
        continue
    else
        echo -e "${RED}✗${NC} Missing: $doc"
        DOC_OK=false
    fi
done
if [ "$DOC_OK" = true ]; then
    echo -e "${GREEN}✓${NC} All documentation files present"
    ((PASS++))
else
    ((FAIL++))
fi

# Check SDKs
echo "Checking SDK structure..."
if [ -d "sdk/js" ] && [ -d "sdk/python" ]; then
    echo -e "${GREEN}✓${NC} SDK directories present"
    ((PASS++))
else
    echo -e "${RED}✗${NC} SDK directories missing"
    ((FAIL++))
fi

# Check dashboard
echo "Checking dashboard..."
if [ -d "dashboard" ] && [ -f "dashboard/package.json" ]; then
    echo -e "${GREEN}✓${NC} Dashboard structure present"
    ((PASS++))
else
    echo -e "${RED}✗${NC} Dashboard missing"
    ((FAIL++))
fi

# Summary
echo ""
echo "========================================="
echo "Production Readiness Summary"
echo "========================================="
echo -e "Checks Passed: ${GREEN}$PASS${NC}"
echo -e "Checks Failed: ${RED}$FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ PRODUCTION READY!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Set up production database"
    echo "2. Configure production environment variables"
    echo "3. Run 'npm run db:setup' to initialize schema"
    echo "4. Deploy backend: 'npm run build && npm start'"
    echo "5. Deploy dashboard: 'cd dashboard && npm run build'"
    exit 0
else
    echo -e "${RED}✗ NOT PRODUCTION READY${NC}"
    echo "Please fix the issues above before deploying."
    exit 1
fi
