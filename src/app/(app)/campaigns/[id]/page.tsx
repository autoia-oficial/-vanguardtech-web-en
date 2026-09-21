'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useApi, mutate } from '@/hooks/useApi';
import { Card, SectionTitle, StatusChip, Spinner, Empty, timeAgo } from '@/components/ui';
import { PIPELINE_STAGES } from '@/lib/pipeline';

interface Step { step: number; wait_days: number; subject: string; body: string }

interface CampaignDetail {
  campaign: {
    id: number; name: string; description: string | null; status: string;
    daily_limit: number; email_account_id: number | null; sequence: Step[] | null;
  };
  enrollments: Array<{
    id: number; current_step: number; status: string;
    lead: { id: number; business_name: string; email: string | null; status: string } | null;
  }>;
  emails: Array<{ id: number; subject: string; status: string; to_email: string; sequence_step: number | null; created_at: string }>;
}

interface Account { id: number; email: string; name: string | null; is_active: boolean; daily_limit: number }

interface AccountsResponse {
  data: Account[];
  transport: { status: string; missing: string[]; detail: string };
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useApi<CampaignDetail>(`/api/campaigns/${id}`);
  const accounts = useApi<AccountsResponse>('/api/email-accounts');

  const [steps, setSteps] = useState<Step[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enrollStage, setEnrollStage] = useState('AUDITED');

  useEffect(() => {
    if (!data) return;
    setSteps(data.campaign.sequence ?? []);
    setAccountId(data.campaign.email_account_id ? String(data.campaign.email_account_id) : '');
  }, [data]);

  if (loading) return <Spinner />;
  if (error) return <Card><p className="text-sm" style={{ color: 'var(--bad)' }}>{error}</p></Card>;
  if (!data) return <Empty title="Campaign not found." />;

  const { campaign } = data;

  const save = async (patch: Record<string, unknown>, key: string) => {
    setBusy(key); setMessage(null);
    const res = await mutate('/api/campaigns', 'PATCH', { id: campaign.id, ...patch });
    setBusy(null);
    setMessage(res.ok ? 'Saved.' : res.error);
    reload();
  };

  const enroll = async () => {
    setBusy('enroll'); setMessage(null);
    const res = await mutate(`/api/campaigns/${campaign.id}/enroll`, 'POST', {
      filter: { status: enrollStage },
    });
    setBusy(null);
    if (!res.ok) setMessage(res.error);
    else {
      const d = res.data as { enrolled: number; skipped: Array<{ reason: string }> };
      setMessage(`Enrolled ${d.enrolled}. Skipped ${d.skipped.length}.`);
    }
    reload();
  };

  const updateStep = (index: number, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const addStep = () =>
    setSteps((prev) => [...prev, { step: prev.length + 1, wait_days: prev.length === 0 ? 0 : 4, subject: '', body: '' }]);

  const removeStep = (index: number) =>
    setSteps((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, step: i + 1 })));

  const readyToActivate =
    campaign.email_account_id !== null && (campaign.sequence?.length ?? 0) > 0;

  return (
    <div className="space-y-6 vg-enter">
      <div>
        <Link href="/campaigns" className="text-xs text-muted hover:text-ink">← Campaigns</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-light tracking-tight">{campaign.name}</h1>
            {campaign.description ? <p className="text-sm text-muted mt-1">{campaign.description}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={campaign.status} />
            {campaign.status === 'ACTIVE' ? (
              <button className="vg-btn" disabled={busy === 'status'} onClick={() => save({ status: 'PAUSED' }, 'status')}>
                Pause
              </button>
            ) : (
              <button
                className="vg-btn vg-btn-primary"
                disabled={busy === 'status' || !readyToActivate}
                title={readyToActivate ? undefined : 'Set a sending account and at least one step first'}
                onClick={() => save({ status: 'ACTIVE' }, 'status')}
              >
                Activate
              </button>
            )}
          </div>
        </div>
        {message ? <p className="mt-2 text-xs text-muted">{message}</p> : null}
        {!readyToActivate ? (
          <p className="mt-2 text-xs" style={{ color: 'var(--warn)' }}>
            This campaign cannot send yet: it needs a sending account and at least one step.
          </p>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <SectionTitle
              action={<button className="vg-btn" onClick={addStep}>Add step</button>}
            >
              Sequence
            </SectionTitle>

            {steps.length === 0 ? (
              <Empty title="No steps yet." detail="Step 1 goes out as soon as a lead is enrolled; later steps wait after the previous send." />
            ) : (
              <div className="space-y-4">
                {steps.map((s, i) => (
                  <div key={i} className="rounded border p-4" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <span className="vg-label">Step {i + 1}</span>
                      <button className="vg-btn !py-1 !px-2 text-xs" onClick={() => removeStep(i)}>Remove</button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="sm:col-span-1">
                        <label className="vg-label block mb-1.5">Wait (days)</label>
                        <input
                          type="number" min="0" className="vg-input"
                          value={s.wait_days}
                          disabled={i === 0}
                          title={i === 0 ? 'The first step goes out immediately' : undefined}
                          onChange={(e) => updateStep(i, { wait_days: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="vg-label block mb-1.5">Subject</label>
                        <input
                          className="vg-input" value={s.subject}
                          onChange={(e) => updateStep(i, { subject: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="vg-label block mb-1.5">Body</label>
                        <textarea
                          className="vg-input min-h-[6rem] resize-y" value={s.body}
                          onChange={(e) => updateStep(i, { body: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  className="vg-btn vg-btn-primary"
                  disabled={busy === 'sequence'}
                  onClick={() => save({ sequence: steps }, 'sequence')}
                >
                  {busy === 'sequence' ? 'Saving…' : 'Save sequence'}
                </button>
                <p className="text-xs text-faint">
                  {'{{business_name}}, {{city}}, {{category}} and other lead fields are substituted when the email is queued.'}
                </p>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>Enrolled leads ({data.enrollments.length})</SectionTitle>
            <div className="flex flex-wrap gap-2 mb-4">
              <select className="vg-input !w-auto" value={enrollStage} onChange={(e) => setEnrollStage(e.target.value)} aria-label="Stage to enrol">
                {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="vg-btn" disabled={busy === 'enroll'} onClick={enroll}>
                {busy === 'enroll' ? 'Enrolling…' : 'Enrol leads at this stage'}
              </button>
            </div>

            {data.enrollments.length === 0 ? (
              <Empty title="Nobody enrolled yet." />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {data.enrollments.map((e) => (
                  <li key={e.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {e.lead ? (
                        <Link href={`/leads/${e.lead.id}`} className="text-sm hover:underline">
                          {e.lead.business_name}
                        </Link>
                      ) : <span className="text-sm text-faint">Lead removed</span>}
                      <p className="text-xs text-faint mt-0.5">Step {e.current_step}</p>
                    </div>
                    <StatusChip status={e.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <SectionTitle>Sending account</SectionTitle>
            {accounts.loading ? <Spinner /> : (
              <>
                {accounts.data?.transport?.status === 'NOT_CONFIGURED' ? (
                  <p className="text-xs mb-3" style={{ color: 'var(--warn)' }}>
                    No SMTP transport is configured, so queued mail will be held rather than sent.
                  </p>
                ) : null}
                <select
                  className="vg-input"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  aria-label="Sending account"
                >
                  <option value="">None selected</option>
                  {(accounts.data?.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}{a.is_active ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>
                <button
                  className="vg-btn w-full mt-2.5"
                  disabled={busy === 'account' || !accountId}
                  onClick={() => save({ email_account_id: Number(accountId) }, 'account')}
                >
                  {busy === 'account' ? 'Saving…' : 'Set account'}
                </button>
                {(accounts.data?.data ?? []).length === 0 ? (
                  <p className="mt-2.5 text-xs text-faint">
                    No accounts yet — add one under Settings.
                  </p>
                ) : null}
              </>
            )}
          </Card>

          <Card>
            <SectionTitle>Daily cap</SectionTitle>
            <div className="flex gap-2">
              <input
                type="number" min="1" className="vg-input"
                defaultValue={campaign.daily_limit}
                id="daily-limit"
                aria-label="Campaign daily limit"
              />
              <button
                className="vg-btn"
                disabled={busy === 'limit'}
                onClick={() => {
                  const el = document.getElementById('daily-limit') as HTMLInputElement | null;
                  save({ daily_limit: Number(el?.value) || campaign.daily_limit }, 'limit');
                }}
              >
                Save
              </button>
            </div>
            <p className="mt-2 text-xs text-faint">
              Applies on top of the sending account&rsquo;s own daily and hourly limits; the lower one wins.
            </p>
          </Card>

          <Card>
            <SectionTitle>Recent email</SectionTitle>
            {data.emails.length === 0 ? (
              <Empty title="Nothing queued yet." />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {data.emails.slice(0, 15).map((e) => (
                  <li key={e.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{e.subject}</p>
                        <p className="text-xs text-faint mt-0.5 break-all">
                          {e.to_email}{e.sequence_step ? ` · step ${e.sequence_step}` : ''}
                        </p>
                      </div>
                      <StatusChip status={e.status} />
                    </div>
                    <p className="text-xs text-faint mt-1">{timeAgo(e.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
