'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useApi, mutate } from '@/hooks/useApi';
import {
  Card, SectionTitle, StatusChip, ScoreBar, Spinner, Empty, timeAgo, formatDate,
} from '@/components/ui';
import { PIPELINE_STAGES } from '@/lib/pipeline';

interface AuditCheck {
  id: number; check_number: number; check_name: string; status: string;
  evidence: string | null; problem: string | null; impact: string | null;
  priority: string | null; checked_at: string | null;
}

interface LeadDetail {
  lead: Record<string, string | number | null> & { id: number; business_name: string; status: string; priority: string; score: number };
  audit: { id: number; url: string | null; overall_status: string; overall_score: number; fetch_error: string | null; created_at: string; checks: AuditCheck[] } | null;
  contacts: Array<{ id: number; contact_email: string; contact_name: string | null }>;
  emails: Array<{ id: number; subject: string; status: string; to_email: string; sent_at: string | null; created_at: string; last_error: string | null; blocked_reason: string | null }>;
  activities: Array<{ id: number; activity_type: string; description: string | null; created_at: string }>;
  follow_ups: Array<{ id: number; sequence_number: number; status: string; scheduled_at: string; cancel_reason: string | null }>;
  campaigns: Array<{ id: number; current_step: number; status: string; campaign: { id: number; name: string } | null }>;
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useApi<LeadDetail>(`/api/leads/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <Spinner />;
  if (error) return <Card><p className="text-sm" style={{ color: 'var(--bad)' }}>{error}</p></Card>;
  if (!data) return <Empty title="Lead not found." />;

  const { lead, audit } = data;

  const runAudit = async () => {
    setBusy('audit'); setActionError(null);
    const res = await mutate(`/api/leads/${id}/audit`, 'POST');
    setBusy(null);
    if (!res.ok) setActionError(res.error);
    reload();
  };

  const changeStatus = async (status: string) => {
    setBusy('status'); setActionError(null);
    const res = await mutate(`/api/leads/${id}/status`, 'POST', { status, reason: 'changed from lead detail' });
    setBusy(null);
    if (!res.ok) setActionError(res.error);
    reload();
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy('note');
    const res = await mutate(`/api/leads/${id}/notes`, 'POST', { note });
    setBusy(null);
    if (!res.ok) setActionError(res.error);
    setNote('');
    reload();
  };

  const field = (k: string) => (lead[k] === null || lead[k] === undefined || lead[k] === '' ? '—' : String(lead[k]));

  return (
    <div className="space-y-6 vg-enter">
      <div>
        <Link href="/leads" className="text-xs text-muted hover:text-ink">← Leads</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-light tracking-tight">{lead.business_name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusChip status={lead.status} />
              <StatusChip status={lead.priority} />
              <div className="w-32"><ScoreBar score={lead.score} /></div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="vg-input !w-auto"
              value={lead.status}
              onChange={(e) => changeStatus(e.target.value)}
              disabled={busy === 'status'}
              aria-label="Change pipeline stage"
            >
              {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="vg-btn" onClick={runAudit} disabled={busy === 'audit' || !lead.website}>
              {busy === 'audit' ? 'Auditing…' : 'Run audit'}
            </button>
          </div>
        </div>
        {actionError ? <p className="mt-2 text-xs" style={{ color: 'var(--bad)' }}>{actionError}</p> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <SectionTitle>Business</SectionTitle>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
              {([
                ['Category', 'category'], ['City', 'city'], ['Province', 'province'],
                ['Country', 'country'], ['Address', 'address'], ['Source', 'source'],
              ] as const).map(([label, key]) => (
                <div key={key}>
                  <dt className="vg-label">{label}</dt>
                  <dd className="mt-0.5">{field(key)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <SectionTitle>Contact</SectionTitle>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="vg-label">Email</dt>
                <dd className="mt-0.5 break-all">{field('email')}</dd>
              </div>
              <div>
                <dt className="vg-label">Phone</dt>
                <dd className="mt-0.5">{field('phone')}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="vg-label">Website</dt>
                <dd className="mt-0.5 break-all">
                  {lead.website ? (
                    <a href={String(lead.website)} target="_blank" rel="noreferrer noopener" className="hover:underline">
                      {String(lead.website)}
                    </a>
                  ) : '—'}
                </dd>
              </div>
            </dl>
            {data.contacts.length > 0 ? (
              <ul className="mt-4 pt-4 border-t space-y-1.5" style={{ borderColor: 'var(--border)' }}>
                {data.contacts.map((c) => (
                  <li key={c.id} className="text-sm">
                    {c.contact_name ? `${c.contact_name} · ` : ''}<span className="text-muted break-all">{c.contact_email}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <Card>
            <SectionTitle
              action={audit ? <StatusChip status={audit.overall_status} /> : undefined}
            >
              Website audit
            </SectionTitle>

            {!audit ? (
              <Empty
                title="Not audited yet."
                detail={lead.website ? 'Run an audit to check all 13 items against the live site.' : 'This lead has no website on record.'}
              />
            ) : audit.fetch_error ? (
              <div>
                <p className="text-sm" style={{ color: 'var(--warn)' }}>
                  The site could not be retrieved, so nothing was assessed.
                </p>
                <p className="mt-1.5 text-xs text-faint font-mono break-all">{audit.fetch_error}</p>
                <p className="mt-3 text-xs text-muted">All 13 checks are recorded as NOT_VERIFIED.</p>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex-1"><ScoreBar score={audit.overall_score} /></div>
                  <span className="text-xs text-faint whitespace-nowrap">{timeAgo(audit.created_at)}</span>
                </div>
                <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {audit.checks.sort((a, b) => a.check_number - b.check_number).map((c) => (
                    <li key={c.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm">
                            <span className="text-faint tabular-nums mr-2">{String(c.check_number).padStart(2, '0')}</span>
                            {c.check_name}
                          </p>
                          {c.evidence ? <p className="mt-1 text-xs text-muted">{c.evidence}</p> : null}
                          {c.problem ? (
                            <p className="mt-1.5 text-xs" style={{ color: 'var(--warn)' }}>{c.problem}</p>
                          ) : null}
                          {c.impact ? <p className="mt-1 text-xs text-faint">{c.impact}</p> : null}
                        </div>
                        <StatusChip status={c.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card>
            <SectionTitle>Emails</SectionTitle>
            {data.emails.length === 0 ? (
              <Empty title="No email queued for this lead." />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {data.emails.map((e) => (
                  <li key={e.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{e.subject}</p>
                      <p className="text-xs text-faint mt-0.5 break-all">{e.to_email}</p>
                      {e.blocked_reason ? (
                        <p className="text-xs mt-1" style={{ color: 'var(--warn)' }}>Blocked: {e.blocked_reason}</p>
                      ) : null}
                      {e.last_error ? <p className="text-xs text-faint mt-1">{e.last_error}</p> : null}
                    </div>
                    <div className="text-right shrink-0">
                      <StatusChip status={e.status} />
                      <p className="text-xs text-faint mt-1">{e.sent_at ? timeAgo(e.sent_at) : timeAgo(e.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <SectionTitle>Follow-ups</SectionTitle>
            {data.follow_ups.length === 0 ? (
              <Empty title="None scheduled." />
            ) : (
              <ul className="space-y-2.5">
                {data.follow_ups.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm">Step {f.sequence_number}</p>
                      <p className="text-xs text-faint">{formatDate(f.scheduled_at)}</p>
                      {f.cancel_reason ? <p className="text-xs text-faint">{f.cancel_reason}</p> : null}
                    </div>
                    <StatusChip status={f.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle>Campaigns</SectionTitle>
            {data.campaigns.length === 0 ? (
              <Empty title="Not enrolled." />
            ) : (
              <ul className="space-y-2.5">
                {data.campaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{c.campaign?.name ?? `Campaign ${c.id}`}</p>
                      <p className="text-xs text-faint">Step {c.current_step}</p>
                    </div>
                    <StatusChip status={c.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle>Notes</SectionTitle>
            <form onSubmit={addNote} className="space-y-2.5">
              <textarea
                className="vg-input min-h-[5rem] resize-y"
                placeholder="Add a note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="New note"
              />
              <button className="vg-btn w-full" disabled={busy === 'note' || !note.trim()}>
                {busy === 'note' ? 'Saving…' : 'Add note'}
              </button>
            </form>
            {lead.notes ? (
              <pre className="mt-4 pt-4 border-t text-xs text-muted whitespace-pre-wrap font-sans" style={{ borderColor: 'var(--border)' }}>
                {String(lead.notes)}
              </pre>
            ) : null}
          </Card>

          <Card>
            <SectionTitle>Timeline</SectionTitle>
            {data.activities.length === 0 ? (
              <Empty title="No history yet." />
            ) : (
              <ol className="space-y-3">
                {data.activities.map((a) => (
                  <li key={a.id} className="relative pl-4">
                    <span
                      aria-hidden
                      className="absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full"
                      style={{ background: 'var(--border-strong)' }}
                    />
                    <p className="text-sm leading-snug">{a.description || a.activity_type}</p>
                    <p className="text-xs text-faint mt-0.5">
                      {a.activity_type} · {timeAgo(a.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
