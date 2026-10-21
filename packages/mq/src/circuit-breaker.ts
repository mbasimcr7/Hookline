import type { Redis } from 'ioredis';
import { logger } from '@hookline/shared';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitCheckResult {
  allowExecution: boolean;
  state: CircuitState;
  circuitSkipped: boolean;
}

export async function checkCircuitBreaker(
  redis: Redis | null,
  endpointId: string
): Promise<CircuitCheckResult> {
  // F10: If Redis down, fail CLOSED (allow execution)
  if (!redis) {
    return { allowExecution: true, state: 'closed', circuitSkipped: false };
  }

  const key = `cb:${endpointId}`;

  try {
    const data = await redis.hgetall(key);
    const now = Date.now();
    const state = (data.state as CircuitState) || 'closed';
    const openUntil = Number(data.openUntil || 0);

    if (state === 'open') {
      if (now >= openUntil) {
        // Cooldown passed: transition to half_open for a probe
        await redis.hset(key, 'state', 'half_open', 'probeInFlight', '1');
        logger.info({ endpointId }, 'Circuit breaker transitioning OPEN -> HALF_OPEN (probe allowed)');
        return { allowExecution: true, state: 'half_open', circuitSkipped: false };
      }

      // Still in cooldown period -> skip delivery
      return { allowExecution: false, state: 'open', circuitSkipped: true };
    }

    if (state === 'half_open') {
      const probeInFlight = data.probeInFlight === '1';
      if (!probeInFlight) {
        // Send a probe
        await redis.hset(key, 'probeInFlight', '1');
        return { allowExecution: true, state: 'half_open', circuitSkipped: false };
      }
      // Another delivery is already probing -> skip this one
      return { allowExecution: false, state: 'half_open', circuitSkipped: true };
    }

    return { allowExecution: true, state: 'closed', circuitSkipped: false };
  } catch (err) {
    logger.error({ err, endpointId }, 'Error checking circuit breaker in Redis; failing closed');
    return { allowExecution: true, state: 'closed', circuitSkipped: false };
  }
}

export async function recordCircuitSuccess(
  redis: Redis | null,
  endpointId: string
): Promise<void> {
  if (!redis) return;

  const key = `cb:${endpointId}`;
  try {
    const data = await redis.hgetall(key);
    if (data.state === 'half_open') {
      logger.info({ endpointId }, 'Probe succeeded! Circuit breaker transitioning HALF_OPEN -> CLOSED');
    }

    // Reset circuit breaker to healthy state
    await redis.hset(
      key,
      'state',
      'closed',
      'consecutiveFailures',
      '0',
      'currentDurationMs',
      '60000',
      'probeInFlight',
      '0'
    );
  } catch (err) {
    logger.warn({ err, endpointId }, 'Failed to record circuit breaker success');
  }
}

export async function recordCircuitFailure(
  redis: Redis | null,
  endpointId: string,
  threshold = 5,
  baseOpenSeconds = 60
): Promise<'opened' | 'half_open_failed' | 'incremented'> {
  if (!redis) return 'incremented';

  const key = `cb:${endpointId}`;
  try {
    const data = await redis.hgetall(key);
    const now = Date.now();
    const currentState = (data.state as CircuitState) || 'closed';
    let currentDurationMs = Number(data.currentDurationMs || baseOpenSeconds * 1000);

    if (currentState === 'half_open') {
      // Probe failed: double cooldown duration up to 10 minutes (600,000ms)
      currentDurationMs = Math.min(600_000, currentDurationMs * 2);
      const openUntil = now + currentDurationMs;

      await redis.hset(
        key,
        'state',
        'open',
        'openUntil',
        String(openUntil),
        'currentDurationMs',
        String(currentDurationMs),
        'probeInFlight',
        '0'
      );

      logger.warn(
        { endpointId, cooldownSeconds: currentDurationMs / 1000 },
        'Probe failed in HALF_OPEN; reopening circuit with doubled cooldown'
      );
      return 'half_open_failed';
    }

    // State is closed (or undefined)
    const failures = Number(data.consecutiveFailures || 0) + 1;

    if (failures >= threshold) {
      const openUntil = now + currentDurationMs;
      await redis.hset(
        key,
        'state',
        'open',
        'consecutiveFailures',
        String(failures),
        'openUntil',
        String(openUntil),
        'currentDurationMs',
        String(currentDurationMs),
        'probeInFlight',
        '0'
      );

      logger.warn(
        { endpointId, failures, openSeconds: currentDurationMs / 1000 },
        'Consecutive failure threshold reached; opening circuit breaker'
      );
      return 'opened';
    }

    await redis.hset(key, 'consecutiveFailures', String(failures));
    return 'incremented';
  } catch (err) {
    logger.warn({ err, endpointId }, 'Failed to record circuit breaker failure');
    return 'incremented';
  }
}
