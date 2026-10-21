import { Kafka, logLevel } from 'kafkajs';
import { prisma } from '@hookline/db';
import { TOPIC_DELIVERIES_ATTEMPTED } from '@hookline/mq';
import { config, logger } from '@hookline/shared';

async function rebuildAnalytics() {
  console.log('\n======================================================');
  console.log('             REBUILDING ANALYTICS FROM KAFKA           ');
  console.log('======================================================\n');

  // 1. Truncate existing aggregate tables in Postgres
  console.log('1. Clearing endpoint_stats_minute and kafka_processed tables...');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE endpoint_stats_minute;');
  await prisma.kafkaProcessed.deleteMany({
    where: { consumer: 'analytics-v1' },
  });
  console.log('✔ Postgres aggregate tables cleared.\n');

  // 2. Reset Kafka consumer group offset to earliest
  console.log('2. Resetting Kafka consumer group "analytics-v1" offset to earliest...');
  const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());
  const kafka = new Kafka({
    clientId: 'analytics-rebuild-tool',
    brokers,
    logLevel: logLevel.ERROR,
  });

  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.resetOffsets({
      groupId: 'analytics-v1',
      topic: TOPIC_DELIVERIES_ATTEMPTED,
      earliest: true,
    });
    console.log('✔ Kafka consumer group offset reset to earliest.\n');
  } catch (err) {
    console.warn('Notice resetting offset (consumer may be starting fresh):', err instanceof Error ? err.message : String(err));
  } finally {
    await admin.disconnect();
  }

  console.log('======================================================');
  console.log('  REBUILD TRIGGERED: Analytics will replay from offset 0');
  console.log('======================================================\n');
}

rebuildAnalytics()
  .catch((err) => {
    console.error('Failed to rebuild analytics:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
