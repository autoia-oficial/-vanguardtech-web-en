'use client';

import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { Card, Stat, SectionTitle, StatusChip, Spinner, Empty, NotConfigured, timeAgo } from '@/components/ui';
import type { IntegrationReport } from '@/lib/config';

interface DashboardData {
  stats: Record<string, number>;
  pipeline: Record<string, number>;
  emails_by_status: Record<string, number>;
  automations: Array<{ id: number; key: string; name: string; status: string; last_run: string | null }>;
  activity: Array<{ id: number; lead_id: number; activity_type: string; description: string | null; created_at: string }>;
  integrations: IntegrationReport[];
}

const PRIMARY: Array<[string, string]> = [
  ['total_leads', 'Total leads'],
  ['new_leads', 'New'],
  ['audited', 'Audited'],
  ['priority_leads', 'Priority'],
  ['contacted', 'Contacted'],
  ['replies', 'Replies'],
  ['demos', 'Demos'],
  ['meetings', 'Meetings'],
  ['accepted', 'Accepted'],
  ['paid', 'Paid'],
  ['live', 'Live'],
  ['emails_today', 'Emails today'],
];

export default function DashboardPage() {
  const { data, error, loading } = useApi<DashboardData>('/api/dashboard');

  if (loading) return <Spinner />;
  if (error) return <Card><p className="text-sm" style={{ color: 'var(--bad)' }}>{error}</p></Card>;
  if (!data) return <Empty title="No data." />;

  const unconfigured = data.integrations.filter((i) => i.status === 'NOT_CONFIGURED');

  return (
    <div className="space-y-8 vg-enter">
      <header>
        <h1 className="text-xl sm:text-2xl font-light tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted mt-1">Everything below is read from the database.</p>
      </header>

      {unconfigured.length > 0 ? (
        <section className="space-y-2.5">
          {unconfigured.map((i) => (
            <NotConfigured key={i.key} label={i.label} missing={i.missing} detail={i.detail} />
          ))}
        </section>
      ) : null}

      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {PRIMARY.map(([key, label]) => (
          <Stat key={key} label={label} value={data.stats[key] ?? 0} />
        ))}
        <Stat label="Follow-ups today" value={data.stats.follow_ups_today ?? 0} />
        <Stat
          label="Open errors"
          value={data.stats.open_errors ?? 0}
          hint={data.stats.open_errors ? 'Needs attention' : undefined}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle action={<Link href="/automations" className="text-xs text-muted hover:text-ink">View all</Link>}>
            Automations
          </SectionTitle>
          {data.automations.length === 0 ? (
            <Empty title="No automations registered yet." />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {data.automations.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{a.name}</p>
                    <p className="text-xs text-faint">Last run {timeAgo(a.last_run)}</p>
                  </div>
                  <StatusChip status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Email queue</SectionTitle>
          {Object.keys(data.emails_by_status).length === 0 ? (
            <Empty title="No email has been queued yet." />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {Object.entries(data.emails_by_status).map(([status, n]) => (
                <li key={status} className="flex items-center justify-between gap-3 py-2.5">
                  <StatusChip status={status} />
                  <span className="text-sm tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <Card>
          <SectionTitle action={<Link href="/activity" className="text-xs text-muted hover:text-ink">View all</Link>}>
            Recent activity
          </SectionTitle>
          {data.activity.length === 0 ? (
            <Empty title="Nothing has happened yet." detail="Activity appears here as leads move through the pipeline." />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {data.activity.slice(0, 12).map((a) => (
                <li key={a.id} className="py-2.5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link href={`/leads/${a.lead_id}`} className="text-sm hover:underline">
                      {a.description || a.activity_type}
                    </Link>
                    <p className="text-xs text-faint mt-0.5">{a.activity_type}</p>
                  </div>
                  <span className="text-xs text-faint whitespace-nowrap">{timeAgo(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
