import type { FastifyPluginAsync } from 'fastify';
import type { Redis } from 'ioredis';
import { logger } from '@hookline/shared';

export const streamRoutes = (redis: Redis | null): FastifyPluginAsync => {
  return async (app) => {
    app.get('/stream', async (req, reply) => {
      const tenant = req.tenant!;

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');

      // Send initial handshake
      reply.raw.write(': connected\n\n');

      if (!redis) {
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'warning', message: 'Redis unavailable; live stream degraded' })}\n\n`
        );
        return;
      }

      // Create a dedicated subscriber connection
      const subscriber = redis.duplicate();
      try {
        await subscriber.connect();
      } catch (err) {
        logger.error({ err, tenantId: tenant.id }, 'Failed to connect Redis subscriber for SSE');
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'error', message: 'Could not connect to event stream' })}\n\n`
        );
        return;
      }

      const channel = `ch:tenant:${tenant.id}`;
      await subscriber.subscribe(channel);
      logger.info({ tenantId: tenant.id, channel }, 'Client connected to live SSE stream');

      subscriber.on('message', (_chan, message) => {
        try {
          reply.raw.write(`data: ${message}\n\n`);
        } catch {
          // Socket write error handled on close
        }
      });

      // Keepalive ping every 15 seconds
      const pingInterval = setInterval(() => {
        try {
          reply.raw.write(': ping\n\n');
        } catch {
          // Handle socket write error
        }
      }, 15000);

      req.raw.on('close', async () => {
        clearInterval(pingInterval);
        try {
          await subscriber.unsubscribe(channel);
          subscriber.disconnect();
          logger.info({ tenantId: tenant.id }, 'Client disconnected from SSE stream');
        } catch {
          // Cleaned up
        }
      });
    });
  };
};
