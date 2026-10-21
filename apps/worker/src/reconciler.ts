import type { Channel } from '@hookline/mq';
import { prisma, DeliveryStatus } from '@hookline/db';
import { publishDelivery } from '@hookline/mq';
import { logger } from '@hookline/shared';

export function startReconciler(channel: Channel, intervalMs = 15_000) {
  logger.info({ intervalMs }, 'Starting dual-write reconciler loop');

  const timer = setInterval(async () => {
    try {
      const threshold = new Date(Date.now() - 30_000); // 30 seconds ago
      const stuckDeliveries = await prisma.delivery.findMany({
        where: {
          status: DeliveryStatus.pending,
          createdAt: { lt: threshold },
        },
        take: 50,
      });

      if (stuckDeliveries.length > 0) {
        logger.warn(
          { count: stuckDeliveries.length },
          'Reconciler found pending deliveries older than 30s; re-publishing'
        );

        for (const delivery of stuckDeliveries) {
          publishDelivery(channel, delivery.id);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in reconciler sweep loop');
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
