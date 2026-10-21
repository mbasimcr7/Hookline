# Architecture Decision Records (ADRs) - Hookline

## ADR 001: Monorepo Structure & Package Boundaries
- **Date:** 2026-10-20
- **Context:** Need to share database models, RabbitMQ topology, logging, and security utilities across API, Worker, Analytics, and Dashboard.
- **Decision:** Use `pnpm` workspaces with:
  - `packages/db`: Prisma schema and client exports.
  - `packages/shared`: Shared types, Zod configuration, Pino logger, HMAC signing.
  - `packages/mq`: RabbitMQ connection, queue/exchange declarations, Kafka helpers.
  - `apps/*`: Independent runnable services (`api`, `worker`, `analytics`, `dashboard`, `receiver`).
- **Consequences:** Clean separation of concerns. Services consume only the dependencies they require.

## ADR 002: Fixed-TTL Retry Tier Queues instead of Per-Message TTL
- **Date:** 2026-10-20
- **Context:** Per-message TTL in RabbitMQ suffers from head-of-line blocking (messages only expire when they reach the front of the queue).
- **Decision:** Create 5 discrete fixed-TTL tier queues (`delivery.retry.1` to `delivery.retry.5`) with queue-level `x-message-ttl` and `x-dead-letter-exchange` routing back to `delivery.work`.
- **Consequences:** Predictable exponential backoff without head-of-line blocking. Messages transition cleanly through retry stages to `delivery.dlq`.

## ADR 003: Postgres-First Dual-Write Mitigation
- **Date:** 2026-10-20
- **Context:** Ingest writes to Postgres then publishes to RabbitMQ/Kafka. If the process crashes after DB commit but before publish, deliveries remain un-enqueued.
- **Decision:** Use a lightweight reconciler background loop in the worker querying pending deliveries older than 30s (`status = 'pending' AND created_at < NOW() - INTERVAL '30s'`) and republishing them.
- **Consequences:** Avoids immediate full transactional outbox pattern complexity in Milestone 1 while guaranteeing zero lost deliveries.

## ADR 004: Redis Lua Token-Bucket Rate Limiting & Fail-Open Degradation
- **Date:** 2026-10-21
- **Context:** Individual tenants flooding `POST /v1/events` must not exhaust database connections or starve other tenants (noisy neighbor problem).
- **Decision:** Implement token-bucket rate limiting (`BURST=200`, `RPS=100`) via an atomic Redis Lua script executing in single-digit microseconds. If Redis is temporarily unreachable (F10), fail **open** with a warning log rather than dropping customer events.
- **Consequences:** Microsecond rate check latency, zero race conditions on token replenishment, graceful degradation if cache layer restarts.

## ADR 005: Circuit Breaker for Destabilized Receiver Protection
- **Date:** 2026-10-21
- **Context:** When a customer endpoint goes down for an extended period, hammering it with retries wastes worker concurrency and can prevent the receiver from recovering.
- **Decision:** Track consecutive failures in Redis / memory (`CB_FAILURE_THRESHOLD=5`). Once tripped, open circuit for `CB_OPEN_SECONDS=60` and record `circuit_skipped: true` attempt logs without consuming the max retry budget. After 60s, transition to `half_open` to allow a single probe attempt.
- **Consequences:** Prevents thundering herds on customer infrastructure. Automatic self-healing upon receiver recovery.

## ADR 006: Asynchronous Kafka KRaft Streaming for Analytics (F9 Resilience)
- **Date:** 2026-10-21
- **Context:** Event volume analytics and delivery attempt telemetry should not burden PostgreSQL OLTP transactions.
- **Decision:** Use Apache Kafka (KRaft single-node mode) to stream `events.received`, `deliveries.attempted`, and `deliveries.final`. Kafka publishing is strictly **best-effort and asynchronous**. If Kafka is down (F9), delivery critical path continues unhindered; the analytics service catches up after recovery.
- **Consequences:** High-velocity streaming decoupled from transaction boundary. Zero database locks on minute-bucket metric writes.

## ADR 007: Next.js App Router for Developer Observability Dashboard
- **Date:** 2026-10-21
- **Context:** Operators need real-time visibility into queue depths, delivery attempts, payload inspectability, and dead-letter queues without complex auth requirements.
- **Decision:** Build `apps/dashboard` with Next.js 14 App Router, Tailwind CSS, Lucide icons, and Recharts. Connect directly to API routes using API keys and stream real-time updates via Server-Sent Events (`GET /v1/stream`).
- **Consequences:** Instant interactive debugging, single-binary dashboard execution, zero-latency live delivery feed.

