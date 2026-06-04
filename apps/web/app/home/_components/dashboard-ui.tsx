'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@kit/ui/utils';

export const ACCENT = '#06b6d4'; // EVA IQ teal
export const ACCENT_2 = '#f97316'; // EVA IQ orange

export type Point = { label: string; v: number };

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '');

/** Plai-style KPI tile: big number, optional delta, optional sparkline. */
export function MetricTile({
  label,
  value,
  delta,
  deltaGood,
  series,
  accent = ACCENT,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaGood?: boolean;
  series?: Point[];
  accent?: string;
}) {
  const id = safeId(label);
  return (
    <div className={'bg-card rounded-xl border p-4 shadow-sm'}>
      <p className={'text-muted-foreground text-xs font-medium'}>{label}</p>
      <div className={'mt-0.5 flex items-end justify-between gap-2'}>
        <p className={'text-2xl font-bold tracking-tight'}>{value}</p>
        {delta ? (
          <span
            className={cn(
              'text-xs font-semibold',
              deltaGood ? 'text-green-600' : 'text-red-600',
            )}
          >
            {delta}
          </span>
        ) : null}
      </div>
      {series && series.length > 1 ? (
        <div className={'mt-2 h-10'}>
          <ResponsiveContainer width={'100%'} height={'100%'}>
            <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad${id}`} x1={'0'} y1={'0'} x2={'0'} y2={'1'}>
                  <stop offset={'0%'} stopColor={accent} stopOpacity={0.35} />
                  <stop offset={'100%'} stopColor={accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type={'monotone'} dataKey={'v'} stroke={accent} strokeWidth={2} fill={`url(#grad${id})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}

export function MiniSparkline({ series, accent = ACCENT }: { series: Point[]; accent?: string }) {
  if (series.length < 2) return null;
  return (
    <div className={'h-8 w-full'}>
      <ResponsiveContainer width={'100%'} height={'100%'}>
        <LineChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Line type={'monotone'} dataKey={'v'} stroke={accent} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Primary performance chart. */
export function PerfChart({
  series,
  height = 220,
  label = 'ROAS',
  accent = ACCENT,
}: {
  series: Point[];
  height?: number;
  label?: string;
  accent?: string;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width={'100%'} height={'100%'}>
        <AreaChart data={series} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id={'perfGrad'} x1={'0'} y1={'0'} x2={'0'} y2={'1'}>
              <stop offset={'0%'} stopColor={accent} stopOpacity={0.3} />
              <stop offset={'100%'} stopColor={accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray={'3 3'} vertical={false} opacity={0.3} />
          <XAxis dataKey={'label'} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis fontSize={11} tickLine={false} axisLine={false} width={34} />
          <Tooltip formatter={(v: number) => [`${Number(v).toFixed(1)}x`, label]} />
          <Area type={'monotone'} dataKey={'v'} stroke={accent} strokeWidth={2.5} fill={'url(#perfGrad)'} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral';
}) {
  const tones: Record<string, string> = {
    good: 'bg-green-50 text-green-600 dark:bg-green-500/15',
    warn: 'bg-orange-50 text-orange-500 dark:bg-orange-500/15',
    bad: 'bg-red-50 text-red-600 dark:bg-red-500/15',
    info: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15',
    neutral: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone])}>
      {label}
    </span>
  );
}
