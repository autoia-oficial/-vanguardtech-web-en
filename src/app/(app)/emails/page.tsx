'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { Card, Spinner, Empty, StatusChip, timeAgo } from '@/components/ui';

interface Email {
  id: number; lead_id: number; to_email: string; subject: string; status: string;
  attempts: number; sent_at: string | null; created_at: string;
  last_error: string | null; blocked_reason: string | null; provider_message_id: string | null;
}

const STATUSES = ['', 'PENDING', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'];

export default function EmailsPage() {
  const [status, setStatus] = useState('');
  const { data, error, loading } = useApi<{ data: Email[] }>(
    `/api/emails?limit=100${status ? `&status=${status}` : ''}`,
  );

  return (
    <div className="space-y-6 vg-enter">
      <header>
        <h1 className="text-xl sm:text-2xl font-light tracking-tight">Emails</h1>
        <p className="text-sm text-muted mt-1">
          SENT means the provider confirmed the message. Nothing is marked sent before that.
        </p>
      </header>

      <Card padded={false}>
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <select className="vg-input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </div>

        {loading ? <Spinner /> : error ? (
          <p className="p-5 text-sm" style={{ color: 'var(--bad)' }}>{error}</p>
        ) : !data || data.data.length === 0 ? (
          <Empty title="No email in the queue." detail="Email appears here once a campaign queues it." />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {data.data.map((e) => (
              <li key={e.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/leads/${e.lead_id}`} className="text-sm font-medium hover:underline">
                    {e.subject}
                  </Link>
                  <p className="text-xs text-faint mt-0.5 break-all">{e.to_email}</p>
                  {e.blocked_reason ? (
                    <p className="text-xs mt-1" style={{ color: 'var(--warn)' }}>Blocked: {e.blocked_reason}</p>
                  ) : null}
                  {e.last_error ? <p className="text-xs text-faint mt-1 break-words">{e.last_error}</p> : null}
                  {e.provider_message_id ? (
                    <p className="text-xs text-faint mt-1 font-mono break-all">id: {e.provider_message_id}</p>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <StatusChip status={e.status} />
                  <p className="text-xs text-faint mt-1">
                    {e.sent_at ? `sent ${timeAgo(e.sent_at)}` : `queued ${timeAgo(e.created_at)}`}
                  </p>
                  {e.attempts > 0 ? <p className="text-xs text-faint">{e.attempts} attempt(s)</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
