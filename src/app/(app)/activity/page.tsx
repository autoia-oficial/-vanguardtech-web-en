'use client';

import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { Card, Spinner, Empty, timeAgo } from '@/components/ui';

interface Activity {
  id: number; lead_id: number; activity_type: string; description: string | null; created_at: string;
}

export default function ActivityPage() {
  const { data, error, loading } = useApi<{ activity: Activity[] }>('/api/dashboard');

  return (
    <div className="space-y-6 vg-enter">
      <header>
        <h1 className="text-xl sm:text-2xl font-light tracking-tight">Activity</h1>
        <p className="text-sm text-muted mt-1">
          The permanent record. Nothing here is removed except by deleting the lead itself.
        </p>
      </header>

      <Card padded={false}>
        {loading ? <Spinner /> : error ? (
          <p className="p-5 text-sm" style={{ color: 'var(--bad)' }}>{error}</p>
        ) : !data || data.activity.length === 0 ? (
          <Empty title="No activity recorded yet." />
        ) : (
          <ol className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {data.activity.map((a) => (
              <li key={a.id} className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`/leads/${a.lead_id}`} className="text-sm hover:underline">
                    {a.description || a.activity_type}
                  </Link>
                  <p className="text-xs text-faint mt-0.5">{a.activity_type} · lead {a.lead_id}</p>
                </div>
                <span className="text-xs text-faint whitespace-nowrap">{timeAgo(a.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
