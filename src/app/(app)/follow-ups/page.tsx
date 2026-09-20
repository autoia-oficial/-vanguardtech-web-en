'use client';

import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { Card, Spinner, Empty, StatusChip, formatDate } from '@/components/ui';

interface FollowUp {
  id: number; lead_id: number; campaign_id: number | null; sequence_number: number;
  status: string; scheduled_at: string; sent_at: string | null; cancel_reason: string | null;
}

export default function FollowUpsPage() {
  const { data, error, loading } = useApi<{ data: FollowUp[] }>('/api/follow-ups?limit=100');

  return (
    <div className="space-y-6 vg-enter">
      <header>
        <h1 className="text-xl sm:text-2xl font-light tracking-tight">Follow-ups</h1>
        <p className="text-sm text-muted mt-1">
          A sequence stops as soon as the lead replies, converts, or is marked do-not-contact.
        </p>
      </header>

      <Card padded={false}>
        {loading ? <Spinner /> : error ? (
          <p className="p-5 text-sm" style={{ color: 'var(--bad)' }}>{error}</p>
        ) : !data || data.data.length === 0 ? (
          <Empty title="Nothing scheduled." detail="Follow-ups are booked once a campaign step is actually sent." />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {data.data.map((f) => (
              <li key={f.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/leads/${f.lead_id}`} className="text-sm hover:underline">
                    Lead {f.lead_id} · step {f.sequence_number}
                  </Link>
                  <p className="text-xs text-faint mt-0.5">
                    {f.sent_at ? `sent ${formatDate(f.sent_at)}` : `due ${formatDate(f.scheduled_at)}`}
                    {f.cancel_reason ? ` · ${f.cancel_reason}` : ''}
                  </p>
                </div>
                <StatusChip status={f.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
