import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Redis } from 'ioredis';
import { connectRabbitMQ, createKafkaProducer, type Producer } from '@hookline/mq';
import { config, logger } from '@hookline/shared';
import { prisma } from '@hookline/db';
import { authenticateApiKey } from './auth.js';
import { endpointRoutes } from './routes/endpoints.js';
import { eventRoutes } from './routes/events.js';
import { deliveryRoutes } from './routes/deliveries.js';
import { streamRoutes } from './routes/stream.js';

async function bootstrap() {
  const app = Fastify({
    logger: false,
    bodyLimit: 256 * 1024, // 256KB payload limit
  });

  await app.register(cors, {
    origin: '*',
  });

  // Healthchecks
  app.get('/healthz', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'connected' };
    } catch (err) {
      return reply.code(503).send({ status: 'not_ready', error: 'Database unreachable' });
    }
  });

  // Connect RabbitMQ
  let rabbitChannel = null;
  try {
    const { channel } = await connectRabbitMQ(config.RABBITMQ_URL, config.RETRY_SCALE);
    rabbitChannel = channel;
    logger.info('Connected to RabbitMQ');
  } catch (err) {
    logger.error({ err }, 'Could not connect to RabbitMQ initially');
  }

  // Connect Redis
  let redis = null;
  try {
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy: () => 2000,
      lazyConnect: true,
    });
    await redis.connect();
    logger.info('Connected to Redis');
  } catch (err) {
    logger.warn({ err }, 'Could not connect to Redis; running in degraded fallback mode');
    redis = null;
  }

  // Connect Kafka
  let kafkaProducer: Producer | null = null;
  try {
    const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());
    kafkaProducer = await createKafkaProducer(brokers, 'api-producer');
  } catch (err) {
    logger.warn({ err }, 'API running without Kafka producer');
    kafkaProducer = null;
  }

  // Protected /v1 routes
  app.register(
    async (v1) => {
      v1.addHook('preHandler', authenticateApiKey);
      await v1.register(endpointRoutes);
      await v1.register(eventRoutes(rabbitChannel, redis, kafkaProducer));
      await v1.register(deliveryRoutes(rabbitChannel));
      await v1.register(streamRoutes(redis));
    },
    { prefix: '/v1' }
  );

  const port = config.PORT;
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`Hookline API listening on http://0.0.0.0:${port}`);
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal error starting API server');
  process.exit(1);
});
