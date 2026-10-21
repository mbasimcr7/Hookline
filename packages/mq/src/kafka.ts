import { Kafka, type Producer, logLevel } from 'kafkajs';
export type { Producer };
import { logger } from '@hookline/shared';

export const TOPIC_EVENTS_RECEIVED = 'events.received';
export const TOPIC_DELIVERIES_ATTEMPTED = 'deliveries.attempted';
export const TOPIC_DELIVERIES_FINAL = 'deliveries.final';

export interface EventReceivedPayload {
  eventId: string;
  tenantId: string;
  type: string;
  deliveryIds: string[];
  ts: number;
}

export interface DeliveryAttemptedPayload {
  deliveryId: string;
  endpointId: string;
  attemptNo: number;
  status: string;
  durationMs: number;
  httpStatus: number | null;
  error?: string | null;
  ts: number;
}

export interface DeliveryFinalPayload {
  deliveryId: string;
  endpointId: string;
  finalStatus: string;
  attempts: number;
  ts: number;
}

export async function createKafkaProducer(
  brokers: string[],
  clientId = 'hookline-producer'
): Promise<Producer | null> {
  try {
    const kafka = new Kafka({
      clientId,
      brokers,
      logLevel: logLevel.ERROR,
      retry: {
        initialRetryTime: 300,
        retries: 3,
      },
    });

    const producer = kafka.producer();
    await producer.connect();
    logger.info({ brokers, clientId }, 'Connected to Kafka producer');
    return producer;
  } catch (err) {
    logger.warn({ err, brokers }, 'Could not connect to Kafka; running in degraded mode');
    return null;
  }
}

// F9: Kafka down -> best-effort logged failure, critical path continues
export async function emitEventReceived(
  producer: Producer | null,
  payload: EventReceivedPayload
): Promise<void> {
  if (!producer) return;
  try {
    await producer.send({
      topic: TOPIC_EVENTS_RECEIVED,
      messages: [
        {
          key: payload.tenantId,
          value: JSON.stringify(payload),
        },
      ],
    });
  } catch (err) {
    logger.warn({ err, eventId: payload.eventId }, 'Failed to emit events.received to Kafka (best-effort)');
  }
}

export async function emitDeliveryAttempted(
  producer: Producer | null,
  payload: DeliveryAttemptedPayload
): Promise<void> {
  if (!producer) return;
  try {
    await producer.send({
      topic: TOPIC_DELIVERIES_ATTEMPTED,
      messages: [
        {
          key: payload.endpointId,
          value: JSON.stringify(payload),
        },
      ],
    });
  } catch (err) {
    logger.warn({ err, deliveryId: payload.deliveryId }, 'Failed to emit deliveries.attempted to Kafka (best-effort)');
  }
}

export async function emitDeliveryFinal(
  producer: Producer | null,
  payload: DeliveryFinalPayload
): Promise<void> {
  if (!producer) return;
  try {
    await producer.send({
      topic: TOPIC_DELIVERIES_FINAL,
      messages: [
        {
          key: payload.endpointId,
          value: JSON.stringify(payload),
        },
      ],
    });
  } catch (err) {
    logger.warn({ err, deliveryId: payload.deliveryId }, 'Failed to emit deliveries.final to Kafka (best-effort)');
  }
}
