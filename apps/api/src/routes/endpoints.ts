import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma, EndpointStatus } from '@hookline/db';
import { generateEndpointSecret, validateEndpointUrl, config, logger } from '@hookline/shared';

const createEndpointSchema = z.object({
  url: z.string().url(),
  eventTypes: z.array(z.string()).optional().default([]),
});

const updateEndpointSchema = z.object({
  url: z.string().url().optional(),
  eventTypes: z.array(z.string()).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const endpointRoutes: FastifyPluginAsync = async (app) => {
  // Create endpoint
  app.post('/endpoints', async (req, reply) => {
    const tenant = req.tenant!;
    const parseResult = createEndpointSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parseResult.error.format() },
      });
    }

    const { url, eventTypes } = parseResult.data;
    const isUrlSafe = await validateEndpointUrl(url, config.ALLOW_PRIVATE_URLS);
    if (!isUrlSafe) {
      return reply.code(400).send({
        error: { code: 'INVALID_URL', message: 'Endpoint URL rejected by SSRF guard' },
      });
    }

    const secret = generateEndpointSecret();

    const endpoint = await prisma.endpoint.create({
      data: {
        tenantId: tenant.id,
        url,
        secret,
        eventTypes,
        status: EndpointStatus.active,
      },
    });

    logger.info({ endpointId: endpoint.id, tenantId: tenant.id }, 'Endpoint registered');
    return reply.code(201).send(endpoint);
  });

  // List endpoints
  app.get('/endpoints', async (req, reply) => {
    const tenant = req.tenant!;
    const endpoints = await prisma.endpoint.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        tenantId: true,
        url: true,
        eventTypes: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ data: endpoints });
  });

  // Get endpoint detail
  app.get<{ Params: { id: string } }>('/endpoints/:id', async (req, reply) => {
    const tenant = req.tenant!;
    const { id } = req.params;

    const endpoint = await prisma.endpoint.findFirst({
      where: { id, tenantId: tenant.id },
      select: {
        id: true,
        tenantId: true,
        url: true,
        eventTypes: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!endpoint) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
      });
    }

    return reply.send(endpoint);
  });

  // Update endpoint
  app.patch<{ Params: { id: string } }>('/endpoints/:id', async (req, reply) => {
    const tenant = req.tenant!;
    const { id } = req.params;

    const parseResult = updateEndpointSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parseResult.error.format() },
      });
    }

    const { url, eventTypes, status } = parseResult.data;
    if (url) {
      const isUrlSafe = await validateEndpointUrl(url, config.ALLOW_PRIVATE_URLS);
      if (!isUrlSafe) {
        return reply.code(400).send({
          error: { code: 'INVALID_URL', message: 'Endpoint URL rejected by SSRF guard' },
        });
      }
    }

    try {
      const updated = await prisma.endpoint.update({
        where: { id, tenantId: tenant.id },
        data: {
          url: url ?? undefined,
          eventTypes: eventTypes ?? undefined,
          status: status ? (status as EndpointStatus) : undefined,
        },
      });

      return reply.send(updated);
    } catch {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
      });
    }
  });

  // Delete (soft disable)
  app.delete<{ Params: { id: string } }>('/endpoints/:id', async (req, reply) => {
    const tenant = req.tenant!;
    const { id } = req.params;

    try {
      await prisma.endpoint.update({
        where: { id, tenantId: tenant.id },
        data: { status: EndpointStatus.disabled },
      });
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
      });
    }
  });

  // GET /endpoints/:id/stats - Time-series aggregates from endpoint_stats_minute
  app.get<{
    Params: { id: string };
    Querystring: { window?: string };
  }>('/endpoints/:id/stats', async (req, reply) => {
    const tenant = req.tenant!;
    const { id } = req.params;
    const window = req.query.window || '1h';

    const endpoint = await prisma.endpoint.findFirst({
      where: { id, tenantId: tenant.id },
    });

    if (!endpoint) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
      });
    }

    let minutes = 60;
    if (window === '24h') minutes = 1440;
    if (window === '6h') minutes = 360;

    const since = new Date(Date.now() - minutes * 60 * 1000);

    const stats = await prisma.endpointStatsMinute.findMany({
      where: {
        endpointId: id,
        bucket: { gte: since },
      },
      orderBy: { bucket: 'asc' },
    });

    return reply.send({
      endpointId: id,
      window,
      data: stats.map((s) => ({
        bucket: s.bucket.toISOString(),
        attempts: s.attempts,
        successes: s.successes,
        failures: s.failures,
        latencyAvgMs: s.attempts > 0 ? Number(s.latencySumMs / BigInt(s.attempts)) : 0,
        latencyMaxMs: s.latencyMaxMs,
      })),
    });
  });
};
