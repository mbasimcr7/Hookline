import { describe, it, expect } from 'vitest';
import { RETRY_TIERS } from '../rabbitmq.js';

describe('RabbitMQ Retry Topology', () => {
  it('should define 5 exponential retry tiers', () => {
    expect(RETRY_TIERS).toHaveLength(5);
    expect(RETRY_TIERS[0].baseTtlMs).toBe(5_000);       // 5s
    expect(RETRY_TIERS[1].baseTtlMs).toBe(30_000);      // 30s
    expect(RETRY_TIERS[2].baseTtlMs).toBe(120_000);     // 2m
    expect(RETRY_TIERS[3].baseTtlMs).toBe(600_000);     // 10m
    expect(RETRY_TIERS[4].baseTtlMs).toBe(3_600_000);   // 1h
  });

  it('should properly scale TTLs with RETRY_SCALE for fast demos', () => {
    const scale = 0.1;
    const scaledTtls = RETRY_TIERS.map((t) => Math.max(100, Math.floor(t.baseTtlMs * scale)));

    expect(scaledTtls[0]).toBe(500);    // 500ms
    expect(scaledTtls[1]).toBe(3000);   // 3s
    expect(scaledTtls[2]).toBe(12000);  // 12s
    expect(scaledTtls[3]).toBe(60000);  // 1m
    expect(scaledTtls[4]).toBe(360000); // 6m
  });
});
