import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { checkRateLimit } from '../ratelimit.js';

describe('Token Bucket Rate Limiter', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis('redis://localhost:6379');
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('should allow requests within capacity', async () => {
    const tenantId = `test-tenant-${Date.now()}`;
    const res = await checkRateLimit(redis, tenantId, 10, 5, 1);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(9);
    expect(res.retryAfter).toBe(0);
  });

  it('should exhaust tokens and reject when burst limit is exceeded', async () => {
    const tenantId = `burst-test-${Date.now()}`;
    const capacity = 3;
    const refillRate = 1;

    // Consume all 3 tokens
    const r1 = await checkRateLimit(redis, tenantId, capacity, refillRate, 1);
    const r2 = await checkRateLimit(redis, tenantId, capacity, refillRate, 1);
    const r3 = await checkRateLimit(redis, tenantId, capacity, refillRate, 1);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);

    // 4th request must be rejected with retryAfter >= 1
    const r4 = await checkRateLimit(redis, tenantId, capacity, refillRate, 1);
    expect(r4.allowed).toBe(false);
    expect(r4.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('should fail open when Redis is null', async () => {
    const res = await checkRateLimit(null, 'any-tenant', 10, 5, 1);
    expect(res.allowed).toBe(true);
    expect(res.retryAfter).toBe(0);
  });
});
