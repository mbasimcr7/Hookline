export type DeliveryStatus = 'pending' | 'retrying' | 'succeeded' | 'dead';

export interface DeliveryAttempt {
  id: string;
  attemptNo: number;
  status: 'succeeded' | 'failed' | 'timeout' | 'circuit_skipped';
  httpStatus: number | null;
  durationMs: number;
  error: string | null;
  responseSnippet: string | null;
  attemptedAt: string;
}

export interface Delivery {
  id: string;
  eventId: string;
  endpointId: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
  endpoint?: {
    id: string;
    url: string;
    description?: string;
  };
  event?: {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    createdAt: string;
  };
  attemptLogs?: DeliveryAttempt[];
}

export interface Endpoint {
  id: string;
  tenantId: string;
  url: string;
  description?: string;
  eventTypes: string[];
  status: 'active' | 'disabled';
  circuitState?: 'closed' | 'open' | 'half_open';
  successRate1h?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EndpointMinuteStat {
  bucket: string;
  attempts: number;
  successes: number;
  failures: number;
  latencyAvgMs: number;
  latencyMaxMs: number;
}

export interface EndpointStatsResponse {
  endpointId: string;
  window: string;
  data: EndpointMinuteStat[];
}

export interface SseDeliveryEvent {
  type: string;
  tenantId: string;
  deliveryId: string;
  endpointId: string;
  status: string;
  attemptNo: number;
  timestamp: string | number;
}
