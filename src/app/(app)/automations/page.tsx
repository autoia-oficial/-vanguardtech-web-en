'use client';

import { useState } from 'react';
import { useApi, mutate } from '@/hooks/useApi';
import { Card, Spinner, Empty, StatusChip, timeAgo, formatDate } from '@/components/ui';

interface Automation {
  id: number; key: string; name: string; description: string | null; status: string;
  last_run: string | null; schedule: string | null;
  last_run_detail: { processed: number; success: number; failed: number; skipped: number; status: string; started_at: string; completed_at: string | null } | null;
  totals: { processed: number; success: number; failed: number; skipped: number };
}

export default function AutomationsPage() {
  const { data, error, loading, reload } = useApi<{ data: Automation[] }>('/api/automations');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const act = async (key: string, action: 'pause' | 'resume' | 'run') => {
    setBusy(key); setMessage(null);
    const res = await mutate(`/api/automations/${key}`, 'POST', { action });
    setBusy(null);
    if (!res.ok) {
      setMessage(res.error === 'LOCKED'
        ? `"${key}" is already running — not started a second time.`
        : (res.error ?? 'Failed.'));
    } else if (action === 'run') {
      const counters = (res.data as { counters?: Record<string, number> })?.counters;
      setMessage(counters
        ? `${key}: processed ${counters.processed}, succeeded ${counters.success}, failed ${counters.failed}, skipped ${counters.skipped}.`
        : `${key} finished.`);
    }
    reload();
  };

  if (loading) return <Spinner />;
  if (error) return <Card><p className="text-sm" style={{ color: 'var(--bad)' }}>{error}</p></Card>;

  return (
    <div className="space-y-6 vg-enter">
      <header>
        <h1 className="text-xl sm:text-2xl font-light tracking-tight">Automations</h1>
        <p className="text-sm text-muted mt-1">
          Each job takes a lock before it runs, so a manual run cannot collide with a scheduled one.
        </p>
      </header>

      {message ? (
        <div className="vg-card p-3.5 text-sm text-muted">{message}</div>
      ) : null}

      {!data || data.data.length === 0 ? (
        <Empty title="No automations registered." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.data.map((a) => (
            <Card key={a.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium">{a.name}</h2>
                  <p className="text-xs text-faint mt-0.5 font-mono">{a.key}</p>
                </div>
                <StatusChip status={a.status} />
              </div>

              {a.description ? <p className="mt-3 text-xs text-muted">{a.description}</p> : null}

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div><dt className="vg-label">Schedule</dt><dd className="mt-0.5 font-mono">{a.schedule ?? '—'}</dd></div>
                <div><dt className="vg-label">Last run</dt><dd className="mt-0.5">{timeAgo(a.last_run)}</dd></div>
                <div><dt className="vg-label">Processed</dt><dd className="mt-0.5 tabular-nums">{a.totals.processed}</dd></div>
                <div><dt className="vg-label">Succeeded</dt><dd className="mt-0.5 tabular-nums">{a.totals.success}</dd></div>
                <div><dt className="vg-label">Failed</dt><dd className="mt-0.5 tabular-nums">{a.totals.failed}</dd></div>
                <div><dt className="vg-label">Skipped</dt><dd className="mt-0.5 tabular-nums">{a.totals.skipped}</dd></div>
              </dl>

              {a.last_run_detail ? (
                <p className="mt-3 text-xs text-faint">
                  Last: {a.last_run_detail.status} · started {formatDate(a.last_run_detail.started_at)}
                </p>
              ) : null}

              <div className="mt-4 flex gap-2">
                <button className="vg-btn flex-1" disabled={busy === a.key} onClick={() => act(a.key, 'run')}>
                  {busy === a.key ? 'Running…' : 'Run now'}
                </button>
                <button
                  className="vg-btn flex-1"
                  disabled={busy === a.key}
                  onClick={() => act(a.key, a.status === 'ACTIVE' ? 'pause' : 'resume')}
                >
                  {a.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
