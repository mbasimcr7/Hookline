'use client';

import React, { useState } from 'react';
import type { Delivery } from '../lib/types';
import { retryDelivery } from '../lib/api';
import { StatusBadge } from './StatusBadge';
import { formatTimestamp } from '../lib/utils';
import {
  X,
  RefreshCw,
  Copy,
  Check,
  AlertCircle,
  Clock,
  Send,
  ExternalLink,
  Code2,
} from 'lucide-react';

interface DeliveryDrawerProps {
  delivery: Delivery | null;
  onClose: () => void;
  onRetried?: () => void;
}

export function DeliveryDrawer({ delivery, onClose, onRetried }: DeliveryDrawerProps) {
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retryResult, setRetryResult] = useState<string | null>(null);

  if (!delivery) return null;

  const handleRetry = async () => {
    try {
      setRetrying(true);
      setRetryResult(null);
      await retryDelivery(delivery.id);
      setRetryResult('Delivery re-queued successfully!');
      if (onRetried) onRetried();
    } catch (err: any) {
      setRetryResult(`Retry failed: ${err.message}`);
    } finally {
      setRetrying(false);
    }
  };

  const copyPayload = () => {
    if (!delivery.event?.payload) return;
    navigator.clipboard.writeText(JSON.stringify(delivery.event.payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end transition-opacity">
      <div className="relative w-full max-w-xl bg-card border-l border-border h-full flex flex-col shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between sticky top-0 bg-card/90 backdrop-blur z-10">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-foreground font-mono">
                Delivery Details
              </h2>
              <StatusBadge status={delivery.status} />
            </div>
            <p className="text-xs font-mono text-muted mt-1">
              ID: <span className="text-foreground">{delivery.id}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-slate-950 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-foreground bg-slate-800/80 hover:bg-slate-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Retry Banner */}
        {retryResult && (
          <div className="mx-6 mt-4 p-3 rounded-lg text-xs font-mono bg-brand-500/10 border border-brand-500/30 text-brand-400 flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{retryResult}</span>
          </div>
        )}

        {/* Content */}
        <div className="p-6 space-y-6 flex-1">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-4 bg-slate-900/60 p-4 rounded-xl border border-border text-xs font-mono">
            <div>
              <span className="text-muted-dark block">Event Type</span>
              <span className="text-foreground font-medium mt-0.5 block">
                {delivery.event?.type || 'unknown'}
              </span>
            </div>
            <div>
              <span className="text-muted-dark block">Endpoint Target</span>
              <span className="text-foreground font-medium mt-0.5 block truncate" title={delivery.endpoint?.url}>
                {delivery.endpoint?.url || delivery.endpointId}
              </span>
            </div>
            <div>
              <span className="text-muted-dark block">Attempt Count</span>
              <span className="text-foreground font-medium mt-0.5 block">
                {delivery.attempts} of {delivery.maxAttempts} max
              </span>
            </div>
            <div>
              <span className="text-muted-dark block">First Created</span>
              <span className="text-foreground font-medium mt-0.5 block">
                {formatTimestamp(delivery.createdAt)}
              </span>
            </div>
          </div>

          {/* Attempt History Timeline */}
          <div>
            <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-dark mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-brand-400" />
              Attempt History ({delivery.attemptLogs?.length || 0})
            </h3>

            <div className="space-y-3 font-mono text-xs">
              {(!delivery.attemptLogs || delivery.attemptLogs.length === 0) ? (
                <div className="p-4 rounded-lg bg-slate-900 border border-border text-center text-muted-dark">
                  No attempt logs recorded yet.
                </div>
              ) : (
                delivery.attemptLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-slate-900/80 border border-border space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold">
                          #{log.attemptNo}
                        </span>
                        <StatusBadge status={log.status} showIcon={false} />
                      </div>
                      <div className="flex items-center gap-3 text-muted-dark">
                        {log.httpStatus && (
                          <span className={log.httpStatus >= 200 && log.httpStatus < 300 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                            HTTP {log.httpStatus}
                          </span>
                        )}
                        <span>{log.durationMs}ms</span>
                        <span>{formatTimestamp(log.attemptedAt).split(',')[1]}</span>
                      </div>
                    </div>

                    {log.error && (
                      <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] break-all">
                        <strong>Error:</strong> {log.error}
                      </div>
                    )}

                    {log.responseSnippet && (
                      <div className="p-2 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[11px] break-all font-mono">
                        <span className="text-muted-dark">Response:</span> {log.responseSnippet}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Event Payload */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-dark flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-cyan-400" />
                Webhook Payload
              </h3>
              <button
                onClick={copyPayload}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-mono text-muted hover:text-foreground bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-slate-950 border border-border text-xs font-mono text-slate-300 overflow-x-auto max-h-60">
              {delivery.event?.payload
                ? JSON.stringify(delivery.event.payload, null, 2)
                : 'No payload data'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
