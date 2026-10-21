'use client';

import React, { useState, useEffect } from 'react';
import { replayDeliveries, getEndpoints } from '../lib/api';
import type { Endpoint } from '../lib/types';
import { X, RotateCcw, Calendar, Check, AlertCircle } from 'lucide-react';

interface ReplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedEndpointId?: string;
  onReplayComplete?: (count: number) => void;
}

export function ReplayModal({
  isOpen,
  onClose,
  preselectedEndpointId,
  onReplayComplete,
}: ReplayModalProps) {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [endpointId, setEndpointId] = useState(preselectedEndpointId || '');
  const [preset, setPreset] = useState<'15m' | '1h' | '6h' | '24h'>('1h');
  const [statusFilter, setStatusFilter] = useState<'all' | 'succeeded' | 'dead'>('all');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      getEndpoints()
        .then((res) => {
          setEndpoints(res.data || []);
          if (!endpointId && res.data?.length > 0) {
            setEndpointId(preselectedEndpointId || res.data[0].id);
          }
        })
        .catch(console.error);
    }
  }, [isOpen, preselectedEndpointId]);

  if (!isOpen) return null;

  const handleReplay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!endpointId) {
      setError('Please select an endpoint');
      return;
    }

    const now = new Date();
    let fromDate = new Date();
    if (preset === '15m') fromDate = new Date(now.getTime() - 15 * 60 * 1000);
    else if (preset === '1h') fromDate = new Date(now.getTime() - 60 * 60 * 1000);
    else if (preset === '6h') fromDate = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    else if (preset === '24h') fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    try {
      setLoading(true);
      const res = await replayDeliveries({
        endpointId,
        from: fromDate.toISOString(),
        to: now.toISOString(),
        status: statusFilter === 'all' ? undefined : statusFilter,
      });

      setResult(`Successfully replayed and scheduled ${res.replayedCount} delivery jobs!`);
      if (onReplayComplete) onReplayComplete(res.replayedCount);
    } catch (err: any) {
      setError(err.message || 'Failed to replay events');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden font-mono text-xs">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-foreground font-mono">
              Time-Window Replay Webhooks
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-foreground bg-slate-800/80 hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleReplay} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{result}</span>
            </div>
          )}

          <div>
            <label className="block text-muted-dark uppercase tracking-wider text-[11px] mb-1.5">
              Target Destination Endpoint
            </label>
            <select
              value={endpointId}
              onChange={(e) => setEndpointId(e.target.value)}
              className="w-full bg-slate-950 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-cyan-500/60 transition-colors"
            >
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.url} ({ep.description || ep.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-muted-dark uppercase tracking-wider text-[11px] mb-1.5">
              Replay Window
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(['15m', '1h', '6h', '24h'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`py-2 rounded-lg border text-center transition-colors ${
                    preset === p
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 font-bold'
                      : 'bg-slate-950 border-border text-muted hover:text-foreground hover:bg-slate-900'
                  }`}
                >
                  Last {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-muted-dark uppercase tracking-wider text-[11px] mb-1.5">
              Status Filter
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'all', label: 'All Events' },
                { id: 'dead', label: 'Dead (DLQ)' },
                { id: 'succeeded', label: 'Succeeded' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatusFilter(s.id as any)}
                  className={`py-2 rounded-lg border text-center transition-colors ${
                    statusFilter === s.id
                      ? 'bg-brand-500/15 border-brand-500/40 text-brand-400 font-bold'
                      : 'bg-slate-950 border-border text-muted hover:text-foreground hover:bg-slate-900'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-muted hover:text-foreground bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg font-bold bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-slate-950 transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Replaying...' : 'Execute Replay'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
