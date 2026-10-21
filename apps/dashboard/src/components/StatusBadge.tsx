import React from 'react';
import type { DeliveryStatus } from '../lib/types';
import { cn } from '../lib/utils';
import { CheckCircle2, Clock, AlertTriangle, Skull } from 'lucide-react';

interface StatusBadgeProps {
  status: DeliveryStatus | string;
  className?: string;
  showIcon?: boolean;
}

export function StatusBadge({ status, className, showIcon = true }: StatusBadgeProps) {
  const normStatus = (status || '').toLowerCase();

  switch (normStatus) {
    case 'succeeded':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium',
            'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-glow',
            className
          )}
        >
          {showIcon && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
          succeeded
        </span>
      );

    case 'pending':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium',
            'bg-blue-500/10 text-blue-400 border border-blue-500/20',
            className
          )}
        >
          {showIcon && <Clock className="w-3.5 h-3.5 text-blue-400 animate-pulse" />}
          pending
        </span>
      );

    case 'retrying':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium',
            'bg-amber-500/10 text-amber-400 border border-amber-500/20',
            className
          )}
        >
          {showIcon && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
          retrying
        </span>
      );

    case 'dead':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium',
            'bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-glow-danger',
            className
          )}
        >
          {showIcon && <Skull className="w-3.5 h-3.5 text-rose-400" />}
          dead (DLQ)
        </span>
      );

    default:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium',
            'bg-slate-800 text-slate-300 border border-slate-700',
            className
          )}
        >
          {status}
        </span>
      );
  }
}
