# PRD: Hookline — Reliable Webhook Delivery Platform

> A multi-tenant service that accepts events from a customer's app and guarantees at-least-once delivery to their registered HTTP endpoints, with retries, backoff, dead-lettering, idempotency, rate limiting, circuit breaking, replay, and live observability.

**Status:** Draft v1
**Owner:** Basim
**Purpose:** Portfolio/CV project demonstrating event-driven architecture (Redis + RabbitMQ + Kafka) for mid-level full-stack roles.
**Build target:** 2–3 focused days for core, +1 day polish.

---

## 0. How to use this document (read first, AI agent / IDE)

This PRD is the source of truth. When building:

1. Follow the **build order in Section 15** strictly. Do not start a later milestone until the earlier one's acceptance criteria pass.
2. Prefer **boring, working code** over clever abstractions. No premature generalization.
3. Every service must run via **Docker Compose**. `docker compose up` from repo root must bring the full system up.
4. Every failure mode in **Section 11** needs a test or a scripted demo.
5. Do **not** add features not listed here (auth beyond API keys, multi-region, Kubernetes, billing) unless explicitly asked.
6. Keep a running `docs/DECISIONS.md` (short ADR log) — one entry per non-obvious choice.
7. When a requirement is ambiguous, choose the simplest option, document it in `DECISIONS.md`, and continue.

---

## 1. Problem & Context

When something happens in one system (payment succeeded, order shipped), other systems need to be told. The standard mechanism is a **webhook**: an HTTP POST to a URL the receiver registered.

Naive webhook sending breaks in predictable ways:
- Receiver is down or slow → events lost.
- Sender retries blindly → duplicate deliveries, retry storms hammering a dead endpoint.
- One noisy tenant starves everyone else.
- No visibility: "did my customer get event X?" has no answer.
- No way to re-send events after a receiver recovers from an outage.

**Hookline** solves this as a service: producers send events once; Hookline guarantees delivery and gives full visibility and control.

## 2. Goals

| # | Goal | Measure |
|---|------|---------|
| G1 | At-least-once delivery with exponential backoff and a dead-letter queue | Demo: kill receiver, events retry with increasing delays, land in DLQ after max attempts, deliver after recovery + replay |
| G2 | Effectively-once *processing* via idempotency | Same `Idempotency-Key` sent N times → exactly 1 delivery created |
| G3 | Protect receivers and the platform | Per-tenant rate limit; per-endpoint circuit breaker |
| G4 | Full audit trail + replay | Every attempt stored; replay by endpoint + time range |
| G5 | Observability | Dashboard: live deliveries, success rate, latency per endpoint, queue depth |
| G6 | Honest, demoable engineering | One-command Docker setup, load test with *recorded real numbers*, README explaining tradeoffs |

## 3. Non-Goals (explicit scope cuts)

- No Kubernetes, Helm, Terraform, multi-region, or HA broker clustering.
- No full user auth (signup/login/OAuth/RBAC). Tenants use API keys; dashboard uses a single admin-selected tenant.
- No billing, plans, or quotas beyond rate limiting.
- No exactly-once delivery claims (impossible over HTTP; we provide at-least-once + idempotency headers for receivers).
- No guaranteed global ordering. Best-effort ordering per endpoint only (documented limitation).
- No payload transformation, filtering DSL, or fan-out rules engine beyond simple `event_types` filter per endpoint.

## 4. Personas

- **Tenant developer (primary):** integrates by sending events via API and registering endpoints. Wants reliability and debuggability.
- **Receiver developer (secondary):** receives webhooks. Wants signatures, idempotency IDs, predictable retry behavior.
- **Operator (the demo viewer / interviewer):** wants to see the system under failure.

## 5. User Stories

1. As a tenant, I register an endpoint URL and get a signing secret.
2. As a tenant, I `POST /v1/events` and get `202 Accepted` immediately, regardless of receiver health.
3. As a tenant, I can send the same event twice with the same idempotency key and it is only delivered once.
4. As a tenant, I can see every delivery and every attempt (status code, latency, error, response snippet).
5. As a tenant, I can manually retry a failed/dead delivery.
6. As a tenant, I can replay all events for an endpoint within a time range (e.g., after an outage).
7. As a receiver, I can verify the HMAC signature and timestamp on each request and use the delivery ID to dedupe.
8. As an operator, I can watch live deliveries and per-endpoint health on a dashboard.
9. As an operator, I can see that a failing endpoint gets circuit-broken rather than hammered.

---

## 6. System Architecture

### 6.1 Components

```
                    ┌──────────────┐
  Tenant app ─────► │   API (3000) │──────────────┐
                    └──────┬───────┘              │
                           │ 1. tx: event+deliveries (Postgres)
                           │ 2. publish
              ┌────────────┴────────────┐
              ▼                         ▼
      ┌──────────────┐          ┌──────────────┐
      │  RabbitMQ    │          │    Kafka     │
      │ delivery work│          │ events log   │
      └──────┬───────┘          └──────┬───────┘
             ▼                         ▼
      ┌──────────────┐          ┌──────────────┐
      │ Worker(s)    │          │  Analytics   │
      │ (scalable)   │          │  consumer    │
      └──┬───────┬───┘          └──────┬───────┘
         │       │ publish attempt      │ writes aggregates
         │       └──────► Kafka ◄───────┘
         ▼
   Customer endpoint (receiver)      Redis: idempotency, rate limit,
                                      circuit breaker, pub/sub for SSE
                    ┌──────────────┐
                    │ Dashboard    │ ◄── API (REST + SSE)
                    │ Next.js 3001 │
                    └──────────────┘
         Postgres: tenants, endpoints, events, deliveries, attempts, stats
```

### 6.2 Responsibility split (the "why each tool exists" — put this in the README)

| Tool | Role | Why it, and not another |
|------|------|--------------------------|
| **RabbitMQ** | Work queue for delivery jobs. Retry tiers via TTL + dead-letter exchange. Final DLQ. | Per-message ack/nack, routing, delayed retry via TTL queues, and DLQ semantics are native. This is a *task* problem: "do this once, retry on failure". |
| **Kafka** | Durable, ordered, replayable event log: `events.received`, `deliveries.attempted`, `deliveries.final`. Multiple independent consumers. | This is a *log* problem: many readers, history retained, replay to rebuild analytics. |
| **Redis** | Fast shared state: idempotency keys, rate limiting, circuit breaker state, in-flight lock, pub/sub fan-out for live dashboard. | Sub-ms atomic ops with TTLs. |
| **Postgres** | System of record: tenants, endpoints, events, deliveries, attempts, aggregates. | Durable relational source of truth. |

**Honest note (must appear in README):** at small scale, Postgres + a job library (e.g., BullMQ/pg-boss) could do all of this. This project uses the three brokers deliberately to demonstrate when each is the right tool and to learn their failure modes. Document the tradeoff instead of hiding it.

### 6.3 Tech stack

- **Language:** TypeScript (Node 20+) everywhere.
- **Monorepo:** pnpm workspaces.
- **API:** Fastify (or Express) + Zod validation.
- **Worker / Analytics:** plain Node services.
- **Dashboard:** Next.js (App Router) + Tailwind + Recharts. Live updates via SSE.
- **DB:** Postgres 16 + Prisma (migrations in `packages/db`).
- **Clients:** `amqplib` (RabbitMQ), `kafkajs` (Kafka), `ioredis` (Redis).
- **Kafka:** single-node KRaft (`apache/kafka` image), no Zookeeper.
- **Logging:** `pino`, structured JSON, with `deliveryId`, `eventId`, `tenantId`, `endpointId` fields.
- **Testing:** Vitest + Testcontainers (integration), k6 (load).
- **CI:** GitHub Actions (late-stage).

---

## 7. Data Model (Postgres)

```
tenants
  id uuid pk, name text, created_at timestamptz

api_keys
  id uuid pk, tenant_id fk, key_hash text unique, prefix text, created_at, revoked_at null

endpoints
  id uuid pk, tenant_id fk, url text, secret text,
  event_types text[] (empty = all),
  status enum('active','disabled','circuit_open') default 'active',
  created_at, updated_at

events
  id uuid pk, tenant_id fk, type text, payload jsonb,
  idempotency_key text null, created_at
  UNIQUE (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL

deliveries
  id uuid pk, event_id fk, endpoint_id fk, tenant_id fk,
  status enum('pending','in_flight','succeeded','retrying','dead'),
  attempt_count int default 0,
  next_attempt_at timestamptz null,
  last_error text null,
  created_at, completed_at null
  INDEX (tenant_id, status, created_at desc), INDEX (endpoint_id, created_at desc)

delivery_attempts
  id uuid pk, delivery_id fk, attempt_no int,
  started_at, duration_ms int,
  response_status int null, response_snippet text null (max 1KB),
  error text null, circuit_skipped bool default false

endpoint_stats_minute            -- built by analytics consumer
  endpoint_id, bucket timestamptz (minute),
  attempts int, successes int, failures int,
  latency_sum_ms bigint, latency_max_ms int
  PK (endpoint_id, bucket)

kafka_processed                  -- consumer idempotency
  consumer text, topic text, partition int, offset bigint
  PK (consumer, topic, partition, offset)
```

**Source-of-truth rule:** Postgres is truth for event/delivery state. Kafka is a log/projection feed. If they disagree, Postgres wins.

---

## 8. API Specification

Base: `/v1`. Auth: `Authorization: Bearer whk_<random>` (hashed with SHA-256 in DB; show raw key once on creation). All responses JSON. Errors: `{ "error": { "code": "...", "message": "..." } }`.

### 8.1 Endpoints management
| Method | Path | Notes |
|---|---|---|
| POST | `/endpoints` | body `{url, eventTypes?: string[]}` → returns endpoint **with secret** (shown once) |
| GET | `/endpoints` | list |
| GET | `/endpoints/:id` | detail + health summary (success rate 1h, circuit state) |
| PATCH | `/endpoints/:id` | update url/eventTypes/status |
| DELETE | `/endpoints/:id` | soft-disable |
| POST | `/endpoints/:id/rotate-secret` | stretch |

URL validation: must be `http(s)`. **SSRF protection:** reject private/loopback/link-local IPs in non-dev mode (env flag `ALLOW_PRIVATE_URLS=true` for Docker demo where receiver is `http://receiver:4000`).

### 8.2 Events
| Method | Path | Notes |
|---|---|---|
| POST | `/events` | body `{type, payload}`; header `Idempotency-Key` optional. Returns `202 {eventId, deliveries: [{id, endpointId}]}`. Replayed idempotency key returns `200` with original result. |
| GET | `/events` | paginated (cursor), filter by type/time |
| GET | `/events/:id` | event + its deliveries |

### 8.3 Deliveries
| Method | Path | Notes |
|---|---|---|
| GET | `/deliveries` | filter `status`, `endpointId`, time range; cursor pagination |
| GET | `/deliveries/:id` | with all attempts |
| POST | `/deliveries/:id/retry` | re-enqueue a `dead`/`retrying` delivery immediately (resets attempt counter, records manual retry) |
| POST | `/replay` | body `{endpointId, from, to, status?: 'dead'\|'all'}` → creates **new** deliveries for matching events, returns `{replayId, count}` |

### 8.4 Stats & stream
| Method | Path | Notes |
|---|---|---|
| GET | `/stats/overview` | totals, success rate, p50/avg latency, queue depth, DLQ depth |
| GET | `/stats/endpoints/:id?window=1h` | time-series from `endpoint_stats_minute` |
| GET | `/stream` | **SSE** of delivery state changes for the tenant (fed from Redis pub/sub) |

### 8.5 Bootstrap
- `pnpm seed` script creates a demo tenant + API key + a receiver endpoint, prints the key. No signup API.

---

## 9. Message Flows

### 9.1 Ingest (API)

1. Authenticate tenant via API key.
2. Validate body (Zod).
3. **Idempotency check (Redis):** `SET idem:{tenantId}:{key} {eventId} NX EX 86400`. If key exists → return stored original response (`200`). (Postgres unique constraint is the durable backstop.)
4. **Rate limit (Redis):** per-tenant token bucket. Exceeded → `429` with `Retry-After`.
5. Find matching active endpoints by `event_types`.
6. **Single Postgres transaction:** insert `events` row + one `deliveries` row per endpoint (`status=pending`).
7. Publish after commit:
   - RabbitMQ: one message per delivery → exchange `delivery`, routing key `work`, persistent, with `deliveryId`.
   - Kafka: `events.received` message (key = `tenantId`) with event + delivery IDs.
8. Return `202`.

**Dual-write gap (be honest):** step 7 can fail after step 6. **Mitigation:** a `reconciler` loop in the worker app sweeps `deliveries` where `status='pending' AND created_at < now()-30s` and republishes. Worker is idempotent (Section 9.2), so duplicate publishes are safe. Document this as a lightweight alternative to the transactional outbox pattern; mention outbox as the "next step" in README.

### 9.2 Delivery (Worker)

Consume from queue `delivery.work` with `prefetch=10` (configurable), manual ack.

For each message `{deliveryId}`:

1. **Load delivery + endpoint + event** from Postgres. If delivery already `succeeded` → ack and drop (duplicate message).
2. **In-flight lock (Redis):** `SET lock:delivery:{id} {workerId} NX EX 30`. If lock held → nack-requeue-with-delay / drop (another worker is on it).
3. **Circuit breaker check (Redis):** if endpoint circuit is `open` → do **not** call it; record attempt with `circuit_skipped=true` (doesn't count toward max attempts), schedule next retry tier. Ack.
4. Mark `in_flight`, increment `attempt_count`, `started_at`.
5. **HTTP POST** to endpoint URL, timeout `10s`, no redirects followed (or max 0), body = canonical JSON.
6. **Outcome:**
   - **2xx** → mark `succeeded`, record attempt, reset breaker failure counter, ack, emit Kafka `deliveries.attempted` + `deliveries.final`, publish Redis pub/sub for SSE.
   - **Non-2xx / timeout / network error** → record attempt, increment breaker failure counter (may open circuit), emit Kafka `deliveries.attempted`.
       - If `attempt_count < MAX_ATTEMPTS` → publish to **next retry tier** queue, mark `retrying`, ack original.
       - Else → publish to **DLQ**, mark `dead`, emit Kafka `deliveries.final`, ack.
7. Release lock. Ack only **after** state is persisted and next message (retry/DLQ) is published (publisher confirms enabled).

Worker crash mid-delivery → message unacked → RabbitMQ redelivers → lock expires (30s TTL) → another worker processes. Result: potential duplicate HTTP call, which is why receivers get a stable `X-Hookline-Delivery-Id`.

### 9.3 Retry topology (RabbitMQ)

Use **fixed-TTL tier queues** (not per-message TTL, which causes head-of-line blocking):

| Queue | TTL | On expiry dead-letters to |
|---|---|---|
| `delivery.work` | — | (consumed by workers) |
| `delivery.retry.1` | 5 s | exchange `delivery` → `delivery.work` |
| `delivery.retry.2` | 30 s | → `delivery.work` |
| `delivery.retry.3` | 2 min | → `delivery.work` |
| `delivery.retry.4` | 10 min | → `delivery.work` |
| `delivery.retry.5` | 1 h | → `delivery.work` |
| `delivery.dlq` | — | parking lot; inspected via dashboard, replay via API |

- `MAX_ATTEMPTS = 6` (1 initial + 5 retries). Tier chosen = `attempt_count` (1→tier1 … 5→tier5). Add ±20% jitter by randomly choosing between two parallel queues per tier, **or** document jitter as a stretch goal.
- All queues durable; messages persistent.
- Demo mode: env `RETRY_SCALE=0.1` multiplies TTLs for fast demos. (Implement by configuring queue TTLs from env at startup.)

### 9.4 Kafka topics

| Topic | Key | Value | Partitions | Retention |
|---|---|---|---|---|
| `events.received` | `tenantId` | `{eventId, tenantId, type, deliveryIds[], ts}` | 3 | 7d |
| `deliveries.attempted` | `endpointId` | `{deliveryId, endpointId, attemptNo, status, durationMs, httpStatus, error?, ts}` | 3 | 7d |
| `deliveries.final` | `endpointId` | `{deliveryId, endpointId, finalStatus, attempts, ts}` | 3 | 7d |

Keying by `endpointId` preserves per-endpoint ordering of attempt events.

**Analytics consumer** (group `analytics-v1`):
- Consumes `deliveries.attempted`, upserts `endpoint_stats_minute`.
- **Idempotent:** record `(topic, partition, offset)` in `kafka_processed` inside the same transaction as the upsert; skip if present (at-least-once consumer → effectively-once effect).
- Commits offsets after DB transaction.
- **Rebuild command:** `pnpm analytics:rebuild` truncates stats and resets the group offset to earliest → demonstrates log replay.

### 9.5 Replay vs manual retry (don't confuse these)

- **Manual retry:** re-enqueue an *existing* delivery (same `deliveryId`), attempt counter reset.
- **Replay:** for events in `[from,to]` for an endpoint, create *new* `deliveries` rows (new IDs), enqueue them, tag with `replayId`. Source = Postgres `events` table.
- **Analytics rebuild:** replays the **Kafka** log to rebuild projections. This is the honest, legitimate Kafka-replay use case.

### 9.6 Redis keys

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `idem:{tenantId}:{key}` | string | 24h | idempotency → eventId |
| `rl:{tenantId}` | token bucket (Lua script) | rolling | per-tenant rate limit (default 100 req/s burst 200; env configurable) |
| `cb:{endpointId}` | hash `{state, failures, openUntil}` | — | circuit breaker |
| `lock:delivery:{id}` | string | 30s | in-flight dedupe |
| `ch:tenant:{tenantId}` | pub/sub channel | — | SSE fan-out |

**Circuit breaker rules:** 5 consecutive failures → `open` for 60s. After `openUntil` → `half_open`: allow one probe delivery; success → `closed`, failure → `open` again (double duration up to 10 min). State changes emitted to dashboard.

---

## 10. Outbound Webhook Contract (what receivers see)

Request: `POST {endpoint.url}`, `Content-Type: application/json`

Headers:
- `X-Hookline-Delivery-Id`: stable per delivery (use for receiver-side dedupe)
- `X-Hookline-Event-Id`
- `X-Hookline-Event-Type`
- `X-Hookline-Attempt`: 1-based attempt number
- `X-Hookline-Timestamp`: unix seconds
- `X-Hookline-Signature`: `v1=` + hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))

Body: `{ "id": eventId, "type": "...", "createdAt": "...", "data": { ...payload } }`

Receiver verification (provide as snippet in README): recompute HMAC, constant-time compare, reject if timestamp older than 5 minutes (replay protection).

Success = any `2xx` within 10s. Everything else is a failure.

---

## 11. Failure Modes & Required Behavior

Each row must have a test and/or a scripted demo.

| # | Scenario | Expected behavior |
|---|---|---|
| F1 | Receiver returns 500 / times out | Retries through tiers with increasing delay; attempts visible in dashboard; DLQ after max |
| F2 | Receiver down for an extended period | Circuit opens after 5 failures; no hammering; probes later; recovers automatically |
| F3 | Worker killed mid-delivery | Message redelivered; delivery completes; at most a duplicate HTTP call; no lost delivery |
| F4 | Duplicate event submission (same idempotency key) | One event, one set of deliveries |
| F5 | Same delivery message published twice | Worker detects `succeeded` / lock and skips |
| F6 | API publishes fail after DB commit | Reconciler republishes pending deliveries within ~30s |
| F7 | Poison message (delivery row missing / corrupt) | Rejected to DLQ, logged, doesn't block queue |
| F8 | Tenant floods API | `429` for that tenant; other tenants unaffected |
| F9 | Kafka down | Ingest and delivery **still work** (Kafka publishes are best-effort with logged failure); analytics catches up after recovery. Kafka must not be in the critical path of delivery. |
| F10 | Redis down | Ingest falls back to Postgres unique constraint for idempotency; rate limiting fails **open** with a warning log; circuit breaker defaults to closed. Document the choice. |
| F11 | Analytics consumer restarts mid-batch | No double-counting (offset-tracking table) |
| F12 | Slow receiver (>10s) | Timeout recorded as failure; worker not blocked beyond timeout |

---

## 12. Dashboard (Next.js)

Single-tenant view selected by API key in env/local storage. Pages:

1. **Overview:** KPI cards (events/min, success rate, avg latency, DLQ depth, queue depth), live deliveries feed (SSE), mini chart.
2. **Deliveries:** table with filters (status, endpoint, time), status badges, row → drawer showing all attempts (status code, duration, error, response snippet), **Retry** button.
3. **Endpoints:** list with health (success rate 1h, circuit state), create endpoint form, **Replay** modal (time range + status).
4. **Endpoint detail:** success-rate and latency time series (Recharts), recent failures.
5. **DLQ view:** filtered deliveries with `dead` status, bulk retry.

Keep UI clean and minimal; function over polish. No auth screens.

---

## 13. Fake Receiver (demo + test tool)

Small service `apps/receiver` on port 4000:

- `POST /hook` — logs received webhook, verifies signature, tracks seen delivery IDs and counts duplicates.
- `POST /control` — body `{mode: "ok"|"fail"|"slow"|"flaky", failRate?: number, delayMs?: number}`.
- `GET /stats` — received counts, duplicate count, signature failures.
- Simple HTML page showing live received events.

This service is what makes the 30-second demo possible.

---

## 14. Infrastructure & Repo Layout

### 14.1 Docker Compose services

`postgres:16`, `redis:7`, `rabbitmq:3-management` (15672 UI), `apache/kafka` (KRaft single node, 9092), `api` (3000), `worker` (scalable, no host port), `analytics`, `dashboard` (3001), `receiver` (4000). Healthchecks on all infra; app services `depends_on: condition: service_healthy`. Named volumes for Postgres/RabbitMQ/Kafka data. A `migrate` one-shot service runs Prisma migrations.

Scale demo: `docker compose up --scale worker=3`.

### 14.2 Repo structure

```
hookline/
├─ apps/
│  ├─ api/            # Fastify REST + SSE
│  ├─ worker/         # delivery worker + reconciler
│  ├─ analytics/      # Kafka consumer
│  ├─ dashboard/      # Next.js
│  └─ receiver/       # fake customer endpoint
├─ packages/
│  ├─ db/             # Prisma schema + client
│  ├─ shared/         # types, config (zod env), logger, signing util
│  └─ mq/             # RabbitMQ topology setup, Kafka producer/consumer helpers, Redis scripts
├─ infra/
│  └─ docker-compose.yml  (or root)
├─ k6/                # load test scripts
├─ scripts/           # seed, demo scenarios, analytics:rebuild
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ DECISIONS.md
│  └─ diagrams/
├─ .github/workflows/ # added last
├─ README.md
└─ PRD.md
```

### 14.3 Configuration (env, validated with Zod at startup)

`DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`, `KAFKA_BROKERS`, `MAX_ATTEMPTS=6`, `RETRY_SCALE=1`, `DELIVERY_TIMEOUT_MS=10000`, `WORKER_PREFETCH=10`, `RATE_LIMIT_RPS=100`, `RATE_LIMIT_BURST=200`, `CB_FAILURE_THRESHOLD=5`, `CB_OPEN_SECONDS=60`, `ALLOW_PRIVATE_URLS=false`.

---

## 15. Build Order & Acceptance Criteria

### Milestone 1 — Core delivery loop (Day 1)
Build: monorepo, Compose with Postgres + Redis + RabbitMQ, Prisma schema, API (`POST /endpoints`, `POST /events`), RabbitMQ topology (work + retry tiers + DLQ), worker with HMAC signing, receiver with `/control`.
**Accept when:**
- `docker compose up` brings system up cleanly.
- Event → delivered to receiver, signature verifies.
- Receiver in `fail` mode → delivery retries through tiers (use `RETRY_SCALE=0.1`), then lands in `delivery.dlq` with status `dead`.
- Flip receiver to `ok`, manual retry endpoint delivers it.
- All attempts stored in `delivery_attempts`.

### Milestone 2 — Redis guards + Kafka log (Day 2)
Build: idempotency, rate limiting (Lua), circuit breaker, in-flight lock, reconciler, Kafka (KRaft) + producers, analytics consumer with idempotent offset tracking, `endpoint_stats_minute`, replay endpoint, Redis pub/sub → SSE.
**Accept when:**
- Same `Idempotency-Key` ×10 → 1 event, 1 delivery.
- 5 consecutive failures open circuit; subsequent attempts are `circuit_skipped` until probe.
- Kill worker mid-delivery → delivery still completes.
- Stop Kafka → deliveries still work; restart → analytics catches up.
- `analytics:rebuild` reproduces identical stats.
- Replay creates new deliveries for a time window.

### Milestone 3 — Dashboard, load test, docs (Day 3)
Build: Next.js dashboard (5 pages), k6 script, README, architecture diagram, DECISIONS.md, demo script.
**Accept when:**
- Dashboard shows live feed, drawer with attempts, retry + replay buttons working.
- k6 results recorded in `docs/LOAD_TEST.md` **with real measured numbers, hardware, and caveats** (local machine, not production).
- README contains the "Why Kafka vs RabbitMQ vs just Postgres" section, failure-mode demo steps, and honest limitations.

### Milestone 4 — Polish (optional, +1 day)
GitHub Actions (lint, typecheck, unit, Testcontainers integration, build+push images to GHCR), per-endpoint jitter on retries, `Retry-After` handling on `429`, secret rotation, transactional outbox replacing reconciler.

---

## 16. Testing Strategy

- **Unit (Vitest):** signature generation/verification, backoff tier selection, circuit breaker state machine, idempotency logic, Zod schemas.
- **Integration (Testcontainers):** real Postgres/Redis/RabbitMQ/Kafka. Cover: F1, F3, F4, F5, F6, F9, F11. These are the tests that make the project credible.
- **Chaos scripts (`scripts/demo-*.sh`):** `demo-outage` (stop receiver, send 50 events, watch retries, restore, replay), `demo-worker-kill`, `demo-duplicate`, `demo-flood`.
- **Load (k6):** scenarios below.

### Load test plan
| Scenario | What it shows |
|---|---|
| Ingest throughput: ramp to N req/s on `POST /events` with healthy receiver | API ack latency (p50/p95/p99), error rate |
| Delivery throughput: end-to-end event→delivered latency under steady load, 1 vs 3 workers | Worker scaling effect |
| Failure storm: 50% receiver failure rate | Retry behavior, queue depth, no worker starvation |
| Noisy neighbor: one tenant floods, another sends steady traffic | Rate limit isolation |

**Rule:** report measured numbers only. Do not invent targets in the README. Initial hypotheses to test (not claims): API ack p95 < 50ms at a few hundred req/s on a laptop; near-linear delivery throughput scaling from 1→3 workers when receiver is fast.

---

## 17. Observability

- Structured JSON logs (pino) with correlation IDs across API → worker.
- RabbitMQ management UI and queue depth exposed in `/stats/overview` (via management API or `checkQueue`).
- `/healthz` (liveness) and `/readyz` (checks Postgres/Redis/RabbitMQ) on API and worker.
- Optional stretch: Prometheus `/metrics` + Grafana in Compose.

---

## 18. Security (scoped)

- API keys stored hashed; shown once.
- HMAC-SHA256 signatures + timestamp on all outbound requests.
- SSRF guard on endpoint URLs (block private ranges unless `ALLOW_PRIVATE_URLS`), resolve DNS before request and re-check IP.
- Response body capped at 1KB stored; request timeout enforced; redirects disabled.
- Payload size limit (e.g., 256KB) on ingest.
- Secrets via env; no secrets in repo.

---

## 19. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Kafka config eats a day | Add Kafka only in Milestone 2; use KRaft single-node; keep topics/consumer minimal |
| Scope creep into "build a real Svix" | Section 3 non-goals are binding |
| Dual-write inconsistency | Reconciler + idempotent worker; document outbox as upgrade |
| Retry timing painful to demo | `RETRY_SCALE` env for fast demos |
| Project looks like tutorial work | Ship the failure demos + integration tests + honest README |
| Overclaiming on CV | Use "built and load tested locally", state real numbers |

---

## 20. README Requirements

Must include:
1. One-paragraph pitch + architecture diagram.
2. Quickstart (`docker compose up`, `pnpm seed`, demo commands).
3. **"Why RabbitMQ, Kafka, and Redis (and when you wouldn't)"** — the tradeoff section including the honest "Postgres + BullMQ would also work at this scale."
4. Delivery semantics: at-least-once, idempotency, ordering limitations.
5. Failure-mode demo walkthrough (F1–F12 highlights) with GIF/screenshots.
6. Load test summary with real numbers and caveats.
7. Known limitations and "what I'd do next" (outbox pattern, HA brokers, multi-region, ordering guarantees).

---

## 21. Interview Cheat Sheet (for the author)

Be ready to answer, from having actually built it:
- Why RabbitMQ for delivery and Kafka for events? What breaks if you swap them?
- What does "at-least-once" mean here and where do duplicates come from?
- How does a retry tier work, and why fixed-TTL queues instead of per-message TTL?
- What happens if the worker dies after the HTTP call but before ack?
- What's the dual-write problem and how did you handle it?
- Why is Kafka not in the delivery critical path?
- How would you guarantee ordering per endpoint? (single consumer per endpoint / partition by endpoint)
- What would you change to run this at 100× scale?

## 22. CV Bullets (use only after it actually runs)

- Built a multi-tenant webhook delivery platform (TypeScript, Next.js) with at-least-once delivery, exponential-backoff retries via RabbitMQ TTL/DLX tiers, and a dead-letter queue.
- Implemented Redis-backed idempotency keys, token-bucket rate limiting, and per-endpoint circuit breakers; verified against worker-crash, duplicate-message, and receiver-outage scenarios with Testcontainers integration tests.
- Used Kafka as a replayable event log feeding an idempotent analytics consumer (rebuildable from offset 0); dashboard with live SSE feed, delivery drill-down, retry and time-range replay.
- Containerized with Docker Compose (Postgres, Redis, RabbitMQ, Kafka KRaft); load tested locally with k6 (**insert real measured numbers**).
