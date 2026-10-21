import { request as undiciRequest } from 'undici';
import type { Channel } from '@hookline/mq';
import type { Redis } from 'ioredis';
import { prisma, DeliveryStatus } from '@hookline/db';
import {
  publishRetry,
  publishDlq,
  checkCircuitBreaker,
  recordCircuitSuccess,
  recordCircuitFailure,
  publishDeliveryUpdate,
  emitDeliveryAttempted,
  emitDeliveryFinal,
  type Producer,
} from '@hookline/mq';
import {
  signWebhookPayload,
  config,
  logger,
  type WebhookOutboundPayload,
} from '@hookline/shared';

export async function processDelivery(
  channel: Channel,
  redis: Redis | null,
  kafkaProducer: Producer | null,
  workerId: string,
  deliveryId: string
): Promise<void> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      endpoint: true,
      event: true,
    },
  });

  // Poison message or already succeeded
  if (!delivery) {
    logger.warn({ deliveryId }, 'Delivery row not found in database; dropping message');
    return;
  }

  if (delivery.status === DeliveryStatus.succeeded) {
    logger.info({ deliveryId }, 'Delivery already succeeded; skipping duplicate');
    return;
  }

  // 1. In-flight lock in Redis (30s)
  const lockKey = `lock:delivery:${deliveryId}`;
  let lockAcquired = true;
  if (redis) {
    try {
      const lockResult = await redis.set(lockKey, workerId, 'EX', 30, 'NX');
      if (!lockResult) {
        logger.warn({ deliveryId }, 'Delivery locked by another worker; dropping duplicate invocation');
        return;
      }
    } catch (err) {
      logger.warn({ err, deliveryId }, 'Failed to check Redis lock; proceeding');
    }
  }

  const startedAt = new Date();

  // 2. Circuit Breaker check
  const circuitCheck = await checkCircuitBreaker(redis, delivery.endpoint.id);
  if (!circuitCheck.allowExecution) {
    logger.warn(
      { deliveryId, endpointId: delivery.endpoint.id, state: circuitCheck.state },
      'Endpoint circuit breaker is open; skipping HTTP call'
    );

    // Record attempt without burning max attempt retries
    await prisma.deliveryAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNo: delivery.attemptCount + 1,
        startedAt,
        durationMs: 0,
        responseStatus: null,
        responseSnippet: null,
        error: `Circuit breaker is ${circuitCheck.state}`,
        circuitSkipped: true,
      },
    });

    // Mark retrying & schedule to next retry tier
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        status: DeliveryStatus.retrying,
        lastError: `Circuit breaker is ${circuitCheck.state}`,
      },
    });

    const tier = Math.min(Math.max(1, delivery.attemptCount + 1), 5);
    publishRetry(channel, delivery.id, tier);

    await publishDeliveryUpdate(redis, delivery.tenantId, {
      type: 'delivery.updated',
      deliveryId: delivery.id,
      eventId: delivery.event.id,
      endpointId: delivery.endpoint.id,
      tenantId: delivery.tenantId,
      status: DeliveryStatus.retrying,
      attemptNo: delivery.attemptCount,
      error: `Circuit breaker is ${circuitCheck.state}`,
      timestamp: Date.now(),
    });

    // Release lock
    if (redis && lockAcquired) {
      await redis.del(lockKey).catch(() => {});
    }
    return;
  }

  const attemptNo = delivery.attemptCount + 1;

  // Mark in-flight
  await prisma.delivery.update({
    where: { id: deliveryId },
    data: {
      status: DeliveryStatus.in_flight,
      attemptCount: attemptNo,
    },
  });

  await publishDeliveryUpdate(redis, delivery.tenantId, {
    type: 'delivery.updated',
    deliveryId: delivery.id,
    eventId: delivery.event.id,
    endpointId: delivery.endpoint.id,
    tenantId: delivery.tenantId,
    status: DeliveryStatus.in_flight,
    attemptNo,
    error: null,
    timestamp: Date.now(),
  });

  // Prepare outbound payload and signature
  const timestamp = Math.floor(startedAt.getTime() / 1000);
  const outboundBody: WebhookOutboundPayload = {
    id: delivery.event.id,
    type: delivery.event.type,
    createdAt: delivery.event.createdAt.toISOString(),
    data: delivery.event.payload,
  };
  const rawBody = JSON.stringify(outboundBody);
  const signature = signWebhookPayload(delivery.endpoint.secret, timestamp, rawBody);

  let responseStatus: number | null = null;
  let responseSnippet: string | null = null;
  let deliveryError: string | null = null;
  let success = false;

  const timerStart = Date.now();

  try {
    const res = await undiciRequest(delivery.endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hookline-delivery-id': delivery.id,
        'x-hookline-event-id': delivery.event.id,
        'x-hookline-event-type': delivery.event.type,
        'x-hookline-attempt': String(attemptNo),
        'x-hookline-timestamp': String(timestamp),
        'x-hookline-signature': signature,
      },
      body: rawBody,
      headersTimeout: config.DELIVERY_TIMEOUT_MS,
      bodyTimeout: config.DELIVERY_TIMEOUT_MS,
    });

    responseStatus = res.statusCode;
    const responseText = await res.body.text();
    responseSnippet = responseText.substring(0, 1024); // Cap at 1KB

    if (res.statusCode >= 200 && res.statusCode < 300) {
      success = true;
    } else {
      deliveryError = `HTTP ${res.statusCode}: ${responseSnippet}`;
    }
  } catch (err: unknown) {
    deliveryError = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - timerStart;

  // Record attempt
  await prisma.deliveryAttempt.create({
    data: {
      deliveryId: delivery.id,
      attemptNo,
      startedAt,
      durationMs,
      responseStatus,
      responseSnippet,
      error: deliveryError,
      circuitSkipped: false,
    },
  });

  // Emit Kafka event: deliveries.attempted
  await emitDeliveryAttempted(kafkaProducer, {
    deliveryId: delivery.id,
    endpointId: delivery.endpoint.id,
    attemptNo,
    status: success ? 'succeeded' : 'failed',
    durationMs,
    httpStatus: responseStatus,
    error: deliveryError,
    ts: Date.now(),
  });

  // Handle outcome
  if (success) {
    await recordCircuitSuccess(redis, delivery.endpoint.id);

    await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        status: DeliveryStatus.succeeded,
        completedAt: new Date(),
        lastError: null,
      },
    });

    await emitDeliveryFinal(kafkaProducer, {
      deliveryId: delivery.id,
      endpointId: delivery.endpoint.id,
      finalStatus: 'succeeded',
      attempts: attemptNo,
      ts: Date.now(),
    });

    await publishDeliveryUpdate(redis, delivery.tenantId, {
      type: 'delivery.updated',
      deliveryId: delivery.id,
      eventId: delivery.event.id,
      endpointId: delivery.endpoint.id,
      tenantId: delivery.tenantId,
      status: DeliveryStatus.succeeded,
      attemptNo,
      error: null,
      timestamp: Date.now(),
    });

    logger.info(
      { deliveryId, attemptNo, durationMs, status: responseStatus },
      'Delivery succeeded'
    );
  } else {
    await recordCircuitFailure(
      redis,
      delivery.endpoint.id,
      config.CB_FAILURE_THRESHOLD,
      config.CB_OPEN_SECONDS
    );

    logger.warn(
      { deliveryId, attemptNo, durationMs, error: deliveryError },
      'Delivery attempt failed'
    );

    if (attemptNo < config.MAX_ATTEMPTS) {
      // Route to next retry tier queue
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: DeliveryStatus.retrying,
          lastError: deliveryError,
        },
      });
      publishRetry(channel, delivery.id, attemptNo);

      await publishDeliveryUpdate(redis, delivery.tenantId, {
        type: 'delivery.updated',
        deliveryId: delivery.id,
        eventId: delivery.event.id,
        endpointId: delivery.endpoint.id,
        tenantId: delivery.tenantId,
        status: DeliveryStatus.retrying,
        attemptNo,
        error: deliveryError,
        timestamp: Date.now(),
      });

      logger.info({ deliveryId, attemptNo, nextTier: attemptNo }, 'Scheduled next retry tier');
    } else {
      // Max attempts exhausted -> route to DLQ
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: DeliveryStatus.dead,
          completedAt: new Date(),
          lastError: deliveryError,
        },
      });
      publishDlq(channel, delivery.id);

      await emitDeliveryFinal(kafkaProducer, {
        deliveryId: delivery.id,
        endpointId: delivery.endpoint.id,
        finalStatus: 'dead',
        attempts: attemptNo,
        ts: Date.now(),
      });

      await publishDeliveryUpdate(redis, delivery.tenantId, {
        type: 'delivery.updated',
        deliveryId: delivery.id,
        eventId: delivery.event.id,
        endpointId: delivery.endpoint.id,
        tenantId: delivery.tenantId,
        status: DeliveryStatus.dead,
        attemptNo,
        error: deliveryError,
        timestamp: Date.now(),
      });

      logger.error({ deliveryId, attemptNo }, 'Delivery exhausted all retries; sent to DLQ');
    }
  }

  // Release lock
  if (redis && lockAcquired) {
    try {
      await redis.del(lockKey);
    } catch {
      // Ignore error on lock release
    }
  }
}
