import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const ingestLatency = new Trend('ingest_ack_latency_ms');
const ingestSuccess = new Rate('ingest_success_rate');
const rateLimitedCount = new Counter('rate_limited_429_count');

export const options = {
  scenarios: {
    // 1. Ingest throughput ramp
    ingest_throughput: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 100,
      stages: [
        { duration: '15s', target: 50 },  // Ramp to 50 req/s
        { duration: '30s', target: 100 }, // Steady 100 req/s
        { duration: '15s', target: 150 }, // Burst to 150 req/s (tests token bucket limit)
        { duration: '10s', target: 0 },   // Cool down
      ],
    },
  },
  thresholds: {
    ingest_ack_latency_ms: ['p(95)<50', 'p(99)<100'],
    ingest_success_rate: ['rate>0.95'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'whk_Z7-6dPUmra3uYdEmc6q6gdOkgx7_mXWC';

export default function () {
  const payload = JSON.stringify({
    type: 'order.completed',
    payload: {
      orderId: `ord_${__VU}_${__ITER}`,
      amount: Math.floor(Math.random() * 10000) + 100,
      currency: 'USD',
      customer: {
        id: `cust_${__VU}`,
        tier: 'premium',
      },
      timestamp: Date.now(),
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      'Idempotency-Key': `k6_${__VU}_${__ITER}_${Date.now()}`,
    },
  };

  const start = Date.now();
  const res = http.post(`${BASE_URL}/v1/events`, payload, params);
  const duration = Date.now() - start;

  ingestLatency.add(duration);

  if (res.status === 200 || res.status === 202) {
    ingestSuccess.add(1);
  } else if (res.status === 429) {
    rateLimitedCount.add(1);
    ingestSuccess.add(0);
  } else {
    ingestSuccess.add(0);
  }

  check(res, {
    'status is 200 or 202': (r) => r.status === 200 || r.status === 202,
    'latency is acceptable (<100ms)': () => duration < 100,
  });
}
