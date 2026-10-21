import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import {
  checkCircuitBreaker,
  recordCircuitSuccess,
  recordCircuitFailure,
} from '../circuit-breaker.js';

describe('Circuit Breaker State Machine', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis('redis://localhost:6379');
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('should start closed and allow execution', async () => {
    const endpointId = `ep-${Date.now()}`;
    const check = await checkCircuitBreaker(redis, endpointId);
    expect(check.allowExecution).toBe(true);
    expect(check.state).toBe('closed');
    expect(check.circuitSkipped).toBe(false);
  });

  it('should trip to OPEN after 5 consecutive failures', async () => {
    const endpointId = `ep-trip-${Date.now()}`;

    // 4 failures should keep it closed
    for (let i = 1; i <= 4; i++) {
      const outcome = await recordCircuitFailure(redis, endpointId, 5, 2);
      expect(outcome).toBe('incremented');
      const check = await checkCircuitBreaker(redis, endpointId);
      expect(check.allowExecution).toBe(true);
    }

    // 5th failure trips to OPEN
    const tripOutcome = await recordCircuitFailure(redis, endpointId, 5, 2);
    expect(tripOutcome).toBe('opened');

    // Subsequent check must skip execution
    const check = await checkCircuitBreaker(redis, endpointId);
    expect(check.allowExecution).toBe(false);
    expect(check.state).toBe('open');
    expect(check.circuitSkipped).toBe(true);
  });

  it('should reset to CLOSED on recorded success', async () => {
    const endpointId = `ep-reset-${Date.now()}`;
    await recordCircuitFailure(redis, endpointId, 1, 60);

    const checkBefore = await checkCircuitBreaker(redis, endpointId);
    expect(checkBefore.state).toBe('open');

    await recordCircuitSuccess(redis, endpointId);

    const checkAfter = await checkCircuitBreaker(redis, endpointId);
    expect(checkAfter.allowExecution).toBe(true);
    expect(checkAfter.state).toBe('closed');
    expect(checkAfter.circuitSkipped).toBe(false);
  });

  it('should fail closed when Redis is null', async () => {
    const check = await checkCircuitBreaker(null, 'any-ep');
    expect(check.allowExecution).toBe(true);
    expect(check.state).toBe('closed');
    expect(check.circuitSkipped).toBe(false);
  });
});
