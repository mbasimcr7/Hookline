import type {
  Delivery,
  Endpoint,
  EndpointStatsResponse,
  SseDeliveryEvent,
} from './types';

export const DEFAULT_API_KEY = 'whk_Z7-6dPUmra3uYdEmc6q6gdOkgx7_mXWC';

export function getApiKey(): string {
  if (typeof window === 'undefined') return DEFAULT_API_KEY;
  return localStorage.getItem('hookline_api_key') || DEFAULT_API_KEY;
}

export function setApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('hookline_api_key', key.trim());
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // In browser, use proxy route or NEXT_PUBLIC_API_URL
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  }
  return process.env.INTERNAL_API_URL || 'http://localhost:3000';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const apiKey = getApiKey();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${apiKey}`);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(errorBody.error?.message || errorBody.message || `Request failed (${res.status})`);
  }

  return res.json() as Promise<T>;
}

// 1. Endpoints
export async function getEndpoints(): Promise<{ data: Endpoint[] }> {
  return request<{ data: Endpoint[] }>('/v1/endpoints');
}

export async function createEndpoint(data: {
  url: string;
  description?: string;
  eventTypes?: string[];
}): Promise<Endpoint> {
  return request<Endpoint>('/v1/endpoints', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getEndpoint(id: string): Promise<Endpoint> {
  return request<Endpoint>(`/v1/endpoints/${id}`);
}

export async function getEndpointStats(id: string, window = '1h'): Promise<EndpointStatsResponse> {
  return request<EndpointStatsResponse>(`/v1/endpoints/${id}/stats?window=${window}`);
}

// 2. Deliveries
export async function getDeliveries(params: {
  status?: string;
  endpointId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: Delivery[]; total: number; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.endpointId) query.set('endpointId', params.endpointId);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));

  const qs = query.toString();
  return request<{ data: Delivery[]; total: number; limit: number; offset: number }>(
    `/v1/deliveries${qs ? `?${qs}` : ''}`
  );
}

export async function getDelivery(id: string): Promise<Delivery> {
  return request<Delivery>(`/v1/deliveries/${id}`);
}

export async function retryDelivery(id: string): Promise<{ success: boolean; deliveryId: string }> {
  return request<{ success: boolean; deliveryId: string }>(`/v1/deliveries/${id}/retry`, {
    method: 'POST',
  });
}

export async function replayDeliveries(data: {
  endpointId: string;
  from: string;
  to: string;
  status?: 'succeeded' | 'dead';
}): Promise<{ replayId: string; replayedCount: number }> {
  return request<{ replayId: string; replayedCount: number }>('/v1/replay', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// 3. SSE Live stream using fetch with Authorization Bearer header
export function subscribeDeliveryStream(
  onEvent: (event: SseDeliveryEvent) => void,
  onStatusChange?: (isConnected: boolean) => void
): () => void {
  const baseUrl = getApiBaseUrl();
  const apiKey = getApiKey();
  let controller = new AbortController();
  let isClosed = false;

  async function connect() {
    if (isClosed) return;
    try {
      const res = await fetch(`${baseUrl}/v1/stream`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`SSE stream connection failed (${res.status})`);
      }

      if (onStatusChange) onStatusChange(true);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const decoder = new TextDecoder();
      let buffer = '';

      while (!isClosed) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          const match = block.match(/^data:\s*(.+)$/m);
          if (match) {
            try {
              const data = JSON.parse(match[1]);
              if (data && (data.deliveryId || data.type)) {
                onEvent(data);
              }
            } catch (err) {
              console.warn('Could not parse SSE JSON', err);
            }
          }
        }
      }
    } catch (err: any) {
      if (isClosed || err.name === 'AbortError') return;
      if (onStatusChange) onStatusChange(false);
      setTimeout(connect, 3000);
    }
  }

  connect();

  return () => {
    isClosed = true;
    controller.abort();
    if (onStatusChange) onStatusChange(false);
  };
}
