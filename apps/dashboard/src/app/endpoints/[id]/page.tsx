'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getEndpoint, getEndpointStats, getDeliveries } from '../../../lib/api';
import type { Endpoint, EndpointMinuteStat, Delivery } from '../../../lib/types';
import { CircuitBadge } from '../../../components/CircuitBadge';
import { StatusBadge } from '../../../components/StatusBadge';
import { DeliveryDrawer } from '../../../components/DeliveryDrawer';
import { formatTimestamp, truncate } from '../../../lib/utils';
import {
  ArrowLeft,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export default function EndpointDetailPage() {
  const params = useParams();
  const endpointId = params.id as string;

  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [stats, setStats] = useState<EndpointMinuteStat[]>([]);
  const [recentDeliveries, setRecentDeliveries] = useState<Delivery[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const [epRes, statsRes, delRes] = await Promise.all([
        getEndpoint(endpointId),
        getEndpointStats(endpointId, '1h'),
        getDeliveries({ endpointId, limit: 10 }),
      ]);

      setEndpoint(epRes);
      setStats(statsRes.data || []);
      setRecentDeliveries(delRes.data || []);
    } catch (err) {
      console.error('Failed to load endpoint detail', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [endpointId]);

  if (!endpoint && !loading) {
    return (
      <div className="p-12 text-center text-muted font-mono">
        <p>Endpoint not found.</p>
        <Link href="/endpoints" className="text-brand-400 mt-2 inline-block">
          &larr; Back to Endpoints
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button & Title */}
      <div>
        <Link
          href="/endpoints"
          className="inline-flex items-center gap-1.5 text-xs font-mono text-muted hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to all endpoints
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold font-mono tracking-tight text-foreground">
                {endpoint?.url || 'Endpoint Analytics'}
              </h1>
              <CircuitBadge state={endpoint?.circuitState || 'closed'} />
            </div>
            <p className="text-xs font-mono text-muted mt-1">
              ID: <code>{endpointId}</code> • Subscribed: {endpoint?.eventTypes.join(', ') || '*'}
            </p>
          </div>

          <button
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-muted hover:text-foreground bg-card hover:bg-card-hover border border-border transition-colors self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Success vs Failures */}
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold font-mono text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-brand-400" />
                Delivery Volume & Success Rate
              </h3>
              <p className="text-xs text-muted mt-0.5">1-minute time buckets (Kafka analytics feed)</p>
            </div>
          </div>

          <div className="h-64 w-full">
            {stats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="epSuccess" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22C55E" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#22C55E" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="bucket"
                    tickFormatter={(val) => val.split('T')[1]?.slice(0, 5) || val}
                    stroke="#475569"
                    fontSize={11}
                    fontFamily="monospace"
                  />
                  <YAxis stroke="#475569" fontSize={11} fontFamily="monospace" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                    }}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="successes"
                    name="Successes"
                    stroke="#22C55E"
                    strokeWidth={2}
                    fill="url(#epSuccess)"
                  />
                  <Area
                    type="monotone"
                    dataKey="failures"
                    name="Failures"
                    stroke="#EF4444"
                    strokeWidth={1.5}
                    fill="#EF4444"
                    fillOpacity={0.1}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-dark font-mono text-xs">
                <Activity className="w-8 h-8 mb-2 opacity-30" />
                <span>No delivery events recorded in the last 1 hour.</span>
              </div>
            )}
          </div>
        </div>

        {/* Chart 2: Latency Time Series */}
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold font-mono text-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                Delivery Latency (ms)
              </h3>
              <p className="text-xs text-muted mt-0.5">Average and maximum response duration</p>
            </div>
          </div>

          <div className="h-64 w-full">
            {stats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis
                    dataKey="bucket"
                    tickFormatter={(val) => val.split('T')[1]?.slice(0, 5) || val}
                    stroke="#475569"
                    fontSize={11}
                    fontFamily="monospace"
                  />
                  <YAxis stroke="#475569" fontSize={11} fontFamily="monospace" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="latencyAvgMs"
                    name="Avg Latency (ms)"
                    stroke="#38BDF8"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="latencyMaxMs"
                    name="Max Latency (ms)"
                    stroke="#F59E0B"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-dark font-mono text-xs">
                <Clock className="w-8 h-8 mb-2 opacity-30" />
                <span>No latency samples available yet.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Deliveries to this endpoint */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold font-mono text-foreground">
            Recent Deliveries to this Destination
          </h3>
          <span className="text-xs font-mono text-muted-dark">
            Showing last 10 attempts
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/60 text-muted-dark border-b border-border uppercase tracking-wider">
              <tr>
                <th className="p-3">Delivery ID</th>
                <th className="p-3">Event Type</th>
                <th className="p-3">Status</th>
                <th className="p-3">Attempts</th>
                <th className="p-3">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {recentDeliveries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-dark">
                    No deliveries found for this endpoint.
                  </td>
                </tr>
              ) : (
                recentDeliveries.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedDelivery(d)}
                    className="hover:bg-card-hover cursor-pointer transition-colors group"
                  >
                    <td className="p-3 font-medium text-foreground group-hover:text-brand-400">
                      {truncate(d.id, 18)}
                    </td>
                    <td className="p-3 text-muted">{d.event?.type || '—'}</td>
                    <td className="p-3">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="p-3 text-muted">
                      {d.attempts} / {d.maxAttempts}
                    </td>
                    <td className="p-3 text-muted-dark">
                      {formatTimestamp(d.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer */}
      <DeliveryDrawer
        delivery={selectedDelivery}
        onClose={() => setSelectedDelivery(null)}
        onRetried={loadData}
      />
    </div>
  );
}
