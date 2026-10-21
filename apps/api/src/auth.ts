import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma, type Tenant } from '@hookline/db';
import { hashApiKey, logger } from '@hookline/shared';

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: Tenant;
  }
}

export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  let rawKey = '';
  const authHeader = request.headers.authorization;
  const queryApiKey = (request.query as Record<string, string> | undefined)?.api_key;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawKey = authHeader.replace(/^Bearer\s+/, '').trim();
  } else if (queryApiKey) {
    rawKey = queryApiKey.trim();
  } else {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header or api_key query parameter' },
    });
  }

  const keyHash = hashApiKey(rawKey);

  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { tenant: true },
    });

    if (!apiKey || apiKey.revokedAt !== null) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid or revoked API key' },
      });
    }

    request.tenant = apiKey.tenant;
  } catch (error) {
    logger.error({ error }, 'Database error during API key authentication');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to authenticate request' },
    });
  }
}
