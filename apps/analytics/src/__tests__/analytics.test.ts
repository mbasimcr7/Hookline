import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, EndpointStatus } from '@hookline/db';
import { processDeliveryAttempt, CONSUMER_GROUP } from '../consumer.js';

describe('Analytics Consumer Idempotency', () => {
  let tenantId: string;
  let endpointId: string;

  beforeAll(async () => {
    // Create test tenant and endpoint
    const tenant = await prisma.tenant.create({
      data: { name: `Analytics-Test-Tenant-${Date.now()}` },
    });
    tenantId = tenant.id;

    const endpoint = await prisma.endpoint.create({
      data: {
        tenantId,
        url: 'http://localhost:4000/hook',
        secret: 'whsec_test',
        status: EndpointStatus.active,
      },
    });
    endpointId = endpoint.id;
  });

  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it('should process delivery attempt and record stats in endpoint_stats_minute', async () => {
    const topic = 'deliveries.attempted';
    const partition = 0;
    const offset = String(Date.now());
    const ts = Date.now();
    const bucket = new Date(Math.floor(ts / 60000) * 60000);

    const payload = {
      deliveryId: 'test-del-1',
      endpointId,
      attemptNo: 1,
      status: 'succeeded',
      durationMs: 45,
      httpStatus: 200,
      ts,
    };

    // 1. First process: should insert
    await processDeliveryAttempt(topic, partition, offset, payload);

    const stat = await prisma.endpointStatsMinute.findUnique({
      where: { endpointId_bucket: { endpointId, bucket } },
    });

    expect(stat).not.toBeNull();
    expect(stat?.attempts).toBe(1);
    expect(stat?.successes).toBe(1);
    expect(stat?.failures).toBe(0);

    // 2. Second process with SAME offset (simulating redelivery/restart F11): MUST be idempotent
    await processDeliveryAttempt(topic, partition, offset, payload);

    const statAfter = await prisma.endpointStatsMinute.findUnique({
      where: { endpointId_bucket: { endpointId, bucket } },
    });

    // Counts MUST remain exactly 1 (no double counting)
    expect(statAfter?.attempts).toBe(1);
    expect(statAfter?.successes).toBe(1);
  });
});
