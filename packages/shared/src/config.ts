import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  RECEIVER_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/hookline?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  
  MAX_ATTEMPTS: z.coerce.number().default(6),
  RETRY_SCALE: z.coerce.number().default(1),
  DELIVERY_TIMEOUT_MS: z.coerce.number().default(10000),
  WORKER_PREFETCH: z.coerce.number().default(10),
  ALLOW_PRIVATE_URLS: z.coerce.boolean().default(true), // Default true in dev so local receiver is allowed
  
  RATE_LIMIT_RPS: z.coerce.number().default(100),
  RATE_LIMIT_BURST: z.coerce.number().default(200),
  CB_FAILURE_THRESHOLD: z.coerce.number().default(5),
  CB_OPEN_SECONDS: z.coerce.number().default(60),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    console.error('Invalid configuration:', result.error.format());
    throw new Error('Invalid configuration');
  }
  return result.data;
}

export const config = loadConfig();
