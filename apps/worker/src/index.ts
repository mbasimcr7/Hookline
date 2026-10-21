import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { connectRabbitMQ, QUEUE_WORK, createKafkaProducer, type Producer, type Channel } from '@hookline/mq';
import { config, logger } from '@hookline/shared';
import { processDelivery } from './delivery.js';
import { startReconciler } from './reconciler.js';

const workerId = `worker-${randomUUID().substring(0, 8)}`;

async function bootstrap() {
  logger.info({ workerId }, 'Starting Hookline delivery worker');

  // Connect RabbitMQ with retry loop
  let rabbitChannel: Channel | null = null;
  while (!rabbitChannel) {
    try {
      const { channel } = await connectRabbitMQ(config.RABBITMQ_URL, config.RETRY_SCALE);
      rabbitChannel = channel;
    } catch (err) {
      logger.warn({ err }, 'RabbitMQ not ready yet, retrying in 3s...');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const channel = rabbitChannel;
  await channel.prefetch(config.WORKER_PREFETCH);

  // Connect Redis
  let redis: Redis | null = null;
  try {
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy: () => 2000,
      lazyConnect: true,
    });
    await redis.connect();
    logger.info('Worker connected to Redis');
  } catch (err) {
    logger.warn({ err }, 'Worker running without Redis lock layer');
    redis = null;
  }

  // Connect Kafka
  let kafkaProducer: Producer | null = null;
  try {
    const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());
    kafkaProducer = await createKafkaProducer(brokers, `worker-${workerId}`);
  } catch (err) {
    logger.warn({ err }, 'Worker running without Kafka producer');
    kafkaProducer = null;
  }

  // Start reconciler
  startReconciler(channel);

  // Consume from primary work queue
  logger.info({ queue: QUEUE_WORK, prefetch: config.WORKER_PREFETCH }, 'Subscribing to delivery work queue');

  await channel.consume(
    QUEUE_WORK,
    async (msg) => {
      if (!msg) return;

      try {
        const content = JSON.parse(msg.content.toString());
        const deliveryId = content.deliveryId;

        if (!deliveryId) {
          logger.warn({ content }, 'Malformed message missing deliveryId; acknowledging and dropping');
          channel.ack(msg);
          return;
        }

        await processDelivery(channel, redis, kafkaProducer, workerId, deliveryId);
        channel.ack(msg);
      } catch (err) {
        logger.error({ err }, 'Unhandled error processing delivery work item');
        // Nack without requeue or ack to avoid crash-looping if unhandled
        channel.nack(msg, false, false);
      }
    },
    { noAck: false }
  );

  logger.info('Hookline worker is actively listening for jobs');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal worker failure');
  process.exit(1);
});
