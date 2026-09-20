import { describe, it, expect } from 'vitest';
import { scoreLead, auditScoreOf, priorityForScore, UNREACHABLE_CAP } from './scoring';
import type { CheckResult, CheckStatus } from '@/lib/audit/types';

const check = (status: CheckStatus, n = 1): CheckResult => ({
  check_number: n,
  check_name: 'test',
  status,
  evidence: null,
  problem: null,
  impact: null,
  priority: null,
  checked_at: new Date(),
});

const checks = (statuses: CheckStatus[]): CheckResult[] =>
  statuses.map((s, i) => check(s, i + 1));

const reachable = { email: 'a@b.com', phone: '+34910000111' };

describe('auditScoreOf', () => {
  it('returns null when nothing was verified', () => {
    expect(auditScoreOf([])).toBeNull();
    expect(auditScoreOf(checks(['NOT_VERIFIED', 'NOT_VERIFIED']))).toBeNull();
  });

  it('averages only the verified checks', () => {
    expect(auditScoreOf(checks(['PASS', 'NOT_VERIFIED']))).toBe(100);
    expect(auditScoreOf(checks(['PASS', 'FAIL']))).toBe(50);
    expect(auditScoreOf(checks(['WARNING']))).toBe(50);
  });
});

describe('scoreLead — opportunity', () => {
  it('gives maximum opportunity when there is no website', () => {
    const s = scoreLead({ ...reachable });
    expect(s.opportunity).toBe(45);
    expect(s.reasons.join(' ')).toContain('No website');
  });

  it('gives high opportunity for a badly failing site', () => {
    const s = scoreLead(
      { ...reachable, website: 'https://x.com' },
      checks(['FAIL', 'FAIL', 'FAIL', 'FAIL']),
    );
    expect(s.opportunity).toBe(45);
  });

  it('gives almost no opportunity for a flawless site', () => {
    const s = scoreLead(
      { ...reachable, website: 'https://x.com' },
      checks(['PASS', 'PASS', 'PASS', 'PASS']),
    );
    expect(s.opportunity).toBe(0);
  });

  it('scores a half-broken site between the two', () => {
    const s = scoreLead(
      { ...reachable, website: 'https://x.com' },
      checks(['PASS', 'FAIL']),
    );
    expect(s.opportunity).toBeGreaterThan(0);
    expect(s.opportunity).toBeLessThan(45);
  });

  it('treats an un-audited website as unknown rather than perfect', () => {
    const unaudited = scoreLead({ ...reachable, website: 'https://x.com' });
    const perfect = scoreLead({ ...reachable, website: 'https://x.com' }, checks(['PASS']));
    expect(unaudited.opportunity).toBeGreaterThan(perfect.opportunity);
  });
});

describe('scoreLead — reachability', () => {
  it('weights email above phone', () => {
    const withEmail = scoreLead({ email: 'a@b.com' });
    const withPhone = scoreLead({ phone: '+34910000111' });
    expect(withEmail.reachability).toBeGreaterThan(withPhone.reachability);
  });

  it('adds up multiple channels', () => {
    const s = scoreLead({ email: 'a@b.com', phone: '+34910000111', instagram_url: 'https://ig/x' });
    expect(s.reachability).toBe(30);
  });

  it('caps an unreachable lead however broken its site is', () => {
    const s = scoreLead({ category: 'gyms', city: 'Madrid', address: 'x', country: 'ES' });
    expect(s.reachability).toBe(0);
    expect(s.capped).toBe(true);
    expect(s.total).toBe(UNREACHABLE_CAP);
    expect(s.reasons.join(' ')).toContain('no way to contact');
  });

  it('does not cap a lead that has any contact route', () => {
    const s = scoreLead({ phone: '+34910000111' });
    expect(s.capped).toBe(false);
  });
});

describe('scoreLead — data quality and evidence', () => {
  it('rewards descriptive fields', () => {
    const bare = scoreLead({ ...reachable });
    const full = scoreLead({
      ...reachable,
      category: 'gyms',
      city: 'Madrid',
      address: 'Calle Mayor 1',
      country: 'ES',
    });
    expect(full.dataQuality).toBeGreaterThan(bare.dataQuality);
    expect(full.dataQuality).toBe(15);
  });

  it('gives no evidence points without an audit', () => {
    expect(scoreLead({ ...reachable }).evidence).toBe(0);
  });

  it('scales evidence with how many checks actually ran', () => {
    const partial = scoreLead(
      { ...reachable, website: 'https://x.com' },
      checks(['PASS', 'NOT_VERIFIED', 'NOT_VERIFIED', 'NOT_VERIFIED']),
    );
    const full = scoreLead(
      { ...reachable, website: 'https://x.com' },
      checks(['PASS', 'PASS', 'PASS', 'PASS']),
    );
    expect(partial.evidence).toBeLessThan(full.evidence);
    expect(full.evidence).toBe(10);
  });

  it('gives an unreachable, unverifiable site no evidence credit', () => {
    const s = scoreLead(
      { ...reachable, website: 'https://x.com' },
      checks(['NOT_VERIFIED', 'NOT_VERIFIED']),
    );
    expect(s.evidence).toBe(0);
  });
});

describe('scoreLead — totals', () => {
  it('never exceeds 100 or drops below 0', () => {
    const best = scoreLead(
      {
        email: 'a@b.com',
        phone: '+34910000111',
        instagram_url: 'https://ig/x',
        category: 'gyms',
        city: 'Madrid',
        address: 'Calle Mayor 1',
        country: 'ES',
      },
      checks(Array(13).fill('FAIL')),
    );
    expect(best.total).toBeLessThanOrEqual(100);
    expect(best.total).toBeGreaterThanOrEqual(0);
  });

  it('ranks a reachable broken business above a reachable perfect one', () => {
    const broken = scoreLead({ ...reachable, website: 'https://a.com' }, checks(['FAIL', 'FAIL']));
    const perfect = scoreLead({ ...reachable, website: 'https://b.com' }, checks(['PASS', 'PASS']));
    expect(broken.total).toBeGreaterThan(perfect.total);
  });

  it('ranks a reachable no-website business at the top band', () => {
    const s = scoreLead({
      ...reachable,
      category: 'gyms',
      city: 'Madrid',
      address: 'Calle Mayor 1',
      country: 'ES',
    });
    expect(s.total).toBeGreaterThanOrEqual(80);
  });

  it('always explains itself', () => {
    const s = scoreLead({ ...reachable });
    expect(s.reasons.length).toBeGreaterThan(0);
  });
});

describe('priorityForScore', () => {
  it('maps score bands to priorities', () => {
    expect(priorityForScore(95)).toBe('critical');
    expect(priorityForScore(80)).toBe('critical');
    expect(priorityForScore(79)).toBe('high');
    expect(priorityForScore(60)).toBe('high');
    expect(priorityForScore(59)).toBe('medium');
    expect(priorityForScore(35)).toBe('medium');
    expect(priorityForScore(34)).toBe('low');
    expect(priorityForScore(0)).toBe('low');
  });
});
