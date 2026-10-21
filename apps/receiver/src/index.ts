import Fastify from 'fastify';
import { logger, verifyWebhookSignature } from '@hookline/shared';

interface ReceiverControl {
  mode: 'ok' | 'fail' | 'slow' | 'flaky';
  failRate: number; // 0 to 1
  delayMs: number;
  secret: string;
}

const state: {
  control: ReceiverControl;
  receivedCount: number;
  duplicateCount: number;
  signatureFailures: number;
  seenDeliveries: Set<string>;
  recentEvents: Array<{
    deliveryId: string;
    eventId: string;
    attempt: number;
    timestamp: number;
    payload: unknown;
    receivedAt: string;
  }>;
} = {
  control: {
    mode: 'ok',
    failRate: 0.5,
    delayMs: 2000,
    secret: process.env.RECEIVER_SECRET || 'whsec_demo_secret',
  },
  receivedCount: 0,
  duplicateCount: 0,
  signatureFailures: 0,
  seenDeliveries: new Set(),
  recentEvents: [],
};

const app = Fastify({
  logger: false,
});

// Capture raw body for signature verification
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    const rawString = typeof body === 'string' ? body : body.toString('utf-8');
    const json = JSON.parse(rawString);
    (req as unknown as { rawBody: string }).rawBody = rawString;
    done(null, json);
  } catch (err) {
    done(err as Error, undefined);
  }
});

// 1. Control endpoint
app.post('/control', async (req, reply) => {
  const body = req.body as Partial<ReceiverControl>;
  if (body.mode) state.control.mode = body.mode;
  if (typeof body.failRate === 'number') state.control.failRate = body.failRate;
  if (typeof body.delayMs === 'number') state.control.delayMs = body.delayMs;
  if (body.secret) state.control.secret = body.secret;

  logger.info({ control: state.control }, 'Receiver control mode updated');
  return reply.send({ success: true, control: state.control });
});

// 2. Stats endpoint
app.get('/stats', async (_req, reply) => {
  return reply.send({
    control: state.control,
    receivedCount: state.receivedCount,
    duplicateCount: state.duplicateCount,
    signatureFailures: state.signatureFailures,
    recentEvents: state.recentEvents.slice(0, 50),
  });
});

// Reset stats
app.post('/stats/reset', async (_req, reply) => {
  state.receivedCount = 0;
  state.duplicateCount = 0;
  state.signatureFailures = 0;
  state.seenDeliveries.clear();
  state.recentEvents = [];
  return reply.send({ success: true });
});

// 3. Webhook receiving endpoint
app.post('/hook', async (req, reply) => {
  const deliveryId = (req.headers['x-hookline-delivery-id'] as string) || 'unknown';
  const eventId = (req.headers['x-hookline-event-id'] as string) || 'unknown';
  const attempt = Number(req.headers['x-hookline-attempt'] || 1);
  const timestamp = Number(req.headers['x-hookline-timestamp'] || 0);
  const signature = (req.headers['x-hookline-signature'] as string) || '';
  const rawBody = (req as unknown as { rawBody: string }).rawBody || JSON.stringify(req.body);

  logger.info(
    { deliveryId, attempt, mode: state.control.mode },
    'Receiver got webhook delivery'
  );

  // Signature verification if secret configured
  if (state.control.secret && signature) {
    const verification = verifyWebhookSignature(state.control.secret, timestamp, rawBody, signature);
    if (!verification.valid) {
      state.signatureFailures++;
      logger.warn({ deliveryId, reason: verification.reason }, 'Receiver signature verification failed');
      return reply.code(401).send({ error: 'Invalid signature', reason: verification.reason });
    }
  }

  // Deduplication check
  if (state.seenDeliveries.has(deliveryId)) {
    state.duplicateCount++;
    logger.info({ deliveryId }, 'Receiver detected duplicate delivery ID');
  } else {
    state.seenDeliveries.add(deliveryId);
  }
  state.receivedCount++;

  state.recentEvents.unshift({
    deliveryId,
    eventId,
    attempt,
    timestamp,
    payload: req.body,
    receivedAt: new Date().toISOString(),
  });
  if (state.recentEvents.length > 100) state.recentEvents.pop();

  // Simulate modes
  if (state.control.mode === 'fail') {
    return reply.code(500).send({ error: 'Internal Server Error (Simulated receiver outage)' });
  }

  if (state.control.mode === 'slow') {
    await new Promise((resolve) => setTimeout(resolve, state.control.delayMs));
    return reply.code(200).send({ received: true, simulatedDelayMs: state.control.delayMs });
  }

  if (state.control.mode === 'flaky') {
    if (Math.random() < state.control.failRate) {
      return reply.code(503).send({ error: 'Service Unavailable (Simulated flaky failure)' });
    }
  }

  return reply.code(200).send({ received: true, deliveryId, attempt });
});

// HTML visual monitor for demos
app.get('/', async (_req, reply) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Hookline Fake Receiver</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; }
    .stats { display: flex; gap: 2rem; font-size: 1.25rem; }
    .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-weight: bold; }
    .ok { background: #166534; color: #bbf7d0; }
    .fail { background: #991b1b; color: #fecaca; }
    .slow { background: #854d0e; color: #fef08a; }
    button { background: #38bdf8; border: none; padding: 0.5rem 1rem; border-radius: 4px; font-weight: bold; cursor: pointer; color: #0f172a; }
    button:hover { opacity: 0.9; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.875rem; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #334155; }
    th { color: #94a3b8; }
  </style>
</head>
<body>
  <h1>Hookline Demo Receiver (Port 4000)</h1>
  <div class="card">
    <div class="stats">
      <div>Status Mode: <span class="badge ${state.control.mode === 'ok' ? 'ok' : 'fail'}">${state.control.mode.toUpperCase()}</span></div>
      <div>Received: <strong>${state.receivedCount}</strong></div>
      <div>Duplicates: <strong>${state.duplicateCount}</strong></div>
      <div>Sig Failures: <strong>${state.signatureFailures}</strong></div>
    </div>
    <div style="margin-top: 1.5rem; display: flex; gap: 0.5rem;">
      <button onclick="setMode('ok')">Set OK</button>
      <button style="background:#ef4444; color:white;" onclick="setMode('fail')">Set FAIL (500)</button>
      <button style="background:#eab308; color:black;" onclick="setMode('slow')">Set SLOW (2s)</button>
      <button style="background:#a855f7; color:white;" onclick="setMode('flaky')">Set FLAKY (50%)</button>
      <button style="background:#64748b; color:white;" onclick="resetStats()">Reset Counters</button>
    </div>
  </div>
  <div class="card">
    <h3>Recent Deliveries (Last 50)</h3>
    <table>
      <thead>
        <tr><th>Time</th><th>Delivery ID</th><th>Attempt</th><th>Event ID</th></tr>
      </thead>
      <tbody>
        ${state.recentEvents
          .map(
            (e) =>
              `<tr><td>${e.receivedAt.split('T')[1].replace('Z', '')}</td><td><code>${e.deliveryId}</code></td><td>#${e.attempt}</td><td><code>${e.eventId}</code></td></tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>
  <script>
    async function setMode(mode) {
      await fetch('/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      location.reload();
    }
    async function resetStats() {
      await fetch('/stats/reset', { method: 'POST' });
      location.reload();
    }
    setTimeout(() => location.reload(), 5000);
  </script>
</body>
</html>`;
  return reply.type('text/html').send(html);
});

const port = Number(process.env.RECEIVER_PORT || 4000);
app.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    logger.error(err, 'Failed to start receiver');
    process.exit(1);
  }
  logger.info(`Receiver running on ${address}`);
});
