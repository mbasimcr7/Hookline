import { config, logger } from '@hookline/shared';
import { startAnalyticsConsumer } from './consumer.js';

async function bootstrap() {
  const brokers = config.KAFKA_BROKERS.split(',').map((b: string) => b.trim());
  logger.info({ brokers }, 'Starting Hookline Analytics service');

  const stopConsumer = await startAnalyticsConsumer(brokers);

  const shutdown = async () => {
    logger.info('Shutting down Analytics service...');
    await stopConsumer();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal error starting Analytics service');
  process.exit(1);
});
