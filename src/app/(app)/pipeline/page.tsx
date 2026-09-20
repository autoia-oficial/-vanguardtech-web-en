'use client';

import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { Card, Spinner, Empty, StatusChip } from '@/components/ui';
import { PIPELINE_STAGES } from '@/lib/pipeline';

interface DashboardData { pipeline: Record<string, number>; stats: Record<string, number> }

export default function PipelinePage() {
  const { data, error, loading } = useApi<DashboardData>('/api/dashboard');

  if (loading) return <Spinner />;
  if (error) return <Card><p className="text-sm" style={{ color: 'var(--bad)' }}>{error}</p></Card>;
  if (!data) return <Empty title="No data." />;

  const counts = data.pipeline;
  const max = Math.max(1, ...Object.values(counts));

  return (
    <div className="space-y-6 vg-enter">
      <header>
        <h1 className="text-xl sm:text-2xl font-light tracking-tight">Pipeline</h1>
        <p className="text-sm text-muted mt-1">Leads by stage. Select a stage to see them.</p>
      </header>

      <Card padded={false}>
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {PIPELINE_STAGES.map((stage) => {
            const n = counts[stage] ?? 0;
            return (
              <li key={stage}>
                <Link
                  href={`/leads?status=${stage}`}
                  className="vg-row-link flex items-center gap-4 px-4 py-3"
                >
                  <div className="w-44 shrink-0"><StatusChip status={stage} /></div>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${(n / max) * 100}%`, background: n === 0 ? 'transparent' : 'var(--text-faint)' }}
                    />
                  </div>
                  <span className="w-12 text-right text-sm tabular-nums">{n}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
