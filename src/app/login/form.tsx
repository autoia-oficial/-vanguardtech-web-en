'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NotConfigured } from '@/components/ui';
import { ThemeToggle } from '@/components/theme';

export function LoginForm({
  needsSetup,
  authMissing,
  databaseMissing,
}: {
  needsSetup: boolean;
  authMissing: string[];
  databaseMissing: string[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blocked = authMissing.length > 0 || databaseMissing.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(needsSetup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          needsSetup ? { email, password, full_name: fullName } : { email, password },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `Request failed (${res.status}).`);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-20">
        <div className="w-full max-w-sm vg-enter">
          <div className="mb-8">
            <h1 className="text-2xl font-light tracking-tight">Vanguard</h1>
            <p className="text-xs text-faint tracking-wide mt-0.5">SALES CRM</p>
          </div>

          {blocked ? (
            <div className="space-y-3">
              {databaseMissing.length > 0 ? (
                <NotConfigured
                  label="Database"
                  missing={databaseMissing}
                  detail="The CRM cannot start without a PostgreSQL connection. Neon works without code changes."
                />
              ) : null}
              {authMissing.length > 0 ? (
                <NotConfigured
                  label="Authentication"
                  missing={authMissing}
                  detail="Sign-in is disabled until a secret is configured, so the CRM stays locked."
                />
              ) : null}
            </div>
          ) : (
            <form onSubmit={submit} className="vg-card p-6 space-y-4">
              {needsSetup ? (
                <div className="pb-1">
                  <p className="text-sm font-medium">Create the first account</p>
                  <p className="text-xs text-muted mt-1">
                    No users exist yet. This form closes permanently once one does.
                  </p>
                </div>
              ) : null}

              {needsSetup ? (
                <div>
                  <label htmlFor="full_name" className="vg-label block mb-1.5">
                    Name
                  </label>
                  <input
                    id="full_name"
                    className="vg-input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              ) : null}

              <div>
                <label htmlFor="email" className="vg-label block mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  className="vg-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                />
              </div>

              <div>
                <label htmlFor="password" className="vg-label block mb-1.5">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={needsSetup ? 12 : undefined}
                  className="vg-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={needsSetup ? 'new-password' : 'current-password'}
                />
                {needsSetup ? (
                  <p className="mt-1.5 text-xs text-faint">At least 12 characters.</p>
                ) : null}
              </div>

              {error ? (
                <p className="text-xs" style={{ color: 'var(--bad)' }} role="alert">
                  {error}
                </p>
              ) : null}

              <button type="submit" className="vg-btn vg-btn-primary w-full" disabled={busy}>
                {busy ? 'Working…' : needsSetup ? 'Create account' : 'Sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
