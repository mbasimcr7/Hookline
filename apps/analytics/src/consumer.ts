import { Kafka, logLevel, type EachMessagePayload } from 'kafkajs';
import { prisma } from '@hookline/db';
import { TOPIC_DELIVERIES_ATTEMPTED } from '@hookline/mq';
import { logger } from '@hookline/shared';

export const CONSUMER_GROUP = 'analytics-v1';

export interface DeliveryAttemptMessage {
  deliveryId: string;
  endpointId: string;
  attemptNo: number;
  status: string;
  durationMs: number;
  httpStatus: number | null;
  error?: string | null;
  ts: number;
}

export async function processDeliveryAttempt(
  topic: string,
  partition: number,
  offset: string,
  payload: DeliveryAttemptMessage
): Promise<void> {
  const { endpointId, durationMs, httpStatus, ts } = payload;
  const isSuccess = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
  const bucket = new Date(Math.floor(ts / 60000) * 60000); // 1-minute bucket timestamp
  const offsetBigInt = BigInt(offset);

  // Single Postgres transaction guarantees idempotent consumer processing
  await prisma.$transaction(async (tx: any) => {
    // 1. Check idempotency in kafka_processed
    const alreadyProcessed = await tx.kafkaProcessed.findUnique({
      where: {
        consumer_topic_partition_offset: {
          consumer: CONSUMER_GROUP,
          topic,
          partition,
          offset: offsetBigInt,
        },
      },
    });

    if (alreadyProcessed) {
      logger.debug({ topic, partition, offset }, 'Kafka message already processed; skipping');
      return;
    }

    // 2. Upsert endpoint_stats_minute
    await tx.$executeRaw`
      INSERT INTO endpoint_stats_minute (endpoint_id, bucket, attempts, successes, failures, latency_sum_ms, latency_max_ms)
      VALUES (${endpointId}::uuid, ${bucket}, 1, ${isSuccess ? 1 : 0}, ${isSuccess ? 0 : 1}, ${durationMs}, ${durationMs})
      ON CONFLICT (endpoint_id, bucket)
      DO UPDATE SET
        attempts = endpoint_stats_minute.attempts + 1,
        successes = endpoint_stats_minute.successes + ${isSuccess ? 1 : 0},
        failures = endpoint_stats_minute.failures + ${isSuccess ? 0 : 1},
        latency_sum_ms = endpoint_stats_minute.latency_sum_ms + ${durationMs},
        latency_max_ms = GREATEST(endpoint_stats_minute.latency_max_ms, ${durationMs});
    `;

    // 3. Record offset in kafka_processed
    await tx.kafkaProcessed.create({
      data: {
        consumer: CONSUMER_GROUP,
        topic,
        partition,
        offset: offsetBigInt,
      },
    });
  });

  logger.debug(
    { endpointId, bucket: bucket.toISOString(), durationMs, isSuccess },
    'Processed analytics attempt into endpoint_stats_minute'
  );
}

export async function startAnalyticsConsumer(brokers: string[]): Promise<() => Promise<void>> {
  const kafka = new Kafka({
    clientId: 'hookline-analytics',
    brokers,
    logLevel: logLevel.ERROR,
    retry: {
      initialRetryTime: 1000,
      retries: 25,
    },
  });

  const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC_DELIVERIES_ATTEMPTED, fromBeginning: false });

  logger.info({ topic: TOPIC_DELIVERIES_ATTEMPTED, group: CONSUMER_GROUP }, 'Analytics Kafka consumer started');

  await consumer.run({
    autoCommit: true,
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      if (!message.value) return;
      try {
        const payload = JSON.parse(message.value.toString()) as DeliveryAttemptMessage;
        await processDeliveryAttempt(topic, partition, message.offset, payload);
      } catch (err) {
        logger.error({ err, topic, partition, offset: message.offset }, 'Error processing analytics Kafka message');
      }
    },
  });

  return async () => {
    await consumer.disconnect();
    logger.info('Analytics Kafka consumer disconnected');
  };
}
