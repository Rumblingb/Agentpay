#!/bin/bash

# AgentPay Travel Agents - Automated Setup Script
# This script sets up everything you need to deploy the travel agents

set -e  # Exit on error

echo "🚀 AgentPay Travel Agents - Setup Script"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found${NC}"
    echo "Please run this script from your AgentPay repository root"
    exit 1
fi

echo -e "${GREEN}✓${NC} Found package.json"

# Step 1: Create directories
echo ""
echo "Step 1: Creating directories..."
mkdir -p src/agents/travel
mkdir -p src/api/agents
mkdir -p src/components/booking
echo -e "${GREEN}✓${NC} Directories created"

# Step 2: Install dependencies
echo ""
echo "Step 2: Installing dependencies..."
if command -v npm &> /dev/null; then
    npm install amadeus@latest
    echo -e "${GREEN}✓${NC} Amadeus SDK installed"
else
    echo -e "${RED}Error: npm not found${NC}"
    exit 1
fi

# Step 3: Check for Prisma
echo ""
echo "Step 3: Checking Prisma setup..."
if [ -f "prisma/schema.prisma" ]; then
    echo -e "${GREEN}✓${NC} Prisma schema found"
else
    echo -e "${RED}Error: prisma/schema.prisma not found${NC}"
    exit 1
fi

# Step 4: Environment variables
echo ""
echo "Step 4: Checking environment variables..."
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC} .env file found"
    
    # Check if Amadeus vars exist
    if grep -q "AMADEUS_API_KEY" .env; then
        echo -e "${YELLOW}Warning: AMADEUS_API_KEY already exists in .env${NC}"
    else
        echo ""
        echo "Adding Amadeus environment variables to .env..."
        echo "" >> .env
        echo "# Amadeus Travel API" >> .env
        echo "AMADEUS_API_KEY=your_amadeus_api_key_here" >> .env
        echo "AMADEUS_API_SECRET=your_amadeus_api_secret_here" >> .env
        echo "AMADEUS_ENV=test" >> .env
        echo -e "${GREEN}✓${NC} Amadeus vars added to .env"
    fi
else
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Creating .env from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}✓${NC} .env created"
    else
        echo -e "${RED}Error: .env.example not found${NC}"
        exit 1
    fi
fi

# Step 5: Database schema update instructions
echo ""
echo "Step 5: Database schema..."
echo -e "${YELLOW}Action required:${NC}"
echo "1. Open prisma/schema.prisma"
echo "2. Add the models from prisma-additions.prisma"
echo "3. Run: npx prisma migrate dev --name add_travel_agents"
echo "4. Run: npx prisma generate"
echo ""
read -p "Have you added the schema and run migrations? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Please complete the schema updates before continuing${NC}"
    echo "See INTEGRATION_GUIDE.md for details"
    exit 0
fi

echo -e "${GREEN}✓${NC} Database schema updated"

# Step 6: Copy files
echo ""
echo "Step 6: Agent files..."
echo "Please manually copy these files to your repo:"
echo "  - FlightDiscoveryAgent.ts → src/agents/travel/"
echo "  - TravelExecutionAgent.ts → src/agents/travel/"
echo "  - PremiumFlightBooking.tsx → src/components/booking/"
echo ""
read -p "Have you copied the agent files? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Please copy the files before continuing${NC}"
    exit 0
fi

# Step 7: Create index file
echo ""
echo "Step 7: Creating index files..."
cat > src/agents/travel/index.ts << 'EOF'
export { flightDiscoveryAgent, handleFlightDiscovery } from './FlightDiscoveryAgent';
export { travelExecutionAgent, handleTravelExecution } from './TravelExecutionAgent';
EOF
echo -e "${GREEN}✓${NC} Index file created"

# Step 8: API routes instructions
echo ""
echo "Step 8: API routes..."
echo -e "${YELLOW}Action required:${NC}"
echo "Create these API route files:"
echo "  - src/api/agents/flight-discovery.ts"
echo "  - src/api/agents/travel-execution.ts"
echo ""
echo "See INTEGRATION_GUIDE.md for the code"
echo ""
read -p "Have you created the API routes? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Please create the API routes before testing${NC}"
    exit 0
fi

# Step 9: Amadeus API keys
echo ""
echo "Step 9: Amadeus API credentials..."
echo -e "${YELLOW}Important:${NC}"
echo "1. Go to https://developers.amadeus.com"
echo "2. Sign up and create a new app"
echo "3. Copy your API key and secret"
echo "4. Update .env with your credentials"
echo ""
read -p "Have you set up Amadeus API credentials? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}You'll need Amadeus credentials to test${NC}"
    echo "Visit: https://developers.amadeus.com"
    exit 0
fi

# Step 10: Final checks
echo ""
echo "Step 10: Running final checks..."

# Check if TypeScript compiles
if command -v tsc &> /dev/null; then
    echo "Checking TypeScript..."
    if tsc --noEmit; then
        echo -e "${GREEN}✓${NC} TypeScript compilation successful"
    else
        echo -e "${YELLOW}Warning: TypeScript errors found${NC}"
        echo "Fix these before deploying"
    fi
fi

# Summary
echo ""
echo "=========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Test the discovery agent:"
echo "   curl -X POST http://localhost:3000/api/agents/flight-discovery \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -H 'Authorization: Bearer YOUR_API_KEY' \\"
echo "     -d '{\"action\":\"search\",\"merchantId\":\"test\",\"origin\":\"LAX\",\"destination\":\"JFK\",\"departureDate\":\"2026-04-15\"}'"
echo ""
echo "2. Visit the UI:"
echo "   http://localhost:3000/flights"
echo ""
echo "3. Deploy to production:"
echo "   vercel --prod (or your deployment command)"
echo ""
echo "📚 Read INTEGRATION_GUIDE.md for complete details"
echo "📝 Read README.md for the vision and strategy"
echo ""
echo -e "${GREEN}Good luck! Ship this thing. 🚀${NC}"
