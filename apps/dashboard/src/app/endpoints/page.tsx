'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getEndpoints } from '../../lib/api';
import type { Endpoint } from '../../lib/types';
import { CircuitBadge } from '../../components/CircuitBadge';
import { CreateEndpointModal } from '../../components/CreateEndpointModal';
import { ReplayModal } from '../../components/ReplayModal';
import { formatTimestamp, truncate } from '../../lib/utils';
import {
  Network,
  Plus,
  RotateCcw,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  ChevronRight,
  Radio,
} from 'lucide-react';

export default function EndpointsPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isReplayOpen, setIsReplayOpen] = useState(false);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | undefined>();

  const loadEndpoints = async () => {
    try {
      setLoading(true);
      const res = await getEndpoints();
      setEndpoints(res.data || []);
    } catch (err) {
      console.error('Failed to load endpoints', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEndpoints();
  }, []);

  const handleOpenReplay = (epId: string) => {
    setSelectedEndpointId(epId);
    setIsReplayOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tight text-foreground">
            Webhook Endpoints
          </h1>
          <p className="text-sm text-muted mt-1">
            Registered destinations, circuit breaker states, and 1-hour health scores.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              setSelectedEndpointId(undefined);
              setIsReplayOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Time Replay
          </button>

          <button
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold text-slate-950 bg-brand-500 hover:bg-brand-600 shadow-glow transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Destination
          </button>
        </div>
      </div>

      {/* Endpoints List */}
      <div className="grid grid-cols-1 gap-4">
        {endpoints.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-dark font-mono text-xs">
            <Network className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-foreground font-medium mb-1">No endpoints configured</p>
            <p>Click "Add Destination" to register your first webhook subscriber.</p>
          </div>
        ) : (
          endpoints.map((ep) => (
            <div
              key={ep.id}
              className="bg-card hover:bg-card/90 rounded-xl border border-border p-5 transition-all duration-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
            >
              <div className="space-y-2 min-w-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-900 border border-border">
                    <Radio className="w-4 h-4 text-brand-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-sm text-foreground">
                        {ep.url}
                      </span>
                      <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-400">
                        {ep.status}
                      </span>
                    </div>
                    {ep.description && (
                      <p className="text-xs text-muted mt-0.5">{ep.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-muted-dark">
                  <span>
                    ID: <code className="text-slate-300">{ep.id}</code>
                  </span>
                  <span>•</span>
                  <span>Events: <span className="text-slate-300">{ep.eventTypes.join(', ') || '*'}</span></span>
                  <span>•</span>
                  <span>Created: {formatTimestamp(ep.createdAt)}</span>
                </div>
              </div>

              {/* Status & Actions */}
              <div className="flex items-center gap-4 shrink-0 sm:self-center self-end">
                <CircuitBadge state={ep.circuitState || 'closed'} />

                <button
                  onClick={() => handleOpenReplay(ep.id)}
                  className="p-2 rounded-lg text-muted hover:text-cyan-400 bg-slate-900 hover:bg-slate-800 border border-border transition-colors"
                  title="Replay deliveries to this endpoint"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <Link
                  href={`/endpoints/${ep.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium text-brand-400 hover:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 transition-colors"
                >
                  <span>Analytics</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modals */}
      <CreateEndpointModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={() => loadEndpoints()}
      />

      <ReplayModal
        isOpen={isReplayOpen}
        onClose={() => setIsReplayOpen(false)}
        preselectedEndpointId={selectedEndpointId}
        onReplayComplete={() => loadEndpoints()}
      />
    </div>
  );
}
