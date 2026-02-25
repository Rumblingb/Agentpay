# Agentpay V1 - Quick Start Guide

Get Agentpay V1 up and running in under 5 minutes!

## Overview

Agentpay is a production-ready HTTP 402 Payment Required server for processing USDC payments on Solana blockchain. It includes critical security features like recipient address verification, comprehensive testing, and full audit logging.

## What You Get

✅ **7 Production-Ready API Endpoints**
- Merchant registration and authentication
- Payment request creation
- Payment verification with blockchain validation
- Transaction tracking and statistics

✅ **Critical Security Features**
- Recipient address verification (prevents fraud)
- PBKDF2 API key encryption (100,000 iterations)
- Rate limiting (100 req/15min global, 20 req/min for verification)
- CORS protection
- Security headers with Helmet
- Audit logging (FCA AML compliance)

✅ **21 Passing Tests**
- Integration tests for all endpoints
- Security-focused tests
- Input validation tests

✅ **Production Database Schema**
- 6 core tables with 12+ indexes
- Foreign key constraints
- Append-only audit log

---

## Quick Start (Development)

### Prerequisites

- **Node.js 20+** (check with `node --version`)
- **PostgreSQL 12+** or use Docker
- **Git**

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/Rumblingb/Agentpay.git
cd Agentpay

# Install dependencies
npm install
```

### 2. Set Up Database (Choose One Option)

#### Option A: Using Docker (Easiest)

```bash
# Start PostgreSQL in Docker
docker run -d \
  --name agentpay-db \
  -e POSTGRES_PASSWORD=devpassword \
  -e POSTGRES_DB=agentpay_dev \
  -p 5432:5432 \
  postgres:14-alpine

# Wait 5 seconds for PostgreSQL to start
sleep 5
```

#### Option B: Using Existing PostgreSQL

```bash
# Create database
psql -U postgres -c "CREATE DATABASE agentpay_dev;"
```

### 3. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env file (use your favorite editor)
nano .env
```

**Minimum required configuration:**

```bash
# Database
DATABASE_URL=postgresql://postgres:devpassword@localhost:5432/agentpay_dev

# Solana (use devnet for development)
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_NETWORK=devnet

# Webhook secret (generate with: openssl rand -hex 32)
WEBHOOK_SECRET=your_random_32_character_secret_here
```

### 4. Initialize Database

```bash
# Create tables and run migrations
npm run db:setup

# You should see:
# ✅ Database initialized successfully!
# ✅ All migrations complete.
```

### 5. Run Tests

```bash
# Run all tests (should show 21 passing)
npm test

# Expected output:
# Test Suites: 2 passed, 2 total
# Tests:       21 passed, 21 total
```

### 6. Start Development Server

```bash
# Start the server with hot reload
npm run dev

# You should see:
# 🚀 AgentPay API running on http://localhost:3001
# Mode: development
```

### 7. Test the API

Open a new terminal and test the health endpoint:

```bash
curl http://localhost:3001/health

# Expected response:
# {"status":"active","timestamp":"2024-XX-XXTXX:XX:XX.XXXZ"}
```

---

## API Usage Examples

### 1. Register a Merchant

```bash
curl -X POST http://localhost:3001/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Business",
    "email": "merchant@example.com",
    "walletAddress": "5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD"
  }'

# Response:
# {
#   "success": true,
#   "merchantId": "uuid-here",
#   "apiKey": "your-secret-api-key-save-this",
#   "message": "Store your API key securely..."
# }
```

**⚠️ Important:** Save the API key! It's only shown once.

### 2. Get Merchant Profile

```bash
curl http://localhost:3001/api/merchants/profile \
  -H "Authorization: Bearer YOUR_API_KEY"

# Response:
# {
#   "success": true,
#   "merchant": {
#     "id": "...",
#     "name": "My Business",
#     "email": "merchant@example.com",
#     "walletAddress": "5YNm...",
#     "webhookUrl": null
#   }
# }
```

### 3. Create Payment Request

```bash
curl -X POST http://localhost:3001/api/merchants/payments \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1.50,
    "metadata": {
      "orderId": "ORDER-123",
      "description": "Premium API access"
    }
  }'

# Response:
# {
#   "success": true,
#   "transactionId": "uuid",
#   "paymentId": "uuid",
#   "amount": 1.50,
#   "recipientAddress": "5YNm...",
#   "expiresAt": "2024-XX-XX...",
#   "status": "pending"
# }
```

### 4. Verify Payment (Critical Security Feature)

```bash
curl -X POST http://localhost:3001/api/merchants/payments/TRANSACTION_ID/verify \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "transactionHash": "SOLANA_TRANSACTION_SIGNATURE"
  }'

# Response (if payment is valid):
# {
#   "success": true,
#   "transaction": {
#     "id": "...",
#     "status": "confirmed",
#     "confirmationDepth": 2,
#     ...
#   }
# }
```

### 5. List Transactions

```bash
curl http://localhost:3001/api/merchants/payments \
  -H "Authorization: Bearer YOUR_API_KEY"

# Response:
# {
#   "success": true,
#   "transactions": [...],
#   "pagination": {
#     "page": 1,
#     "limit": 50,
#     "total": 10
#   }
# }
```

### 6. Get Statistics

```bash
curl http://localhost:3001/api/merchants/stats \
  -H "Authorization: Bearer YOUR_API_KEY"

# Response:
# {
#   "success": true,
#   "stats": {
#     "totalTransactions": 42,
#     "confirmedTransactions": 38,
#     "pendingTransactions": 2,
#     "totalVolume": 1250.50
#   }
# }
```

---

## Project Structure

```
Agentpay/
├── src/                          # TypeScript source code
│   ├── db/                       # Database connection and init
│   ├── security/                 # Payment verification (CRITICAL)
│   ├── services/                 # Business logic
│   │   ├── merchants.ts          # Registration & auth
│   │   ├── transactions.ts       # Payment processing
│   │   ├── webhooks.ts           # Webhook delivery
│   │   └── audit.ts              # Audit logging
│   ├── middleware/               # Express middleware
│   ├── routes/                   # API endpoints
│   ├── utils/                    # Crypto utilities
│   ├── logger.ts                 # Pino logger
│   └── server.ts                 # Express app
├── tests/                        # Test suites (21 tests)
│   ├── integration.test.ts       # API integration tests
│   ├── security.test.ts          # Security tests
│   └── setup.ts                  # Test configuration
├── scripts/                      # Database scripts
│   ├── create-db.js              # Schema initialization
│   └── migrate.js                # Database migrations
├── docs/                         # Documentation
├── .env.example                  # Environment template
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
└── jest.config.js                # Test config
```

---

## Available NPM Scripts

```bash
# Development
npm run dev              # Start development server with hot reload
npm run build            # Compile TypeScript to JavaScript
npm run start            # Start production server (builds first)
npm run start:prod       # Start with NODE_ENV=production

# Testing
npm test                 # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
npm run test:security    # Run security tests only

# Database
npm run db:create        # Create database tables
npm run db:migrate       # Run migrations
npm run db:setup         # Create tables AND run migrations

# Utilities
npm run clean            # Remove build artifacts
npm run clean:build      # Clean and rebuild
npm run validate         # Build and test (pre-deploy check)
```

---

## Environment Variables Reference

### Required

```bash
DATABASE_URL              # PostgreSQL connection string
SOLANA_RPC_URL           # Solana RPC endpoint
WEBHOOK_SECRET           # Secret for HMAC webhook signing
```

### Optional (with defaults)

```bash
PORT=3001                           # Server port
NODE_ENV=development                # Environment (development|production|test)
LOG_LEVEL=info                      # Log level (debug|info|warn|error)
SOLANA_NETWORK=devnet              # Solana network (devnet|mainnet-beta)
CONFIRMATION_DEPTH=2                # Required block confirmations
PAYMENT_EXPIRY_MINUTES=30          # Payment expiry time
CORS_ORIGIN=http://localhost:3000  # Allowed CORS origin
RATE_LIMIT_WINDOW_MS=900000        # Rate limit window (15 min)
RATE_LIMIT_MAX_REQUESTS=100        # Max requests per window
```

---

## Common Issues & Solutions

### Issue: Tests Fail with "ENOTFOUND"

**Solution:** Database not accessible. Check:
1. PostgreSQL is running: `docker ps` or `pg_isready`
2. DATABASE_URL in .env is correct
3. Firewall allows connection on port 5432

### Issue: "jest: not found"

**Solution:** Dependencies not installed.
```bash
rm -rf node_modules package-lock.json
npm install
```

### Issue: Build Fails

**Solution:** Check TypeScript version.
```bash
npm run clean
npm run build
```

### Issue: Port 3001 Already in Use

**Solution:** Change PORT in .env or kill existing process:
```bash
lsof -ti:3001 | xargs kill -9
```

### Issue: Rate Limited During Testing

**Solution:** Tests use different rate limits. If hitting global limits:
```bash
# Wait 15 minutes or restart server
npm run dev
```

---

## Security Best Practices

1. **Never commit .env file** (already in .gitignore)
2. **Store API keys securely** (they're only shown once)
3. **Use HTTPS in production** (see PRODUCTION_SETUP.md)
4. **Set strong WEBHOOK_SECRET** (32+ random characters)
5. **Keep dependencies updated** (`npm audit`)
6. **Monitor logs** for suspicious activity
7. **Use mainnet RPC** for production (devnet for testing)

---

## Next Steps

### For Development

1. Read `README.md` for complete API documentation
2. Review `START_HERE.md` for detailed project overview
3. Check `docs/architecture.md` for system design
4. Explore `tests/` for usage examples

### For Production

1. Read `PRODUCTION_SETUP.md` for deployment guide
2. Review `DEPLOYMENT.md` for infrastructure setup
3. Set up monitoring and logging
4. Configure automated backups
5. Set up SSL/TLS certificates

---

## Testing Your Setup

Run this complete validation:

```bash
# 1. Verify build
npm run build

# 2. Run all tests
npm test

# 3. Start server
npm run dev &
SERVER_PID=$!

# 4. Wait for server to start
sleep 3

# 5. Test health endpoint
curl http://localhost:3001/health

# 6. Register test merchant
RESPONSE=$(curl -s -X POST http://localhost:3001/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test",
    "email": "test@example.com",
    "walletAddress": "5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD"
  }')

echo $RESPONSE

# 7. Stop server
kill $SERVER_PID

# If all steps succeed, you're ready! 🎉
```

---

## Support

- **Issues**: https://github.com/Rumblingb/Agentpay/issues
- **Documentation**: See README.md, START_HERE.md
- **Solana Docs**: https://docs.solana.com

---

## License

MIT License - see LICENSE file

---

**Agentpay V1 is production-ready!** Start building secure payment-gated APIs today. 🚀
