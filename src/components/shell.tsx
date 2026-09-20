'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThemeToggle } from './theme';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/leads', label: 'Leads' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/emails', label: 'Emails' },
  { href: '/follow-ups', label: 'Follow-ups' },
  { href: '/automations', label: 'Automations' },
  { href: '/activity', label: 'Activity' },
  { href: '/errors', label: 'Errors' },
  { href: '/settings', label: 'Settings' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { email: string; full_name: string | null } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // A navigation should always close the mobile drawer behind it.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Escape closes the drawer, matching the expectation set by the overlay.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  const navLinks = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="rounded px-3 py-2 text-[0.8125rem] transition-colors duration-150"
            style={{
              background: active ? 'var(--surface-hover)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: active ? 500 : 400,
            }}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Mobile top bar */}
      <header
        className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 h-14 border-b"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <button
          type="button"
          className="vg-btn !px-2"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        <span className="text-sm font-medium tracking-tight">Vanguard CRM</span>
        <ThemeToggle />
      </header>

      {menuOpen ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="lg:hidden fixed inset-0 z-30"
            style={{ background: 'color-mix(in srgb, var(--bg) 70%, transparent)' }}
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="lg:hidden fixed top-14 left-0 right-0 z-40 border-b p-3 vg-enter"
            style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)' }}
          >
            {navLinks}
            <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2">
              <span className="text-xs text-faint truncate">{user?.email ?? ''}</span>
              <button type="button" className="vg-btn" onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </>
      ) : null}

      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex lg:w-56 xl:w-60 shrink-0 flex-col border-r sticky top-0 h-screen p-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="px-3 py-2 mb-4">
          <p className="text-sm font-medium tracking-tight">Vanguard</p>
          <p className="text-[0.6875rem] text-faint tracking-wide">SALES CRM</p>
        </div>

        {navLinks}

        <div className="mt-auto pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 justify-between">
            <ThemeToggle />
            <button type="button" className="vg-btn flex-1" onClick={signOut}>
              Sign out
            </button>
          </div>
          {user ? (
            <p className="mt-2.5 px-1 text-[0.6875rem] text-faint truncate" title={user.email}>
              {user.full_name || user.email}
            </p>
          ) : null}
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="max-w-shell mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
