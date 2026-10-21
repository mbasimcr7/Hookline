import type { Redis } from 'ioredis';
import { logger } from '@hookline/shared';

export interface DeliveryUpdateMessage {
  type: 'delivery.updated';
  deliveryId: string;
  eventId: string;
  endpointId: string;
  tenantId: string;
  status: string;
  attemptNo: number;
  error?: string | null;
  timestamp: number;
}

export async function publishDeliveryUpdate(
  redis: Redis | null,
  tenantId: string,
  event: DeliveryUpdateMessage
): Promise<void> {
  if (!redis) return;

  const channel = `ch:tenant:${tenantId}`;
  try {
    await redis.publish(channel, JSON.stringify(event));
  } catch (err) {
    logger.warn({ err, tenantId, deliveryId: event.deliveryId }, 'Failed to publish delivery update to Redis pub/sub');
  }
}
