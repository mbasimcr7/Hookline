const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'whk_Z7-6dPUmra3uYdEmc6q6gdOkgx7_mXWC';

const EVENT_TYPES = [
  'payment.succeeded',
  'order.created',
  'invoice.paid',
  'customer.subscription_updated',
  'refund.processed',
];

async function sendDemoEvent() {
  const type = process.argv[2] || EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
  const orderId = `ord_${Math.floor(1000 + Math.random() * 9000)}`;
  const amount = Math.floor(1000 + Math.random() * 25000);

  const payload = {
    type,
    payload: {
      orderId,
      amount,
      currency: 'USD',
      customer: {
        id: `cust_${Math.floor(100 + Math.random() * 900)}`,
        email: `customer${Math.floor(Math.random() * 100)}@example.com`,
      },
      metadata: {
        source: 'interactive_demo',
        ip: '198.51.100.42',
      },
      timestamp: Date.now(),
    },
  };

  console.log(`\n🚀 Ingesting webhook event "${type}" to Hookline API (:3000)...`);
  const res = await fetch(`${API_URL}/v1/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      'Idempotency-Key': `demo_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json();
  if (res.ok) {
    console.log('✅ Event successfully ingested!');
    console.log(`   Event ID:    ${body.eventId}`);
    console.log(`   Delivery ID: ${body.deliveries?.[0]?.id}`);
    console.log(`   Endpoint:    ${body.deliveries?.[0]?.endpointId}`);
    console.log('\n👀 Now watch your Dashboard at http://localhost:3001 to see the live SSE feed!\n');
  } else {
    console.error(`❌ Ingestion rejected (${res.status}):`, body);
  }
}

sendDemoEvent().catch(console.error);
