import { performance } from 'perf_hooks';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const RECEIVER_URL = process.env.RECEIVER_BASE_URL || 'http://localhost:4000';
const API_KEY = process.env.API_KEY || 'whk_Z7-6dPUmra3uYdEmc6q6gdOkgx7_mXWC';

interface MetricResult {
  scenario: string;
  totalRequests: number;
  successCount: number;
  rateLimitedCount: number;
  errorCount: number;
  durationSec: number;
  throughputRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

function computePercentiles(durations: number[]): { p50: number; p95: number; p99: number; max: number } {
  if (durations.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const p99 = durations[Math.floor(durations.length * 0.99)];
  const max = durations[durations.length - 1];
  return {
    p50: Math.round(p50 * 10) / 10,
    p95: Math.round(p95 * 10) / 10,
    p99: Math.round(p99 * 10) / 10,
    max: Math.round(max * 10) / 10,
  };
}

async function setReceiverMode(mode: 'ok' | 'fail' | 'flaky', failRate = 0.5) {
  try {
    await fetch(`${RECEIVER_URL}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, failRate }),
    });
  } catch (err) {
    console.warn('Could not contact receiver control endpoint:', err);
  }
}

// 1. Ingest Throughput Test
async function runIngestTest(totalRequests = 1000, concurrency = 25): Promise<MetricResult> {
  console.log(`\n--- Running Scenario 1: Ingest Throughput (${totalRequests} events @ concurrency ${concurrency}) ---`);
  await setReceiverMode('ok');

  const durations: number[] = [];
  let successCount = 0;
  let rateLimitedCount = 0;
  let errorCount = 0;

  const startAll = performance.now();
  let remaining = totalRequests;

  async function worker() {
    while (remaining > 0) {
      const idx = remaining--;
      const start = performance.now();
      try {
        const res = await fetch(`${BASE_URL}/v1/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
            'Idempotency-Key': `bench_${idx}_${Date.now()}`,
          },
          body: JSON.stringify({
            type: 'benchmark.event',
            payload: { idx, amount: 2500, time: Date.now() },
          }),
        });

        const duration = performance.now() - start;
        durations.push(duration);

        if (res.status === 200 || res.status === 202) {
          successCount++;
        } else if (res.status === 429) {
          rateLimitedCount++;
        } else {
          errorCount++;
        }
      } catch (err) {
        durations.push(performance.now() - start);
        errorCount++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }).map(() => worker()));
  const totalDurationSec = (performance.now() - startAll) / 1000;
  const p = computePercentiles(durations);

  return {
    scenario: '1. Ingest Throughput (Clean Receiver)',
    totalRequests,
    successCount,
    rateLimitedCount,
    errorCount,
    durationSec: Math.round(totalDurationSec * 100) / 100,
    throughputRps: Math.round((totalRequests / totalDurationSec) * 10) / 10,
    p50Ms: p.p50,
    p95Ms: p.p95,
    p99Ms: p.p99,
    maxMs: p.max,
  };
}

// 2. Failure Storm (50% Receiver Flakiness)
async function runFailureStormTest(totalRequests = 300, concurrency = 15): Promise<MetricResult> {
  console.log(`\n--- Running Scenario 2: Failure Storm (50% Receiver Flakiness) ---`);
  await setReceiverMode('flaky', 0.5);

  const durations: number[] = [];
  let successCount = 0;
  let rateLimitedCount = 0;
  let errorCount = 0;

  const startAll = performance.now();
  let remaining = totalRequests;

  async function worker() {
    while (remaining > 0) {
      const idx = remaining--;
      const start = performance.now();
      try {
        const res = await fetch(`${BASE_URL}/v1/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
            'Idempotency-Key': `storm_${idx}_${Date.now()}`,
          },
          body: JSON.stringify({
            type: 'storm.event',
            payload: { idx, storm: true },
          }),
        });

        const duration = performance.now() - start;
        durations.push(duration);

        if (res.status === 200 || res.status === 202) {
          successCount++;
        } else if (res.status === 429) {
          rateLimitedCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }).map(() => worker()));
  await setReceiverMode('ok');

  const totalDurationSec = (performance.now() - startAll) / 1000;
  const p = computePercentiles(durations);

  return {
    scenario: '2. Failure Storm (50% Receiver Drops)',
    totalRequests,
    successCount,
    rateLimitedCount,
    errorCount,
    durationSec: Math.round(totalDurationSec * 100) / 100,
    throughputRps: Math.round((totalRequests / totalDurationSec) * 10) / 10,
    p50Ms: p.p50,
    p95Ms: p.p95,
    p99Ms: p.p99,
    maxMs: p.max,
  };
}

// 3. Noisy Neighbor Rate Limiting Test
async function runNoisyNeighborTest(): Promise<MetricResult> {
  console.log(`\n--- Running Scenario 3: Noisy Neighbor (Token-Bucket Burst Flood) ---`);
  // Blast 400 requests instantly with burst limit = 200, RPS = 100
  const totalRequests = 400;
  const durations: number[] = [];
  let successCount = 0;
  let rateLimitedCount = 0;
  let errorCount = 0;

  const startAll = performance.now();

  await Promise.all(
    Array.from({ length: totalRequests }).map(async (_, idx) => {
      const start = performance.now();
      try {
        const res = await fetch(`${BASE_URL}/v1/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
            'Idempotency-Key': `flood_${idx}_${Date.now()}`,
          },
          body: JSON.stringify({
            type: 'flood.event',
            payload: { idx },
          }),
        });

        const duration = performance.now() - start;
        durations.push(duration);

        if (res.status === 200 || res.status === 202) {
          successCount++;
        } else if (res.status === 429) {
          rateLimitedCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    })
  );

  const totalDurationSec = (performance.now() - startAll) / 1000;
  const p = computePercentiles(durations);

  return {
    scenario: '3. Noisy Neighbor (Token Bucket 429 Isolation)',
    totalRequests,
    successCount,
    rateLimitedCount,
    errorCount,
    durationSec: Math.round(totalDurationSec * 100) / 100,
    throughputRps: Math.round((totalRequests / totalDurationSec) * 10) / 10,
    p50Ms: p.p50,
    p95Ms: p.p95,
    p99Ms: p.p99,
    maxMs: p.max,
  };
}

async function main() {
  console.log('========================================================');
  console.log('      HOOKLINE PERFORMANCE BENCHMARK & LOAD TESTING     ');
  console.log('========================================================');

  const r1 = await runIngestTest(1000, 25);
  console.log(r1);

  // Cool down 3 seconds
  await new Promise((r) => setTimeout(r, 3000));

  const r2 = await runFailureStormTest(300, 15);
  console.log(r2);

  await new Promise((r) => setTimeout(r, 3000));

  const r3 = await runNoisyNeighborTest();
  console.log(r3);

  console.log('\n========================================================');
  console.log('                 BENCHMARK COMPLETED                    ');
  console.log('========================================================\n');

  console.log(JSON.stringify([r1, r2, r3], null, 2));
}

main().catch(console.error);
