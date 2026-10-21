import type { Redis } from 'ioredis';
import { logger } from '@hookline/shared';

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'lastRefreshed')
local tokens = tonumber(data[1])
local lastRefreshed = tonumber(data[2])

if tokens == nil or lastRefreshed == nil then
  tokens = capacity
  lastRefreshed = now
else
  local delta = math.max(0, now - lastRefreshed)
  local added = delta * refillRate
  tokens = math.min(capacity, tokens + added)
  lastRefreshed = now
end

if tokens >= cost then
  tokens = tokens - cost
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefreshed', lastRefreshed)
  local ttl = math.ceil(capacity / refillRate) + 10
  redis.call('EXPIRE', key, ttl)
  return { 1, math.floor(tokens), 0 }
else
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefreshed', lastRefreshed)
  local deficit = cost - tokens
  local retryAfterSec = math.max(1, math.ceil(deficit / refillRate))
  return { 0, math.floor(tokens), retryAfterSec }
end
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

export async function checkRateLimit(
  redis: Redis | null,
  tenantId: string,
  capacity = 200,
  refillRate = 100,
  cost = 1
): Promise<RateLimitResult> {
  // F10: If Redis is unavailable, fail OPEN with a warning log
  if (!redis) {
    logger.warn({ tenantId }, 'Redis not available; rate limiter failing open');
    return { allowed: true, remaining: capacity, retryAfter: 0 };
  }

  const key = `rl:${tenantId}`;
  const now = Date.now() / 1000; // unix seconds

  try {
    const result = (await redis.eval(
      TOKEN_BUCKET_LUA,
      1,
      key,
      capacity,
      refillRate,
      cost,
      now
    )) as [number, number, number];

    const allowed = result[0] === 1;
    const remaining = result[1];
    const retryAfter = result[2];

    return { allowed, remaining, retryAfter };
  } catch (err) {
    logger.error({ err, tenantId }, 'Rate limiter Redis eval error; failing open');
    return { allowed: true, remaining: capacity, retryAfter: 0 };
  }
}
