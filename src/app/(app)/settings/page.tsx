'use client';

import { useState } from 'react';
import { useApi, mutate } from '@/hooks/useApi';
import { Card, SectionTitle, Spinner, Empty, StatusChip, NotConfigured } from '@/components/ui';
import type { IntegrationReport } from '@/lib/config';

interface Setting { id: number; key: string; value: string | null; type: string | null }

interface IntegrationsResponse {
  integrations: IntegrationReport[];
  email_provider: { key: string; label: string; availability: { available: boolean; reason?: string; missing?: string[] } };
  discovery_providers: Array<{ key: string; label: string; availability: { available: boolean; reason?: string; missing?: string[] } }>;
}

/** Settings the jobs actually read, so the page is not an empty key-value box. */
const KNOWN_SETTINGS: Array<{ key: string; label: string; hint: string; placeholder: string }> = [
  {
    key: 'email.batch_size',
    label: 'Email batch size',
    hint: 'How many queued emails one worker run may claim.',
    placeholder: '25',
  },
  {
    key: 'email.recent_contact_days',
    label: 'Recent-contact cool-off (days)',
    hint: 'A lead contacted inside this window is not emailed again.',
    placeholder: '14',
  },
  {
    key: 'audit.batch_size',
    label: 'Audit batch size',
    hint: 'How many websites one audit run may check.',
    placeholder: '10',
  },
  {
    key: 'discovery.queries',
    label: 'Discovery queries (JSON)',
    hint: 'Array of {country, province, city, category, limit}. The discovery job runs each one.',
    placeholder: '[{"city":"Madrid","category":"gyms","limit":50}]',
  },
];

export default function SettingsPage() {
  const settings = useApi<{ data: Setting[] }>('/api/settings');
  const integrations = useApi<IntegrationsResponse>('/api/integrations');
  const suppression = useApi<{ data: Array<{ id: number; email: string; reason: string | null }> }>('/api/suppression');

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [newSuppression, setNewSuppression] = useState('');

  const current = (key: string): string => {
    if (key in drafts) return drafts[key];
    return settings.data?.data.find((s) => s.key === key)?.value ?? '';
  };

  const save = async (key: string) => {
    setBusy(key);
    await mutate('/api/settings', 'PUT', { key, value: current(key) });
    setBusy(null);
    settings.reload();
  };

  const addSuppression = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSuppression.trim()) return;
    setBusy('suppression');
    await mutate('/api/suppression', 'POST', { email: newSuppression, reason: 'added from settings' });
    setBusy(null);
    setNewSuppression('');
    suppression.reload();
  };

  const removeSuppression = async (email: string) => {
    setBusy(email);
    await mutate(`/api/suppression?email=${encodeURIComponent(email)}`, 'DELETE');
    setBusy(null);
    suppression.reload();
  };

  return (
    <div className="space-y-6 vg-enter">
      <header>
        <h1 className="text-xl sm:text-2xl font-light tracking-tight">Settings</h1>
        <p className="text-sm text-muted mt-1">Configuration the jobs read at run time.</p>
      </header>

      <Card>
        <SectionTitle>Integrations</SectionTitle>
        {integrations.loading ? <Spinner /> : !integrations.data ? (
          <Empty title="Could not read integration status." />
        ) : (
          <div className="space-y-3">
            {integrations.data.integrations.map((i) =>
              i.status === 'NOT_CONFIGURED' ? (
                <NotConfigured key={i.key} label={i.label} missing={i.missing} detail={i.detail} />
              ) : (
                <div key={i.key} className="flex items-start justify-between gap-3 py-1">
                  <div className="min-w-0">
                    <p className="text-sm">{i.label}</p>
                    <p className="text-xs text-faint mt-0.5">{i.detail}</p>
                  </div>
                  <StatusChip status="CONFIGURED" />
                </div>
              ),
            )}

            <div className="pt-3 mt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <p className="vg-label mb-2">Discovery sources</p>
              <ul className="space-y-2">
                {integrations.data.discovery_providers.map((p) => (
                  <li key={p.key} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm">{p.label}</p>
                      {!p.availability.available ? (
                        <p className="text-xs text-faint mt-0.5">
                          {p.availability.reason}
                          {p.availability.missing?.length ? ` (${p.availability.missing.join(', ')})` : ''}
                        </p>
                      ) : null}
                    </div>
                    <StatusChip status={p.availability.available ? 'CONFIGURED' : 'NOT_CONFIGURED'} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Job configuration</SectionTitle>
        {settings.loading ? <Spinner /> : (
          <div className="space-y-5">
            {KNOWN_SETTINGS.map((s) => (
              <div key={s.key}>
                <label htmlFor={s.key} className="vg-label block mb-1.5">{s.label}</label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id={s.key}
                    className="vg-input flex-1 min-w-[12rem] font-mono text-xs"
                    value={current(s.key)}
                    placeholder={s.placeholder}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                  />
                  <button className="vg-btn" disabled={busy === s.key} onClick={() => save(s.key)}>
                    {busy === s.key ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-faint">{s.hint}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Suppression list</SectionTitle>
        <p className="text-xs text-muted mb-4">
          Addresses here are never emailed, checked both when queueing and again immediately before sending.
        </p>
        <form onSubmit={addSuppression} className="flex flex-wrap gap-2 mb-4">
          <input
            className="vg-input flex-1 min-w-[12rem]"
            placeholder="address@example.com"
            value={newSuppression}
            onChange={(e) => setNewSuppression(e.target.value)}
            aria-label="Address to suppress"
          />
          <button className="vg-btn" disabled={busy === 'suppression'}>Add</button>
        </form>

        {suppression.loading ? <Spinner /> : !suppression.data || suppression.data.data.length === 0 ? (
          <Empty title="Nothing suppressed." />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {suppression.data.data.map((s) => (
              <li key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm break-all">{s.email}</p>
                  {s.reason ? <p className="text-xs text-faint mt-0.5">{s.reason}</p> : null}
                </div>
                <button className="vg-btn" disabled={busy === s.email} onClick={() => removeSuppression(s.email)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
