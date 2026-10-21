'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/utils';
import {
  LayoutDashboard,
  Send,
  Network,
  Skull,
  Activity,
  Layers,
  Database,
  ShieldAlert,
} from 'lucide-react';

const NAV_ITEMS = [
  {
    name: 'Overview',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    name: 'Deliveries',
    href: '/deliveries',
    icon: Send,
  },
  {
    name: 'Endpoints',
    href: '/endpoints',
    icon: Network,
  },
  {
    name: 'Dead Letter Queue',
    href: '/dlq',
    icon: Skull,
    badge: 'DLQ',
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 flex flex-col justify-between bg-card/60 backdrop-blur-md border-r border-border shrink-0 min-h-[calc(100vh-4rem)]">
      {/* Navigation Links */}
      <div className="p-4 space-y-1">
        <div className="px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-muted-dark">
          Platform
        </div>

        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group',
                isActive
                  ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20 shadow-glow'
                  : 'text-muted hover:text-foreground hover:bg-card-hover border border-transparent'
              )}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={cn(
                    'w-4 h-4 transition-colors',
                    isActive ? 'text-brand-400' : 'text-slate-400 group-hover:text-foreground'
                  )}
                />
                <span>{item.name}</span>
              </div>

              {item.badge && (
                <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-rose-500/15 text-rose-400 border border-rose-500/30">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* System Infrastructure Card at bottom of sidebar */}
      <div className="p-4 m-3 rounded-xl bg-slate-900/80 border border-border space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase text-muted-dark tracking-wider flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-brand-400" />
            Infra Topology
          </span>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>

        <div className="space-y-1.5 text-xs font-mono">
          <div className="flex items-center justify-between text-muted">
            <span className="flex items-center gap-1.5">
              <Database className="w-3 h-3 text-cyan-400" />
              Postgres 16
            </span>
            <span className="text-emerald-400">Primary DB</span>
          </div>

          <div className="flex items-center justify-between text-muted">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-rose-400" />
              Redis 7
            </span>
            <span className="text-slate-300">Rate/CB/SSE</span>
          </div>

          <div className="flex items-center justify-between text-muted">
            <span className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-amber-400" />
              RabbitMQ
            </span>
            <span className="text-slate-300">5-Tier Work Q</span>
          </div>

          <div className="flex items-center justify-between text-muted">
            <span className="flex items-center gap-1.5">
              <ShieldAlert className="w-3 h-3 text-purple-400" />
              Kafka KRaft
            </span>
            <span className="text-slate-300">Analytics Stream</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
