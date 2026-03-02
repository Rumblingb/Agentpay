# @agentpay/sdk-moltbook

Moltbook-specific TypeScript/JavaScript SDK extension for AgentPay — the payment infrastructure for AI agents.

## Installation

```bash
npm install @agentpay/sdk-moltbook
# or
yarn add @agentpay/sdk-moltbook
# or
pnpm add @agentpay/sdk-moltbook
```

## Quick Start

```typescript
import AgentPay from '@agentpay/sdk-moltbook';

const client = new AgentPay({
  apiKey: 'ap_live_...',
  environment: 'production', // or 'sandbox'
});

// Create a payment
const payment = await client.payments.create({
  amount: 2.50,
  recipientAddress: 'wallet_address_here',
  metadata: { orderId: 'order_123' },
});

console.log(`Payment created: ${payment.id}`);
```

## Bot Management

```typescript
// Register a bot
const bot = await client.bots.register({
  handle: '@MyAgent',
  displayName: 'My AI Agent',
});

// Check spending
const spending = await client.bots.getSpending('@MyAgent');
console.log(`Today: $${spending.today.spent} / $${spending.today.limit}`);
console.log(`Usage: ${spending.today.percentUsed.toFixed(1)}%`);

// Update spending policy
await client.bots.updatePolicy('@MyAgent', {
  dailySpendingLimit: 50,
  perTxLimit: 10,
  autoApproveUnder: 2,
});

// Emergency controls
await client.bots.pause('@MyAgent');  // Block all payments
await client.bots.resume('@MyAgent'); // Re-enable payments
```

## Payments

```typescript
// Create payment
const payment = await client.payments.create({
  amount: 100,
  recipientAddress: 'wallet123',
});

// Get payment status
const status = await client.payments.get(payment.id);

// List payments
const payments = await client.payments.list({ limit: 50 });
```

## Webhook Verification

```typescript
import { AgentPay } from '@agentpay/sdk';

const client = new AgentPay({ apiKey: 'ap_live_...' });

// Verify webhook signature
const isValid = client.webhooks.verify(
  rawBody,          // Raw request body string
  signature,        // x-agentpay-signature header
  webhookSecret,    // Your webhook secret
);
```

## Error Handling

```typescript
import { AgentPayError, RateLimitError } from '@agentpay/sdk-moltbook';

try {
  await client.payments.create({ amount: 100, recipientAddress: 'wallet' });
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log('Rate limited, retrying...');
  } else if (error instanceof AgentPayError) {
    console.log(`Error ${error.statusCode}: ${error.message}`);
  }
}
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | required | Your AgentPay API key |
| `environment` | `'production' \| 'sandbox'` | `'production'` | API environment |
| `baseUrl` | string | auto | Override API base URL |
| `maxRetries` | number | `3` | Max retry attempts |
