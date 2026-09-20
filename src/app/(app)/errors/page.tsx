'use client';

import { useState } from 'react';
import { useApi, mutate } from '@/hooks/useApi';
import { Card, Spinner, Empty, timeAgo, formatDate } from '@/components/ui';

interface ErrorRow {
  id: number; error_type: string; message: string; lead_id: number | null;
  retry_count: number; next_retry_at: string | null; resolved: boolean; created_at: string;
  context: unknown;
}

export default function ErrorsPage() {
  const [resolved, setResolved] = useState(false);
  const { data, error, loading, reload } = useApi<{ data: ErrorRow[] }>(
    `/api/errors?resolved=${resolved}&limit=100`,
  );
  const [busy, setBusy] = useState<number | null>(null);

  const setResolvedFlag = async (id: number, value: boolean) => {
    setBusy(id);
    await mutate('/api/errors', 'PATCH', { id, resolved: value });
    setBusy(null);
    reload();
  };

  return (
    <div className="space-y-6 vg-enter">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-light tracking-tight">Errors</h1>
          <p className="text-sm text-muted mt-1">
            A failure on one lead is recorded here and never stops the rest of the queue.
          </p>
        </div>
        <button className="vg-btn" onClick={() => setResolved((v) => !v)}>
          {resolved ? 'Show open' : 'Show resolved'}
        </button>
      </header>

      <Card padded={false}>
        {loading ? <Spinner /> : error ? (
          <p className="p-5 text-sm" style={{ color: 'var(--bad)' }}>{error}</p>
        ) : !data || data.data.length === 0 ? (
          <Empty title={resolved ? 'Nothing resolved yet.' : 'No open errors.'} />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {data.data.map((e) => (
              <li key={e.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{e.error_type}</p>
                  <p className="text-xs text-muted mt-1 break-words">{e.message}</p>
                  <p className="text-xs text-faint mt-1">
                    {timeAgo(e.created_at)}
                    {e.lead_id ? ` · lead ${e.lead_id}` : ''}
                    {e.retry_count > 0 ? ` · ${e.retry_count} retries` : ''}
                    {e.next_retry_at ? ` · next ${formatDate(e.next_retry_at)}` : ''}
                  </p>
                </div>
                <button className="vg-btn" disabled={busy === e.id} onClick={() => setResolvedFlag(e.id, !e.resolved)}>
                  {e.resolved ? 'Reopen' : 'Resolve'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
