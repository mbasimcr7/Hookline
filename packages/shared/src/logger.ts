import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createChildLogger(bindings: {
  deliveryId?: string;
  eventId?: string;
  tenantId?: string;
  endpointId?: string;
  service?: string;
}) {
  return logger.child(bindings);
}
