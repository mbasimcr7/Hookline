'use client';

import React, { useState, useEffect } from 'react';
import { getDeliveries, retryDelivery } from '../../lib/api';
import type { Delivery } from '../../lib/types';
import { StatusBadge } from '../../components/StatusBadge';
import { DeliveryDrawer } from '../../components/DeliveryDrawer';
import { formatTimestamp, truncate } from '../../lib/utils';
import {
  Skull,
  RotateCcw,
  RefreshCw,
  AlertOctagon,
  Check,
  CheckSquare,
  Square,
  ShieldAlert,
} from 'lucide-react';

export default function DlqPage() {
  const [deadDeliveries, setDeadDeliveries] = useState<Delivery[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const loadDlq = async () => {
    try {
      setLoading(true);
      const res = await getDeliveries({ status: 'dead', limit: 50 });
      setDeadDeliveries(res.data || []);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Failed to load DLQ deliveries', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDlq();
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.size === deadDeliveries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deadDeliveries.map((d) => d.id)));
    }
  };

  const toggleSelectOne = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = new Set(selectedIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedIds(updated);
  };

  const handleBulkRetry = async () => {
    if (selectedIds.size === 0) return;
    try {
      setBulkRetrying(true);
      setResultMessage(null);
      const ids = Array.from(selectedIds);
      let successCount = 0;

      for (const id of ids) {
        try {
          await retryDelivery(id);
          successCount++;
        } catch (err) {
          console.error(`Failed to retry delivery ${id}`, err);
        }
      }

      setResultMessage(`Successfully re-queued ${successCount} dead deliveries to RabbitMQ!`);
      await loadDlq();
    } catch (err: any) {
      setResultMessage(`Bulk retry error: ${err.message}`);
    } finally {
      setBulkRetrying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold font-mono tracking-tight text-foreground">
              Dead Letter Queue (DLQ)
            </h1>
            <span className="px-2 py-0.5 text-xs font-mono rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 font-bold">
              {deadDeliveries.length} Dead
            </span>
          </div>
          <p className="text-sm text-muted mt-1">
            Permanent delivery failures after 6 exponential backoff retry tiers or unrecoverable HTTP rejections.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadDlq}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-muted hover:text-foreground bg-card hover:bg-card-hover border border-border transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            disabled={selectedIds.size === 0 || bulkRetrying}
            onClick={handleBulkRetry}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-mono font-bold text-slate-950 bg-rose-500 hover:bg-rose-400 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${bulkRetrying ? 'animate-spin' : ''}`} />
            {bulkRetrying
              ? 'Retrying...'
              : `Bulk Retry (${selectedIds.size} Selected)`}
          </button>
        </div>
      </div>

      {/* Result feedback */}
      {resultMessage && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-mono text-xs flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{resultMessage}</span>
        </div>
      )}

      {/* Info card */}
      <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="text-xs font-mono text-slate-300 space-y-1">
          <p className="font-semibold text-rose-300">How the Dead Letter Queue Works</p>
          <p className="text-muted">
            Deliveries transit through 5 fixed-TTL backoff queues (`delivery.retry.1` to `5`) on RabbitMQ.
            If all 6 attempts fail or timeout (&gt;10s), the worker rejects the message into <code>delivery.dlq</code>.
            Bulk retry creates fresh delivery records and dispatches them back into <code>delivery.work</code>.
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/60 text-muted-dark border-b border-border uppercase tracking-wider">
              <tr>
                <th className="p-3.5 w-10 text-center">
                  <button
                    onClick={toggleSelectAll}
                    className="text-muted hover:text-foreground"
                    title="Select all"
                  >
                    {deadDeliveries.length > 0 && selectedIds.size === deadDeliveries.length ? (
                      <CheckSquare className="w-4 h-4 text-rose-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="p-3.5">Delivery ID</th>
                <th className="p-3.5">Event Type</th>
                <th className="p-3.5">Total Attempts</th>
                <th className="p-3.5">Destination URL</th>
                <th className="p-3.5">Last Error</th>
                <th className="p-3.5">Failed At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {deadDeliveries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-muted-dark">
                    <Skull className="w-8 h-8 mx-auto mb-2 opacity-30 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">Dead Letter Queue is empty!</span>
                    <p className="text-[11px] mt-1 text-slate-500">
                      All webhooks are delivering successfully or actively retrying.
                    </p>
                  </td>
                </tr>
              ) : (
                deadDeliveries.map((d) => {
                  const isSelected = selectedIds.has(d.id);
                  const lastAttempt = d.attemptLogs?.[d.attemptLogs.length - 1];

                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedDelivery(d)}
                      className={`hover:bg-card-hover cursor-pointer transition-colors group ${
                        isSelected ? 'bg-rose-500/5' : ''
                      }`}
                    >
                      <td
                        className="p-3.5 text-center"
                        onClick={(e) => toggleSelectOne(d.id, e)}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-rose-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                        )}
                      </td>
                      <td className="p-3.5 font-medium text-foreground group-hover:text-rose-400">
                        {truncate(d.id, 18)}
                      </td>
                      <td className="p-3.5 text-muted">{d.event?.type || '—'}</td>
                      <td className="p-3.5 text-rose-400 font-bold">
                        {d.attempts} / {d.maxAttempts}
                      </td>
                      <td className="p-3.5 text-muted truncate max-w-xs" title={d.endpoint?.url}>
                        {d.endpoint?.url || truncate(d.endpointId, 16)}
                      </td>
                      <td className="p-3.5 text-rose-300 text-[11px] truncate max-w-xs" title={lastAttempt?.error || ''}>
                        {lastAttempt?.error || 'Max retry budget exhausted'}
                      </td>
                      <td className="p-3.5 text-muted-dark">
                        {formatTimestamp(d.updatedAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer */}
      <DeliveryDrawer
        delivery={selectedDelivery}
        onClose={() => setSelectedDelivery(null)}
        onRetried={loadDlq}
      />
    </div>
  );
}
