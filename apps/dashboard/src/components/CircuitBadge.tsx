import React from 'react';
import { cn } from '../lib/utils';
import { ShieldCheck, ShieldAlert, ShieldMinus } from 'lucide-react';

interface CircuitBadgeProps {
  state?: 'closed' | 'open' | 'half_open' | string;
  className?: string;
}

export function CircuitBadge({ state = 'closed', className }: CircuitBadgeProps) {
  switch (state) {
    case 'closed':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium',
            'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
            className
          )}
          title="Circuit closed: Endpoint healthy, accepting full traffic"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          closed (healthy)
        </span>
      );

    case 'open':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium',
            'bg-rose-500/15 text-rose-400 border border-rose-500/40 shadow-glow-danger animate-pulse',
            className
          )}
          title="Circuit open: 5+ consecutive failures, skipping deliveries to prevent hammering"
        >
          <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          OPEN (tripped)
        </span>
      );

    case 'half_open':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium',
            'bg-amber-500/15 text-amber-400 border border-amber-500/30',
            className
          )}
          title="Circuit half-open: Probing endpoint with test request"
        >
          <ShieldMinus className="w-3.5 h-3.5 text-amber-400" />
          half-open (probing)
        </span>
      );

    default:
      return (
        <span className={cn('text-xs font-mono text-slate-400', className)}>
          {state}
        </span>
      );
  }
}
