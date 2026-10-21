'use client';

import React, { useState, useEffect } from 'react';
import type { SseDeliveryEvent, Delivery } from '../lib/types';
import { subscribeDeliveryStream, getDelivery, getDeliveries } from '../lib/api';
import { StatusBadge } from './StatusBadge';
import { formatTimestamp, truncate } from '../lib/utils';
import { Play, Pause, Trash2, Radio, ArrowUpRight, Zap } from 'lucide-react';

interface LiveFeedProps {
  onSelectDelivery?: (delivery: Delivery) => void;
}

export function LiveFeed({ onSelectDelivery }: LiveFeedProps) {
  const [events, setEvents] = useState<SseDeliveryEvent[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [loadingDeliveryId, setLoadingDeliveryId] = useState<string | null>(null);

  // Load initial deliveries on mount so feed is not empty
  useEffect(() => {
    getDeliveries({ limit: 10 })
      .then((res) => {
        if (res.data?.length > 0) {
          const initialEvents: SseDeliveryEvent[] = res.data.map((d) => ({
            type: 'delivery.updated',
            tenantId: (d as any).tenantId || '',
            deliveryId: d.id,
            endpointId: d.endpointId,
            status: d.status,
            attemptNo: d.attempts || 1,
            timestamp: d.updatedAt || d.createdAt,
          }));
          setEvents(initialEvents);
        }
      })
      .catch((err) => console.warn('Could not load initial feed deliveries', err));
  }, []);

  // Subscribe to live SSE updates
  useEffect(() => {
    const unsubscribe = subscribeDeliveryStream(
      (event) => {
        if (isPaused) return;
        setEvents((prev) => {
          // De-duplicate or update existing delivery entry if present
          const filtered = prev.filter((e) => e.deliveryId !== event.deliveryId);
          return [event, ...filtered].slice(0, 30);
        });
      },
      (connected) => {
        setIsConnected(connected);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [isPaused]);

  const handleItemClick = async (deliveryId: string) => {
    if (!onSelectDelivery) return;
    try {
      setLoadingDeliveryId(deliveryId);
      const delivery = await getDelivery(deliveryId);
      onSelectDelivery(delivery);
    } catch (err) {
      console.error('Failed to load delivery details', err);
    } finally {
      setLoadingDeliveryId(null);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-card/50">
        <div className="flex items-center gap-2">
          <div className="relative flex h-2 w-2">
            {isConnected ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500 animate-pulse"></span>
            )}
          </div>
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-foreground">
            Live Delivery Stream
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
            {isConnected ? `${events.length} events` : 'connecting...'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="p-1 text-xs font-mono text-muted hover:text-foreground bg-slate-800/80 hover:bg-slate-700 rounded transition-colors"
            title={isPaused ? 'Resume stream' : 'Pause stream'}
          >
            {isPaused ? (
              <Play className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Pause className="w-3.5 h-3.5 text-amber-400" />
            )}
          </button>
          <button
            onClick={() => setEvents([])}
            className="p-1 text-xs font-mono text-muted hover:text-foreground bg-slate-800/80 hover:bg-slate-700 rounded transition-colors"
            title="Clear events"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="divide-y divide-border/60 overflow-y-auto max-h-[420px] font-mono text-xs">
        {events.length === 0 ? (
          <div className="p-8 text-center text-muted-dark">
            <Radio className="w-6 h-6 mx-auto mb-2 opacity-40 animate-pulse" />
            <p>Listening for live webhook deliveries...</p>
            <p className="text-[11px] mt-1 text-slate-500">
              Run <code>pnpm event</code> in your terminal to see live delivery pulses.
            </p>
          </div>
        ) : (
          events.map((e, idx) => (
            <div
              key={`${e.deliveryId}-${idx}`}
              onClick={() => handleItemClick(e.deliveryId)}
              className="p-3 hover:bg-card-hover cursor-pointer transition-colors flex items-center justify-between gap-3 group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <StatusBadge status={e.status} showIcon={false} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-medium group-hover:text-brand-400 transition-colors">
                      {truncate(e.deliveryId, 16)}
                    </span>
                    <span className="text-[10px] text-muted-dark bg-slate-800 px-1 rounded">
                      #{e.attemptNo}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted block truncate">
                    ep: {truncate(e.endpointId, 14)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-muted-dark">
                  {typeof e.timestamp === 'number'
                    ? new Date(e.timestamp).toLocaleTimeString()
                    : formatTimestamp(e.timestamp).split(',')[1]}
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-muted-dark opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
