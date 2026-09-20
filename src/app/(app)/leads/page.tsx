'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useApi, mutate } from '@/hooks/useApi';
import { Card, SectionTitle, StatusChip, ScoreBar, Spinner, Empty, timeAgo } from '@/components/ui';
import { PIPELINE_STAGES } from '@/lib/pipeline';

interface Lead {
  id: number;
  business_name: string;
  category: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: string;
  priority: string;
  score: number;
  created_at: string;
}

interface LeadsResponse {
  data: Lead[];
  pagination: { limit: number; offset: number; total: number };
}

const PAGE_SIZE = 25;

export default function LeadsPage() {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
    sort: 'score',
    order: 'desc',
  });
  if (status) params.set('status', status);
  if (search) params.set('q', search);

  const { data, error, loading, reload } = useApi<LeadsResponse>(`/api/leads?${params}`);
  const total = data?.pagination.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6 vg-enter">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-light tracking-tight">Leads</h1>
          <p className="text-sm text-muted mt-1">{total} in the database</p>
        </div>
        <button className="vg-btn vg-btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : 'New lead'}
        </button>
      </header>

      {creating ? <NewLeadForm onDone={() => { setCreating(false); reload(); }} /> : null}

      <Card padded={false}>
        <div className="p-4 flex flex-wrap gap-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <form
            className="flex gap-2 flex-1 min-w-[12rem]"
            onSubmit={(e) => { e.preventDefault(); setPage(0); setSearch(q); }}
          >
            <input
              className="vg-input"
              placeholder="Search name, email, website, city…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search leads"
            />
            <button className="vg-btn" type="submit">Search</button>
          </form>
          <select
            className="vg-input !w-auto"
            value={status}
            onChange={(e) => { setPage(0); setStatus(e.target.value); }}
            aria-label="Filter by stage"
          >
            <option value="">All stages</option>
            {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {loading ? <Spinner /> : error ? (
          <p className="p-5 text-sm" style={{ color: 'var(--bad)' }}>{error}</p>
        ) : !data || data.data.length === 0 ? (
          <Empty title="No leads match." detail="Run discovery or add one manually." />
        ) : (
          <>
            {/* Table on wide screens */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ color: 'var(--text-faint)' }}>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Business</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Location</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Stage</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Priority</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Score</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {data.data.map((lead) => (
                    <tr key={lead.id} className="vg-row-link">
                      <td className="px-4 py-3">
                        <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                          {lead.business_name}
                        </Link>
                        <p className="text-xs text-faint mt-0.5">
                          {lead.website ?? lead.email ?? 'no contact details'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-muted">{lead.city ?? '—'}</td>
                      <td className="px-4 py-3"><StatusChip status={lead.status} /></td>
                      <td className="px-4 py-3"><StatusChip status={lead.priority} /></td>
                      <td className="px-4 py-3"><ScoreBar score={lead.score} /></td>
                      <td className="px-4 py-3 text-xs text-faint whitespace-nowrap">{timeAgo(lead.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards on phones */}
            <ul className="md:hidden divide-y" style={{ borderColor: 'var(--border)' }}>
              {data.data.map((lead) => (
                <li key={lead.id} className="p-4">
                  <Link href={`/leads/${lead.id}`} className="block">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{lead.business_name}</p>
                        <p className="text-xs text-faint mt-0.5 truncate">
                          {[lead.city, lead.category].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <StatusChip status={lead.priority} />
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <StatusChip status={lead.status} />
                      <div className="flex-1"><ScoreBar score={lead.score} /></div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between gap-3 p-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <span className="text-xs text-faint">Page {page + 1} of {pages}</span>
              <div className="flex gap-2">
                <button className="vg-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <button className="vg-btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function NewLeadForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ business_name: '', category: '', city: '', email: '', phone: '', website: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await mutate('/api/leads', 'POST', form);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onDone();
  };

  return (
    <Card>
      <SectionTitle>New lead</SectionTitle>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {([
          ['business_name', 'Business name *'],
          ['category', 'Category'],
          ['city', 'City'],
          ['email', 'Email'],
          ['phone', 'Phone'],
          ['website', 'Website'],
        ] as const).map(([key, label]) => (
          <div key={key}>
            <label htmlFor={key} className="vg-label block mb-1.5">{label}</label>
            <input
              id={key}
              className="vg-input"
              value={form[key]}
              onChange={set(key)}
              required={key === 'business_name'}
            />
          </div>
        ))}
        <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
          <button className="vg-btn vg-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create lead'}</button>
          {error ? <span className="text-xs" style={{ color: 'var(--bad)' }}>{error}</span> : null}
        </div>
      </form>
    </Card>
  );
}
