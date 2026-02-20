# x402 Payment Server - Week 1 Complete Build

A production-ready HTTP 402 Payment Required server with USDC payments on Solana, featuring critical security fixes, comprehensive database schema, and full test coverage.

## 🔒 Critical Security Features

### ✅ Recipient Address Verification (CRITICAL FIX)
**Prevents attackers from sending payments to their own wallet and claiming they paid you.**

The server verifies that:
1. The transaction ACTUALLY occurred on-chain
2. The recipient of the USDC **matches your merchant wallet address**
3. Confirmation depth requirements are met
4. All transactions are logged for audit trail

**Vulnerability Prevented:**
- ❌ Attacker sends USDC to their wallet (0xAttacker)
- ❌ Attacker submits the transaction hash to your server claiming they paid you
- ✅ Server verifies recipient address in transaction != expected merchant wallet
- ✅ Payment is REJECTED

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 12+
- Solana devnet account with testnet USDC

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Setup environment variables
cp .env.example .env
# Edit .env with your database credentials and wallet address

# 3. Initialize database
npm run db:create
npm run db:migrate

# 4. Start development server
npm run dev
```

## 📊 Database Schema

### merchants
```sql
- id (UUID)
- name (VARCHAR)
- email (UNIQUE)
- api_key_hash (UNIQUE, PBKDF2 encrypted)
- api_key_salt
- wallet_address (UNIQUE, your Solana address)
- is_active (BOOLEAN)
- created_at, updated_at
```

### transactions
```sql
- id (UUID)
- merchant_id (FK)
- payment_id (UNIQUE)
- amount_usdc (DECIMAL)
- recipient_address (THE CRITICAL SECURITY CHECK)
- payer_address
- transaction_hash
- status (pending/confirmed/failed/expired)
- confirmation_depth (2+ blocks required)
- metadata (JSONB)
- created_at, expires_at
```

### Additional Tables
- `api_logs` - Audit trail of all API calls
- `rate_limit_counters` - IP + merchant rate limiting
- `payment_verifications` - Secure verification tokens
- `webhook_events` - Merchant notifications

## 🔌 API Endpoints

### 1. Register Merchant
```bash
POST /api/merchants/register
Content-Type: application/json

{
  "name": "My Business",
  "email": "business@example.com",
  "walletAddress": "9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo"
}

Response:
{
  "success": true,
  "merchantId": "uuid",
  "apiKey": "your-secret-api-key",
  "message": "Store your API key securely. You will not be able to view it again."
}
```

### 2. Get Profile
```bash
GET /api/merchants/profile
Authorization: Bearer YOUR_API_KEY

Response:
{
  "id": "uuid",
  "name": "My Business",
  "email": "business@example.com",
  "walletAddress": "9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo",
  "createdAt": "2024-02-16T..."
}
```

### 3. Create Payment Request
```bash
POST /api/merchants/payments
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "amountUsdc": 100,
  "recipientAddress": "9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo",
  "metadata": {
    "userId": "user123",
    "contentId": "article42"
  },
  "expiryMinutes": 30
}

Response:
{
  "success": true,
  "transactionId": "uuid",
  "paymentId": "x402_1708123456_abc123",
  "amount": 100,
  "recipientAddress": "9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo",
  "instructions": "Send USDC to the recipient address within the expiry time"
}
```

### 4. Verify Payment (CRITICAL SECURITY)
```bash
POST /api/merchants/payments/{transactionId}/verify
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "transactionHash": "5J7KvB8mN2...full_solana_tx_hash"
}

Response:
{
  "success": true,
  "verified": true,
  "payer": "FpCMFDFGW1V9...",
  "message": "Payment confirmed!"
}
```

**⚠️ SECURITY: This endpoint verifies that:**
1. The transaction exists on-chain
2. The recipient address matches your merchant wallet
3. The transaction succeeded
4. Confirmation depth >= 2 blocks

### 5. Get Transaction
```bash
GET /api/merchants/payments/{transactionId}
Authorization: Bearer YOUR_API_KEY

Response:
{
  "id": "uuid",
  "paymentId": "x402_...",
  "merchantId": "uuid",
  "amountUsdc": 100,
  "recipientAddress": "9B5X...",
  "payerAddress": "FpCM...",
  "transactionHash": "5J7K...",
  "status": "confirmed",
  "confirmationDepth": 45
}
```

### 6. List Payments
```bash
GET /api/merchants/payments?limit=50&offset=0
Authorization: Bearer YOUR_API_KEY

Response:
{
  "success": true,
  "transactions": [...],
  "stats": {
    "totalTransactions": 25,
    "confirmedCount": 23,
    "pendingCount": 2,
    "failedCount": 0,
    "totalConfirmedUsdc": 2500
  }
}
```

### 7. Get Statistics
```bash
GET /api/merchants/stats
Authorization: Bearer YOUR_API_KEY

Response:
{
  "success": true,
  "totalTransactions": 25,
  "confirmedCount": 23,
  "pendingCount": 2,
  "failedCount": 0,
  "totalConfirmedUsdc": 2500
}
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run only security tests
npm run test:security

# Watch mode
npm run test:watch
```

### Test Coverage
- ✅ 17+ integration tests
- ✅ Security tests for recipient verification
- ✅ API authentication tests
- ✅ Input validation tests
- ✅ Rate limiting tests
- ✅ End-to-end payment flow tests

## 🔐 Security Checklist

### Implemented ✅
- [x] Recipient address verification (CRITICAL)
- [x] API key authentication (PBKDF2)
- [x] Rate limiting (per IP + per merchant)
- [x] Input validation (Joi)
- [x] SQL injection prevention (prepared statements)
- [x] CORS protection
- [x] Helmet security headers
- [x] Audit logging
- [x] Transaction locking (race condition prevention)
- [x] Confirmation depth checking (2+ blocks)

### Production Hardening (Week 2)
- [ ] JWT tokens with expiry
- [ ] Webhook verification signatures
- [ ] IP whitelist per merchant
- [ ] Payment encryption at rest
- [ ] PII redaction in logs
- [ ] Rate limiting improvements
- [ ] DDoS protection

## 📋 Week 1 Deliverables Checklist

### Core Functionality
- [x] x402 payment creation working
- [x] **Payment verification with recipient check** (CRITICAL)
- [x] Merchant registration
- [x] API key authentication
- [x] Transaction tracking

### Security
- [x] **Recipient address verification** (CRITICAL FIX)
- [x] Confirmation depth check (2+ blocks)
- [x] Rate limiting (IP + merchant)
- [x] Input validation (Joi)
- [x] SQL injection prevention

### Testing
- [x] 17+ tests passing
- [x] Security tests passing
- [x] Performance tests <100ms
- [x] End-to-end flow working

### Database
- [x] merchants table with API key hashing
- [x] transactions table with recipient tracking
- [x] api_logs for audit trail
- [x] rate_limit_counters for DDoS protection
- [x] payment_verifications for secure tokens
- [x] webhook_events for notifications

### Documentation
- [x] API documentation complete
- [x] Security documentation
- [x] README with setup guide
- [x] Database schema documented

## ⚠️ CRITICAL: Recipient Verification

**This is the single most important security feature.**

### How It Works
```typescript
// When merchant submits a transaction hash for verification:
const verification = await verifyPaymentRecipient(
  txHash,                                    // e.g., "5J7KvB..."
  expectedRecipient                          // e.g., merchant's wallet
);

// The server:
// 1. Fetches the transaction from Solana blockchain
// 2. Extracts all token transfers
// 3. CHECKS: Does ANY transfer have destination == expectedRecipient?
// 4. If YES: Verify amount, confirmations, etc.
// 5. If NO: REJECT with clear error
```

### Attack Scenario Prevented
```
❌ BEFORE (Vulnerable):
  1. Attacker sends 100 USDC to 0xAttacker
  2. Attacker submits that tx hash to your server
  3. Server doesn't check recipient address
  4. Attacker gets access to your content
  5. You never received payment!

✅ AFTER (Secured):
  1. Attacker sends 100 USDC to 0xAttacker
  2. Attacker submits that tx hash to your server
  3. Server verifies: recipient in tx (0xAttacker) == expected (0xYourWallet)?
  4. MISMATCH DETECTED
  5. Server logs security event and REJECTS
  6. Attacker gets 401 error
```

## 🚨 Important Notes

1. **API Keys**: Generated only at registration. Store securely. No way to recover.
2. **Wallet Address**: The Solana wallet that receives payments. Use a dedicated account.
3. **Recipient Address**: In payment requests, this is YOUR wallet. Verify this is set correctly.
4. **Transaction Verification**: Only payments to YOUR wallet are accepted.

## 📞 Support

For issues or questions:
1. Check the logs: `logs/` directory
2. Review security tests: `tests/security.test.ts`
3. Verify database schema: `src/db/init.ts`

## 📄 License

MIT

---

**Built with security-first approach. Recipient address verification prevents payment fraud.**