import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Channel } from '@hookline/mq';
import type { Redis } from 'ioredis';
import { prisma, EndpointStatus, DeliveryStatus } from '@hookline/db';
import { publishDelivery, checkRateLimit, emitEventReceived, type Producer } from '@hookline/mq';
import { logger, config } from '@hookline/shared';

const createEventSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()),
});

export const eventRoutes = (
  channel: Channel | null,
  redis: Redis | null,
  kafkaProducer: Producer | null = null
): FastifyPluginAsync => {
  return async (app) => {
    app.post('/events', async (req, reply) => {
      const tenant = req.tenant!;

      // 0. Rate limiting (token bucket)
      const rateCheck = await checkRateLimit(
        redis,
        tenant.id,
        config.RATE_LIMIT_BURST,
        config.RATE_LIMIT_RPS
      );
      if (!rateCheck.allowed) {
        reply.header('Retry-After', String(rateCheck.retryAfter));
        return reply.code(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests; rate limit exceeded',
            retryAfter: rateCheck.retryAfter,
          },
        });
      }

      const idempotencyKey = (req.headers['idempotency-key'] as string) || null;

      const parseResult = createEventSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parseResult.error.format() },
        });
      }

      const { type, payload } = parseResult.data;

      // 1. Idempotency fast check in Redis
      if (idempotencyKey && redis) {
        try {
          const cached = await redis.get(`idem:${tenant.id}:${idempotencyKey}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            logger.info({ tenantId: tenant.id, idempotencyKey }, 'Idempotency key hit (Redis cache)');
            return reply.code(200).send(parsed);
          }
        } catch (err) {
          logger.warn({ err }, 'Redis idempotency read failed; falling back to DB constraint');
        }
      }

      // Check DB directly if idempotencyKey was provided
      if (idempotencyKey) {
        const existingEvent = await prisma.event.findUnique({
          where: {
            tenantId_idempotencyKey: {
              tenantId: tenant.id,
              idempotencyKey,
            },
          },
          include: {
            deliveries: {
              select: { id: true, endpointId: true },
            },
          },
        });

        if (existingEvent) {
          logger.info({ tenantId: tenant.id, idempotencyKey }, 'Idempotency key hit (Postgres)');
          const responseBody = {
            eventId: existingEvent.id,
            deliveries: existingEvent.deliveries,
          };
          return reply.code(200).send(responseBody);
        }
      }

      // 2. Find matching active endpoints
      const endpoints = await prisma.endpoint.findMany({
        where: {
          tenantId: tenant.id,
          status: EndpointStatus.active,
        },
      });

      const matchingEndpoints = endpoints.filter(
        (ep) => ep.eventTypes.length === 0 || ep.eventTypes.includes(type)
      );

      // 3. Single transaction for Event + Deliveries
      try {
        const result = await prisma.$transaction(async (tx) => {
          const event = await tx.event.create({
            data: {
              tenantId: tenant.id,
              type,
              payload: payload as object,
              idempotencyKey,
            },
          });

          const deliveries = await Promise.all(
            matchingEndpoints.map((ep) =>
              tx.delivery.create({
                data: {
                  tenantId: tenant.id,
                  eventId: event.id,
                  endpointId: ep.id,
                  status: DeliveryStatus.pending,
                },
                select: {
                  id: true,
                  endpointId: true,
                },
              })
            )
          );

          return { event, deliveries };
        });

        // 4. Publish to RabbitMQ work queue
        if (channel) {
          for (const delivery of result.deliveries) {
            try {
              publishDelivery(channel, delivery.id);
            } catch (err) {
              logger.error({ deliveryId: delivery.id, err }, 'Failed to publish delivery to RabbitMQ');
            }
          }
        }

        // 5. Emit to Kafka events.received topic
        emitEventReceived(kafkaProducer, {
          eventId: result.event.id,
          tenantId: tenant.id,
          type: result.event.type,
          deliveryIds: result.deliveries.map((d) => d.id),
          ts: Date.now(),
        }).catch(() => {});

        const responsePayload = {
          eventId: result.event.id,
          deliveries: result.deliveries,
        };

        // Cache in Redis for idempotency (24h)
        if (idempotencyKey && redis) {
          try {
            await redis.set(`idem:${tenant.id}:${idempotencyKey}`, JSON.stringify(responsePayload), 'EX', 86400);
          } catch (err) {
            logger.warn({ err }, 'Failed to cache idempotency key in Redis');
          }
        }

        logger.info(
          { eventId: result.event.id, deliveryCount: result.deliveries.length },
          'Event ingested and deliveries scheduled'
        );

        return reply.code(202).send(responsePayload);
      } catch (error: unknown) {
        // Handle race-condition duplicate idempotency key via Postgres unique constraint
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2002'
        ) {
          const existingEvent = await prisma.event.findUnique({
            where: {
              tenantId_idempotencyKey: {
                tenantId: tenant.id,
                idempotencyKey: idempotencyKey!,
              },
            },
            include: {
              deliveries: { select: { id: true, endpointId: true } },
            },
          });
          if (existingEvent) {
            return reply.code(200).send({
              eventId: existingEvent.id,
              deliveries: existingEvent.deliveries,
            });
          }
        }

        logger.error({ error }, 'Failed to ingest event');
        return reply.code(500).send({
          error: { code: 'INTERNAL_ERROR', message: 'Failed to process event' },
        });
      }
    });

    // List events
    app.get('/events', async (req, reply) => {
      const tenant = req.tenant!;
      const events = await prisma.event.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          deliveries: {
            select: { id: true, endpointId: true, status: true, attemptCount: true },
          },
        },
      });
      return reply.send({ data: events });
    });

    // Get event detail
    app.get<{ Params: { id: string } }>('/events/:id', async (req, reply) => {
      const tenant = req.tenant!;
      const event = await prisma.event.findFirst({
        where: { id: req.params.id, tenantId: tenant.id },
        include: { deliveries: true },
      });
      if (!event) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Event not found' } });
      }
      return reply.send(event);
    });
  };
};
