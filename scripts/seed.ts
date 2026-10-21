import { prisma, EndpointStatus } from '@hookline/db';
import { generateApiKey } from '@hookline/shared';

async function seed() {
  console.log('Seeding initial demo tenant and endpoint...');

  // 1. Create or find demo tenant
  let tenant = await prisma.tenant.findFirst({
    where: { name: 'Demo Tenant' },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Demo Tenant',
      },
    });
    console.log(`Created tenant: ${tenant.name} (${tenant.id})`);
  } else {
    console.log(`Using existing tenant: ${tenant.name} (${tenant.id})`);
  }

  // 2. Generate API Key
  const { rawKey, keyHash, prefix } = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      keyHash,
      prefix,
    },
  });

  // 3. Create or update Default Receiver Endpoint
  const receiverUrl = process.env.RECEIVER_URL || 'http://localhost:4000/hook';
  const secret = process.env.RECEIVER_SECRET || 'whsec_demo_secret';

  let endpoint = await prisma.endpoint.findFirst({
    where: { tenantId: tenant.id, url: receiverUrl },
  });

  if (!endpoint) {
    endpoint = await prisma.endpoint.create({
      data: {
        tenantId: tenant.id,
        url: receiverUrl,
        secret,
        eventTypes: [], // all events
        status: EndpointStatus.active,
      },
    });
    console.log(`Created default receiver endpoint: ${endpoint.url} (${endpoint.id})`);
  } else {
    console.log(`Default endpoint already exists: ${endpoint.url} (${endpoint.id})`);
  }

  console.log('\n======================================================');
  console.log('             HOOKLINE SEED COMPLETED                   ');
  console.log('======================================================');
  console.log(`Tenant ID:       ${tenant.id}`);
  console.log(`API Key (RAW):   ${rawKey}`);
  console.log(`Endpoint ID:     ${endpoint.id}`);
  console.log(`Endpoint URL:    ${endpoint.url}`);
  console.log(`Endpoint Secret: ${endpoint.secret}`);
  console.log('======================================================');
  console.log('Save the API Key! It will not be shown again.\n');
  console.log('Example curl command:');
  console.log(`curl -X POST http://localhost:3000/v1/events \\
  -H "Authorization: Bearer ${rawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"type": "payment.succeeded", "payload": {"amount": 5000, "currency": "usd"}}'
`);
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
