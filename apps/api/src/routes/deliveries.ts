import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { Channel } from '@hookline/mq';
import { prisma, DeliveryStatus } from '@hookline/db';
import { publishDelivery } from '@hookline/mq';
import { logger } from '@hookline/shared';

export const deliveryRoutes = (channel: Channel | null): FastifyPluginAsync => {
  return async (app) => {
    // List deliveries
    app.get<{
      Querystring: {
        status?: DeliveryStatus;
        endpointId?: string;
        limit?: string;
      };
    }>('/deliveries', async (req, reply) => {
      const tenant = req.tenant!;
      const { status, endpointId, limit } = req.query;

      const deliveries = await prisma.delivery.findMany({
        where: {
          tenantId: tenant.id,
          status: status ? status : undefined,
          endpointId: endpointId ? endpointId : undefined,
        },
        orderBy: { createdAt: 'desc' },
        take: limit ? Math.min(Number(limit), 100) : 50,
        include: {
          endpoint: { select: { id: true, url: true } },
          event: { select: { id: true, type: true } },
        },
      });

      return reply.send({ data: deliveries });
    });

    // Get delivery with attempts
    app.get<{ Params: { id: string } }>('/deliveries/:id', async (req, reply) => {
      const tenant = req.tenant!;
      const delivery = await prisma.delivery.findFirst({
        where: { id: req.params.id, tenantId: tenant.id },
        include: {
          attempts: { orderBy: { attemptNo: 'asc' } },
          endpoint: true,
          event: true,
        },
      });

      if (!delivery) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Delivery not found' },
        });
      }

      return reply.send(delivery);
    });

    // Manual retry of dead / failed delivery
    app.post<{ Params: { id: string } }>('/deliveries/:id/retry', async (req, reply) => {
      const tenant = req.tenant!;
      const { id } = req.params;

      const delivery = await prisma.delivery.findFirst({
        where: { id, tenantId: tenant.id },
      });

      if (!delivery) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Delivery not found' },
        });
      }

      // Reset delivery status
      const updated = await prisma.delivery.update({
        where: { id },
        data: {
          status: DeliveryStatus.pending,
          attemptCount: 0,
          lastError: null,
          nextAttemptAt: null,
          completedAt: null,
        },
      });

      // Re-publish to work queue
      if (channel) {
        publishDelivery(channel, updated.id);
      }

      logger.info({ deliveryId: updated.id, tenantId: tenant.id }, 'Manual retry triggered for delivery');

      return reply.send({
        success: true,
        message: 'Delivery re-enqueued for execution',
        deliveryId: updated.id,
      });
    });

    // POST /replay - creates new deliveries for matching events within [from, to]
    app.post<{
      Body: {
        endpointId: string;
        from: string;
        to: string;
        status?: 'dead' | 'all';
      };
    }>('/replay', async (req, reply) => {
      const tenant = req.tenant!;
      const { endpointId, from, to, status = 'all' } = req.body || {};

      if (!endpointId || !from || !to) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'endpointId, from, and to are required' },
        });
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.code(400).send({
          error: { code: 'INVALID_DATE', message: 'from and to must be valid ISO date strings' },
        });
      }

      const endpoint = await prisma.endpoint.findFirst({
        where: { id: endpointId, tenantId: tenant.id },
      });

      if (!endpoint) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
        });
      }

      const matchingEvents = await prisma.event.findMany({
        where: {
          tenantId: tenant.id,
          createdAt: {
            gte: fromDate,
            lte: toDate,
          },
          ...(status === 'dead'
            ? {
                deliveries: {
                  some: {
                    endpointId,
                    status: DeliveryStatus.dead,
                  },
                },
              }
            : {}),
        },
        select: { id: true },
        take: 500,
      });

      const replayId = randomUUID();

      const newDeliveries = await prisma.$transaction(async (tx) => {
        return await Promise.all(
          matchingEvents.map((evt) =>
            tx.delivery.create({
              data: {
                tenantId: tenant.id,
                eventId: evt.id,
                endpointId: endpoint.id,
                status: DeliveryStatus.pending,
              },
              select: { id: true },
            })
          )
        );
      });

      if (channel) {
        for (const d of newDeliveries) {
          publishDelivery(channel, d.id);
        }
      }

      logger.info(
        { replayId, count: newDeliveries.length, endpointId, tenantId: tenant.id },
        'Replay batch created and enqueued'
      );

      return reply.send({
        replayId,
        count: newDeliveries.length,
      });
    });

    // Stats overview
    app.get('/stats/overview', async (req, reply) => {
      const tenant = req.tenant!;

      const [totalEvents, totalDeliveries, succeeded, failed, pending, dead] = await Promise.all([
        prisma.event.count({ where: { tenantId: tenant.id } }),
        prisma.delivery.count({ where: { tenantId: tenant.id } }),
        prisma.delivery.count({ where: { tenantId: tenant.id, status: DeliveryStatus.succeeded } }),
        prisma.delivery.count({ where: { tenantId: tenant.id, status: DeliveryStatus.retrying } }),
        prisma.delivery.count({ where: { tenantId: tenant.id, status: DeliveryStatus.pending } }),
        prisma.delivery.count({ where: { tenantId: tenant.id, status: DeliveryStatus.dead } }),
      ]);

      const successRate = totalDeliveries > 0 ? (succeeded / totalDeliveries) * 100 : 100;

      return reply.send({
        totalEvents,
        totalDeliveries,
        succeeded,
        retrying: failed,
        pending,
        dead,
        successRate: Math.round(successRate * 100) / 100,
      });
    });
  };
};
