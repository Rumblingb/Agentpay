/*
Example: createPayment() -> verifyPayment()
Run this locally against the API Edge worker or Express backend.
Set these env vars or replace inline:
  - API_BASE (e.g. http://localhost:3000)
  - API_KEY  (merchant API key)
*/

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const API_KEY = process.env.API_KEY ?? 'REPLACE_WITH_API_KEY';

async function createPayment(amount) {
  const res = await fetch(`${API_BASE}/api/merchants/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ amountUsdc: amount, recipientAddress: 'recipient-wallet-address' }),
  });
  return res.json();
}

async function verifyPayment(transactionId, txHash) {
  const res = await fetch(`${API_BASE}/api/merchants/payments/${transactionId}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ txHash }),
  });
  return res.json();
}

async function main() {
  console.log('[example] creating payment');
  const created = await createPayment(1.5);
  console.log('created:', created);

  const txId = created.transactionId;
  console.log('[example] simulate on-chain settlement and then verify');

  // In real flow, you'd now send USDC on-chain; here we just call verify
  const verification = await verifyPayment(txId, process.env.TX_HASH ?? 'simulated-tx-hash-1234');
  console.log('verification:', verification);
}

if (require.main === module) {
  main().catch((err) => console.error(err));
}
