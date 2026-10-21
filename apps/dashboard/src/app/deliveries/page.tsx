'use client';

import React, { useState, useEffect } from 'react';
import { getDeliveries, getEndpoints } from '../../lib/api';
import type { Delivery, Endpoint } from '../../lib/types';
import { StatusBadge } from '../../components/StatusBadge';
import { DeliveryDrawer } from '../../components/DeliveryDrawer';
import { formatTimestamp, truncate } from '../../lib/utils';
import {
  Send,
  Filter,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export default function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [endpointFilter, setEndpointFilter] = useState<string>('');
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const loadDeliveries = async () => {
    try {
      setLoading(true);
      const [delRes, epRes] = await Promise.all([
        getDeliveries({
          status: statusFilter || undefined,
          endpointId: endpointFilter || undefined,
          limit,
          offset: (page - 1) * limit,
        }),
        getEndpoints(),
      ]);

      setDeliveries(delRes.data || []);
      setTotal(delRes.total || 0);
      setEndpoints(epRes.data || []);
    } catch (err) {
      console.error('Failed to load deliveries', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeliveries();
  }, [statusFilter, endpointFilter, page]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tight text-foreground">
            Webhook Deliveries
          </h1>
          <p className="text-sm text-muted mt-1">
            Complete log of outgoing webhook attempts, latency, payloads, and response codes.
          </p>
        </div>

        <button
          onClick={loadDeliveries}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-muted hover:text-foreground bg-card hover:bg-card-hover border border-border transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-card p-4 rounded-xl border border-border flex flex-wrap items-center gap-4 text-xs font-mono">
        <div className="flex items-center gap-2 text-muted-dark">
          <Filter className="w-3.5 h-3.5" />
          <span>Filters:</span>
        </div>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="bg-slate-950 border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-brand-500/60"
        >
          <option value="">All Statuses</option>
          <option value="succeeded">Succeeded</option>
          <option value="retrying">Retrying</option>
          <option value="pending">Pending</option>
          <option value="dead">Dead (DLQ)</option>
        </select>

        {/* Endpoint Filter */}
        <select
          value={endpointFilter}
          onChange={(e) => {
            setEndpointFilter(e.target.value);
            setPage(1);
          }}
          className="bg-slate-950 border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-brand-500/60"
        >
          <option value="">All Endpoints</option>
          {endpoints.map((ep) => (
            <option key={ep.id} value={ep.id}>
              {truncate(ep.url, 28)}
            </option>
          ))}
        </select>

        {(statusFilter || endpointFilter) && (
          <button
            onClick={() => {
              setStatusFilter('');
              setEndpointFilter('');
              setPage(1);
            }}
            className="text-brand-400 hover:underline text-[11px]"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto text-muted-dark text-[11px]">
          Showing {deliveries.length} of {total} records
        </div>
      </div>

      {/* Deliveries Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/60 text-muted-dark border-b border-border uppercase tracking-wider">
              <tr>
                <th className="p-3.5">Delivery ID</th>
                <th className="p-3.5">Event Type</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Attempts</th>
                <th className="p-3.5">Destination URL</th>
                <th className="p-3.5">Next Retry</th>
                <th className="p-3.5">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-dark">
                    {loading ? 'Loading deliveries...' : 'No webhook deliveries found matching criteria.'}
                  </td>
                </tr>
              ) : (
                deliveries.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedDelivery(d)}
                    className="hover:bg-card-hover cursor-pointer transition-colors group"
                  >
                    <td className="p-3.5 font-medium text-foreground group-hover:text-brand-400 transition-colors">
                      {truncate(d.id, 18)}
                    </td>
                    <td className="p-3.5 text-muted">{d.event?.type || '—'}</td>
                    <td className="p-3.5">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="p-3.5 text-muted">
                      {d.attempts} / {d.maxAttempts}
                    </td>
                    <td className="p-3.5 text-muted truncate max-w-xs" title={d.endpoint?.url}>
                      {d.endpoint?.url || truncate(d.endpointId, 16)}
                    </td>
                    <td className="p-3.5 text-muted-dark">
                      {d.nextRetryAt ? formatTimestamp(d.nextRetryAt) : '—'}
                    </td>
                    <td className="p-3.5 text-muted-dark">
                      {formatTimestamp(d.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > limit && (
          <div className="p-4 border-t border-border flex items-center justify-between text-xs font-mono">
            <span className="text-muted-dark">
              Page {page} of {Math.ceil(total / limit)}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="p-1.5 rounded-lg border border-border bg-slate-900 disabled:opacity-30 hover:bg-slate-800 text-muted hover:text-foreground"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={page >= Math.ceil(total / limit)}
                onClick={() => setPage(page + 1)}
                className="p-1.5 rounded-lg border border-border bg-slate-900 disabled:opacity-30 hover:bg-slate-800 text-muted hover:text-foreground"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Drawer */}
      <DeliveryDrawer
        delivery={selectedDelivery}
        onClose={() => setSelectedDelivery(null)}
        onRetried={loadDeliveries}
      />
    </div>
  );
}
