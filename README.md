# Hookline 🎣

> **A high-throughput, multi-tenant webhook delivery engine** built with TypeScript, Fastify, RabbitMQ, Redis, Apache Kafka (KRaft), and Next.js. Engineered for zero dropped events, at-least-once delivery guarantees, automatic exponential retry tiers, and circuit breaker resilience.

---

## 1. System Architecture

Hookline separates **API ingestion**, **delivery work queues**, **transient caching & rate limiting**, and **telemetry projection** into dedicated, fault-isolated subsystems.

```
                  ┌──────────────────────────────────────────────┐
                  │                 Client App                   │
                  └──────────────┬───────────────────────────────┘
                                 │ POST /v1/events (Bearer key)
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fastify Ingestion API (:3000)                                          │
│  ├── 1. Redis Lua Token-Bucket Rate Limiter (Burst 200, RPS 100)       │
│  ├── 2. PostgreSQL System of Record (Event + Delivery rows)           │
│  ├── 3. Enqueue delivery jobs -> RabbitMQ Direct Exchange             │
│  └── 4. Best-Effort Kafka Stream -> events.received                    │
└───────┬────────────────────────┬──────────────────────────────┬────────┘
        │                        │                              │
        ▼                        ▼                              ▼
┌────────────────┐      ┌─────────────────┐           ┌──────────────────┐
│ PostgreSQL 16  │      │ Redis 7         │           │ RabbitMQ 3.12    │
│ (System of     │      │ (Token Bucket,  │           │ (Work Queue &    │
│  Record)       │      │  Circuit State, │           │  5 Retry Tiers)  │
│                │      │  SSE Pub/Sub)   │           │                  │
└───────┬────────┘      └────────┬────────┘           └────────┬─────────┘
        │                        │                             │
        │                        │                             │
        │       ┌────────────────┴─────────────────────────────┴────────┐
        │       │ Delivery Worker (:none)                               │
        │       │  ├── Pop job from delivery.work                       │
        │       │  ├── Circuit Breaker Check (skip if open)             │
        │       │  ├── HMAC-SHA256 Signing + SSRF IP Filter             │
        │       │  ├── HTTP POST with 10s Timeout                       │
        │       │  ├── Success -> Update DB + Emit to Kafka             │
        │       │  └── Failure -> Route to delivery.retry.1..5 -> DLQ   │
        │       └────────────────┬──────────────────────────────────────┘
        │                        │
        ▼                        ▼
┌─────────────────┐     ┌───────────────────────────────────────────────┐
│ Kafka KRaft     │     │ External Customer Webhook Receiver (:4000)    │
│ (Audit Stream)  │     │ (Verifies HMAC signature, responds 200 OK)    │
└───────┬─────────┘     └───────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐       ┌─────────────────────────────┐
│ Analytics Service               │       │ Next.js Dashboard (:3001)   │
│ Consumes deliveries.attempted   ├──────►│ Live SSE Delivery Stream,   │
│ Upserts endpoint_stats_minute   │       │ Latency Charts, Replay, DLQ │
└─────────────────────────────────┘       └─────────────────────────────┘
```

---

## 2. Quickstart

### Prerequisites
- Docker Desktop & Docker Compose
- Node.js 20+ & pnpm (`corepack enable && corepack prepare pnpm@latest --activate`)

### 1. Launch All Services
```bash
docker compose up -d
```
All 8 containers start with automatic health checks:
- `hookline-postgres` (Port 5432)
- `hookline-redis` (Port 6379)
- `hookline-rabbitmq` (Ports 5672, Management: 15672)
- `hookline-kafka` (KRaft Port 9092)
- `hookline-receiver` (Port 4000)
- `hookline-api` (Port 3000)
- `hookline-worker`
- `hookline-analytics`
- `hookline-dashboard` (Port 3001)

### 2. Run Database Migrations & Seed Demo Tenant
```bash
pnpm db:migrate
pnpm seed
```

This provisions:
- **Tenant ID:** `513bb978-00a3-4306-b585-0bf7535c4798`
- **API Key:** `whk_Z7-6dPUmra3uYdEmc6q6gdOkgx7_mXWC`
- **Default Endpoint:** `http://receiver:4000/hook` (Secret: `whsec_demo_secret`)

### 3. Open the Dashboard
Navigate to **`http://localhost:3001`** to view real-time delivery telemetry, attempt inspection drawer, and live SSE feed.

### 4. Ingest a Live Webhook Event
```bash
curl -X POST http://localhost:3000/v1/events \
  -H "Authorization: Bearer whk_Z7-6dPUmra3uYdEmc6q6gdOkgx7_mXWC" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "order.paid",
    "payload": {
      "orderId": "ord_9901",
      "amount": 4900,
      "currency": "USD"
    }
  }'
```

---

## 3. Why RabbitMQ, Kafka, and Redis? (Tradeoff Analysis)

An engineering breakdown of why each system is used for its specific strength — and when you wouldn't:

| Component | Responsibility | Why this choice? | What breaks if you swap them? | When would you NOT use this? |
| :--- | :--- | :--- | :--- | :--- |
| **RabbitMQ** | Delivery Work Queue, Exponential Retries, DLQ | Native per-queue dead-letter exchanges (`x-dead-letter-exchange`), message acknowledgments (`basic.ack` / `basic.nack`), zero head-of-line blocking on fixed TTL tiers. | Swapping with Kafka destroys point-to-point worker acknowledgments; retrying individual items in Kafka requires consumer offset pauses or custom topic topologies. | At low volume (<50 webhooks/sec), **Postgres + BullMQ** or `pg-boss` would eliminate an entire infrastructure dependency. |
| **Apache Kafka (KRaft)** | Immutable Event Stream & Telemetry Projection | High-throughput ordered append log. Enables **rebuilding analytics from offset 0** (`pnpm analytics:rebuild`) without querying OLTP tables. Completely out of the delivery critical path. | Swapping with RabbitMQ loses persistent retention for historical replay; RabbitMQ discards messages once acknowledged. | If historical event sourcing and replayable metric rebuilding are not required, an OLAP store (ClickHouse) or simple batch inserts directly to Postgres is simpler. |
| **Redis** | Rate Limiting, Circuit Breaker, SSE Pub/Sub | Atomic Lua token-bucket algorithm executed in microseconds. Redis pub/sub powers real-time Server-Sent Events to browser dashboards without DB polling. | Using Postgres for token replenish checks adds row lock contention on hot tenant records during traffic spikes. | If running multi-region active-active clusters, distributed consensus across Redis clusters requires Redis Enterprise or CRDTs. |

---

## 4. Delivery Semantics & Failure Modes (F1–F12)

Hookline provides **at-least-once** delivery guarantees. Downstream webhook receivers must be idempotent:

1. **Fixed-TTL Retry Tiers:** 5 discrete exponential queues (`delivery.retry.1` to `5`) with TTLs: 5s, 30s, 2m, 10m, 1h (scaled in dev by `RETRY_SCALE=0.1`).
2. **SSRF Guard:** Validates URLs against private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1`, `169.254.169.254`). Resolves DNS before dispatch to prevent DNS-rebinding attacks.
3. **Circuit Breaker:** After 5 consecutive failures to an endpoint, the circuit opens for 60 seconds. Attempt logs record `circuit_skipped: true` without consuming the tenant's max attempt budget. After 60s, a single probe is admitted (`half_open`).
4. **F9 Kafka Down Resilience:** If Kafka crashes or times out, webhook ingestion and worker delivery **continue without interruption**. Kafka logging is best-effort; the analytics service catches up after recovery.
5. **F10 Redis Down Resilience:** If Redis is unreachable, rate limiting **fails open** with a warning log, and circuit breakers default to closed to prevent dropping legitimate customer events.
6. **Dual-Write Reconciler:** A background loop queries deliveries remaining in `pending` status for >30s and republishes them to RabbitMQ, mitigating process crashes between DB commit and queue publish.

---

## 5. Measured Load Test Benchmarks

Real, local measurements executed on developer hardware (documented in [`docs/LOAD_TEST.md`](docs/LOAD_TEST.md)):

```
========================================================
      HOOKLINE PERFORMANCE BENCHMARK & LOAD TESTING     
========================================================

Scenario 1: High-Concurrency Ingest Throughput (1,000 events @ 25 concurrent connections)
- Total Ingested: 1,000 / 1,000 (100% success rate, 0 dropped)
- Ingest Throughput: ~20.3 requests/sec
- Median Ack Latency (p50): 1,176.1 ms (Postgres commit + Redis token check)
- p95 Tail Latency: 2,020.5 ms

Scenario 2: Failure Storm (50% Receiver Flakiness)
- Total Ingested: 300 / 300 (100% API intake success rate)
- API Ingest Throughput: 20.1 requests/sec
- Ingest path completely unblocked while RabbitMQ handled backoff retries.

Scenario 3: Noisy Neighbor (Token-Bucket Burst Flood)
- Burst Flood: 400 instantaneous parallel requests
- Token Bucket burst limit absorbed requests; no database connection exhaustion.
```

---

## 6. Project Directory Layout

```
hookline/
├── apps/
│   ├── api/            # Fastify REST API, token bucket rate limiter, SSE stream
│   ├── worker/         # Delivery worker, HMAC signing, circuit breaker, reconciler
│   ├── analytics/      # Kafka consumer, 1-minute windowed rollup aggregation
│   ├── dashboard/      # Next.js 14 App Router, Tailwind CSS, Recharts
│   └── receiver/       # Mock customer receiver with simulated outage/flaky modes
├── packages/
│   ├── db/             # Prisma schema, migrations, and database client
│   ├── mq/             # RabbitMQ topology, Kafka helpers, Redis Lua scripts
│   └── shared/         # Configuration (Zod), logger (Pino), HMAC crypto, SSRF guard
├── k6/                 # k6 load testing scripts
├── scripts/            # Seed data, analytics rebuild, and benchmark runner
├── docs/
│   ├── DECISIONS.md    # Architecture Decision Records (ADR 001–007)
│   └── LOAD_TEST.md    # Local benchmark results and hardware specs
├── docker-compose.yml  # 8-service local production topology
└── PRD.md              # Engineering specification & failure mode definitions
```

---

## 7. Interview Cheat Sheet

- **Why RabbitMQ for deliveries and Kafka for events?** RabbitMQ provides message-level acknowledgments, discrete retry tiers via dead-letter exchanges, and worker queue consumption. Kafka provides partitioned event append logs suited for historical replays and analytics rollups.
- **Where do duplicate deliveries come from?** If a worker completes an HTTP POST to the customer receiver but crashes before sending `basic.ack` to RabbitMQ, RabbitMQ redelivers the message to another worker. The receiver must verify idempotency using the `X-Hookline-Delivery-Id` header.
- **Why fixed-TTL queues instead of per-message TTL?** RabbitMQ per-message TTL suffers from head-of-line blocking (messages only expire when they reach the front of the queue). Fixed-TTL tier queues ensure expired messages dead-letter immediately.
- **What is the dual-write problem here?** Ingest writes to PostgreSQL then publishes to RabbitMQ. If the process crashes between the two, the delivery is saved in DB but never enqueued. Hookline's dual-write reconciler scans for `pending` deliveries older than 30s and republishes them.

---

## 8. License

MIT
