import React from 'react';
import { cn } from '../lib/utils';
import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'cyan';
  trend?: {
    value: string;
    isPositive?: boolean;
  };
}

export function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = 'default',
  trend,
}: KpiCardProps) {
  const getGlow = () => {
    switch (variant) {
      case 'success':
        return 'border-emerald-500/20 hover:border-emerald-500/40 hover:shadow-glow';
      case 'danger':
        return 'border-rose-500/20 hover:border-rose-500/40 hover:shadow-glow-danger';
      case 'cyan':
        return 'border-cyan-500/20 hover:border-cyan-500/40 hover:shadow-glow-cyan';
      case 'warning':
        return 'border-amber-500/20 hover:border-amber-500/40';
      default:
        return 'border-border hover:border-border-light';
    }
  };

  const getIconColor = () => {
    switch (variant) {
      case 'success':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'danger':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      case 'cyan':
        return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
      case 'warning':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      default:
        return 'text-slate-400 bg-slate-800 border-slate-700';
    }
  };

  return (
    <div
      className={cn(
        'relative bg-card rounded-xl p-5 border transition-all duration-200 group',
        getGlow()
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">
          {title}
        </span>
        <div className={cn('p-2 rounded-lg border', getIconColor())}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
          {value}
        </span>
        {trend && (
          <span
            className={cn(
              'text-xs font-mono font-medium',
              trend.isPositive ? 'text-emerald-400' : 'text-rose-400'
            )}
          >
            {trend.value}
          </span>
        )}
      </div>

      {subtitle && (
        <p className="mt-1 text-xs text-muted-dark">{subtitle}</p>
      )}
    </div>
  );
}
