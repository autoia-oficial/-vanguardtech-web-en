'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useApi, mutate } from '@/hooks/useApi';
import { Card, SectionTitle, Spinner, Empty, StatusChip, timeAgo } from '@/components/ui';

interface Campaign {
  id: number; name: string; description: string | null; status: string;
  daily_limit: number; enrolled: number; email_account_id: number | null;
  sequence: Array<{ step: number; wait_days: number; subject: string }> | null;
  created_at: string;
}

export default function CampaignsPage() {
  const { data, error, loading, reload } = useApi<{ data: Campaign[] }>('/api/campaigns');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const setStatus = async (id: number, status: string) => {
    setBusy(id); setActionError(null);
    const res = await mutate('/api/campaigns', 'PATCH', { id, status });
    setBusy(null);
    if (!res.ok) setActionError(res.error);
    reload();
  };

  return (
    <div className="space-y-6 vg-enter">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-light tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted mt-1">A campaign only sends while it is ACTIVE.</p>
        </div>
        <button className="vg-btn vg-btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : 'New campaign'}
        </button>
      </header>

      {creating ? <NewCampaign onDone={() => { setCreating(false); reload(); }} /> : null}
      {actionError ? <p className="text-xs" style={{ color: 'var(--bad)' }}>{actionError}</p> : null}

      {loading ? <Spinner /> : error ? (
        <Card><p className="text-sm" style={{ color: 'var(--bad)' }}>{error}</p></Card>
      ) : !data || data.data.length === 0 ? (
        <Card><Empty title="No campaigns yet." detail="Create one, give it a sequence, then enrol leads." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.data.map((c) => (
            <Card key={c.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/campaigns/${c.id}`} className="text-sm font-medium truncate hover:underline block">
                    {c.name}
                  </Link>
                  <p className="text-xs text-faint mt-0.5">{timeAgo(c.created_at)}</p>
                </div>
                <StatusChip status={c.status} />
              </div>

              {c.description ? <p className="mt-3 text-xs text-muted">{c.description}</p> : null}

              <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <div><dt className="vg-label">Enrolled</dt><dd className="mt-0.5 tabular-nums">{c.enrolled}</dd></div>
                <div><dt className="vg-label">Daily cap</dt><dd className="mt-0.5 tabular-nums">{c.daily_limit}</dd></div>
                <div><dt className="vg-label">Steps</dt><dd className="mt-0.5 tabular-nums">{c.sequence?.length ?? 0}</dd></div>
              </dl>

              {!c.email_account_id ? (
                <p className="mt-3 text-xs" style={{ color: 'var(--warn)' }}>
                  No sending account set — nothing can be queued.
                </p>
              ) : null}
              {!c.sequence?.length ? (
                <p className="mt-2 text-xs" style={{ color: 'var(--warn)' }}>
                  No sequence steps — nothing to send.
                </p>
              ) : null}

              <div className="mt-4 flex gap-2">
                <Link href={`/campaigns/${c.id}`} className="vg-btn flex-1 justify-center">
                  Open
                </Link>
                {c.status !== 'ACTIVE' ? (
                  <button className="vg-btn flex-1" disabled={busy === c.id} onClick={() => setStatus(c.id, 'ACTIVE')}>
                    Activate
                  </button>
                ) : (
                  <button className="vg-btn flex-1" disabled={busy === c.id} onClick={() => setStatus(c.id, 'PAUSED')}>
                    Pause
                  </button>
                )}
                <button className="vg-btn flex-1" disabled={busy === c.id} onClick={() => setStatus(c.id, 'COMPLETED')}>
                  Complete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NewCampaign({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dailyLimit, setDailyLimit] = useState('50');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await mutate('/api/campaigns', 'POST', {
      name, description, daily_limit: Number(dailyLimit) || 50,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onDone();
  };

  return (
    <Card>
      <SectionTitle>New campaign</SectionTitle>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="c-name" className="vg-label block mb-1.5">Name *</label>
          <input id="c-name" className="vg-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="c-desc" className="vg-label block mb-1.5">Description</label>
          <input id="c-desc" className="vg-input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label htmlFor="c-limit" className="vg-label block mb-1.5">Daily limit</label>
          <input id="c-limit" type="number" min="1" className="vg-input" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button className="vg-btn vg-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create'}</button>
          {error ? <span className="text-xs" style={{ color: 'var(--bad)' }}>{error}</span> : null}
          <span className="text-xs text-faint">Created as DRAFT. Add a sequence and a sending account before activating.</span>
        </div>
      </form>
    </Card>
  );
}
