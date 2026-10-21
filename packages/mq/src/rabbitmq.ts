import amqp, { type Channel, type ChannelModel } from 'amqplib';
export type { Channel, ChannelModel };
import { logger } from '@hookline/shared';

export const EXCHANGE_DELIVERY = 'delivery';
export const QUEUE_WORK = 'delivery.work';
export const QUEUE_DLQ = 'delivery.dlq';
export const ROUTING_WORK = 'work';
export const ROUTING_DLQ = 'dlq';

export interface RetryTierConfig {
  tier: number;
  baseTtlMs: number;
}

export const RETRY_TIERS: RetryTierConfig[] = [
  { tier: 1, baseTtlMs: 5_000 },       // 5 seconds
  { tier: 2, baseTtlMs: 30_000 },      // 30 seconds
  { tier: 3, baseTtlMs: 120_000 },     // 2 minutes
  { tier: 4, baseTtlMs: 600_000 },     // 10 minutes
  { tier: 5, baseTtlMs: 3_600_000 },   // 1 hour
];

export async function setupRabbitMQTopology(
  channel: Channel,
  retryScale = 1
): Promise<void> {
  logger.info({ retryScale }, 'Configuring RabbitMQ exchanges and queues');

  // 1. Declare main direct exchange
  await channel.assertExchange(EXCHANGE_DELIVERY, 'direct', { durable: true });

  // 2. Declare primary work queue
  await channel.assertQueue(QUEUE_WORK, { durable: true });
  await channel.bindQueue(QUEUE_WORK, EXCHANGE_DELIVERY, ROUTING_WORK);

  // 3. Declare dead letter queue
  await channel.assertQueue(QUEUE_DLQ, { durable: true });
  await channel.bindQueue(QUEUE_DLQ, EXCHANGE_DELIVERY, ROUTING_DLQ);

  // 4. Declare retry tier queues with DLX back to work queue
  for (const tier of RETRY_TIERS) {
    const queueName = `delivery.retry.${tier.tier}`;
    const routingKey = `retry.${tier.tier}`;
    const actualTtl = Math.max(100, Math.floor(tier.baseTtlMs * retryScale));

    await channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-message-ttl': actualTtl,
        'x-dead-letter-exchange': EXCHANGE_DELIVERY,
        'x-dead-letter-routing-key': ROUTING_WORK,
      },
    });

    await channel.bindQueue(queueName, EXCHANGE_DELIVERY, routingKey);
    logger.debug({ queueName, ttl: actualTtl }, 'Declared retry tier queue');
  }

  logger.info('RabbitMQ topology successfully initialized');
}

export async function connectRabbitMQ(url: string, retryScale = 1): Promise<{
  connection: ChannelModel;
  channel: Channel;
}> {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  await setupRabbitMQTopology(channel, retryScale);
  return { connection, channel };
}

export function publishDelivery(channel: Channel, deliveryId: string): boolean {
  const msg = Buffer.from(JSON.stringify({ deliveryId }));
  return channel.publish(EXCHANGE_DELIVERY, ROUTING_WORK, msg, {
    persistent: true,
    contentType: 'application/json',
  });
}

export function publishRetry(
  channel: Channel,
  deliveryId: string,
  attemptCount: number
): boolean {
  const tierIndex = Math.min(attemptCount, RETRY_TIERS.length);
  const routingKey = `retry.${tierIndex}`;
  const msg = Buffer.from(JSON.stringify({ deliveryId }));
  return channel.publish(EXCHANGE_DELIVERY, routingKey, msg, {
    persistent: true,
    contentType: 'application/json',
  });
}

export function publishDlq(channel: Channel, deliveryId: string): boolean {
  const msg = Buffer.from(JSON.stringify({ deliveryId }));
  return channel.publish(EXCHANGE_DELIVERY, ROUTING_DLQ, msg, {
    persistent: true,
    contentType: 'application/json',
  });
}
