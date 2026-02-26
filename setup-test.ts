import { query } from './src/db/index';

async function createPayment() {
  const apiKey = "fab7f10718451780b16dc1429ac8329c6a7b0c31ecb9a891915b144f1a31bebb";
  
  console.log('💳 Sending Payment Request...');
  
  try {
    const res = await fetch('http://localhost:3000/api/payments', { 
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        amount_usdc: 5.0, 
        recipient_address: "H3wpDLwDiy1FGkqipAAV9cQajARvrHBW93qR72dLCvau", 
        description: "Test Payment" 
      })
    });

    const data = await res.json();
    console.log('\n✅ SUCCESS!');
    console.log('Transaction ID:', data.transactionId);
    console.log('Payment ID:', data.paymentId);
    console.log('\nRefresh your dashboard at http://localhost:3001 to see it!');
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

createPayment();