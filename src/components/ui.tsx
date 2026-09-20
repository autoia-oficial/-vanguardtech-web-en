'use client';

import { type ReactNode } from 'react';

/** Shared presentational primitives, kept deliberately small and neutral. */

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`vg-card ${padded ? 'p-5' : ''} ${className}`}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="text-[0.9375rem] font-medium tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="vg-card p-4 sm:p-5">
      <p className="vg-label">{label}</p>
      <p className="mt-2 text-2xl sm:text-3xl font-light tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  PASS: 'var(--ok)',
  WARNING: 'var(--warn)',
  FAIL: 'var(--bad)',
  NOT_VERIFIED: 'var(--idle)',
  SENT: 'var(--ok)',
  DELIVERED: 'var(--ok)',
  OPENED: 'var(--ok)',
  REPLIED: 'var(--ok)',
  PENDING: 'var(--warn)',
  QUEUED: 'var(--warn)',
  SENDING: 'var(--warn)',
  FAILED: 'var(--bad)',
  BOUNCED: 'var(--bad)',
  CANCELLED: 'var(--idle)',
  ACTIVE: 'var(--ok)',
  PAUSED: 'var(--warn)',
  COMPLETED: 'var(--idle)',
  DRAFT: 'var(--idle)',
  RUNNING: 'var(--warn)',
  CONFIGURED: 'var(--ok)',
  NOT_CONFIGURED: 'var(--warn)',
  critical: 'var(--bad)',
  high: 'var(--warn)',
  medium: 'var(--idle)',
  low: 'var(--text-faint)',
};

export function tone(status: string | null | undefined): string {
  if (!status) return 'var(--idle)';
  return STATUS_TONE[status] ?? 'var(--idle)';
}

export function StatusChip({ status, children }: { status: string; children?: ReactNode }) {
  const color = tone(status);
  return (
    <span
      className="vg-chip"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
        style={{ background: color }}
      />
      {children ?? status}
    </span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="flex items-center gap-2 min-w-[7rem]">
      <div
        className="h-1 flex-1 rounded-full overflow-hidden"
        style={{ background: 'var(--border)' }}
        role="img"
        aria-label={`Score ${clamped} of 100`}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${clamped}%`,
            background:
              clamped >= 80 ? 'var(--ok)' : clamped >= 50 ? 'var(--warn)' : 'var(--text-faint)',
          }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted w-7 text-right">{clamped}</span>
    </div>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm text-muted">{title}</p>
      {detail ? <p className="mt-1.5 text-xs text-faint max-w-md mx-auto">{detail}</p> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-muted" role="status">
      <span
        className="vg-spin inline-block h-4 w-4 rounded-full border-2 border-transparent"
        style={{ borderTopColor: 'var(--text-muted)', borderRightColor: 'var(--text-muted)' }}
      />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

/**
 * Banner for an integration that is not wired up. Names the missing variable so
 * the reader knows exactly what to set, rather than just that something failed.
 */
export function NotConfigured({
  label,
  missing,
  detail,
}: {
  label: string;
  missing: string[];
  detail?: string;
}) {
  return (
    <div
      className="vg-card p-4 flex flex-wrap items-start gap-x-3 gap-y-2"
      style={{ borderColor: 'color-mix(in srgb, var(--warn) 35%, transparent)' }}
    >
      <StatusChip status="NOT_CONFIGURED">NOT CONFIGURED</StatusChip>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
        {missing.length > 0 ? (
          <p className="mt-1.5 text-xs text-faint font-mono break-all">
            Missing: {missing.join(', ')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) return '—';
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return ms > 0 ? `${mins}m ago` : `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return ms > 0 ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return ms > 0 ? `${days}d ago` : `in ${days}d`;
  return d.toISOString().slice(0, 10);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
