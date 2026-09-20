import { describe, it, expect } from 'vitest';
import { calculateLeadScore, calculateAuditScore, getOverallAuditStatus } from './scoring';
import type { Lead, AuditCheck } from '@/types';

const baseLead: Lead = {
  id: 1,
  business_name: 'Test Business',
  status: 'NEW',
  priority: 'medium',
  score: 0,
  created_at: new Date(),
  updated_at: new Date(),
};

const makeCheck = (status: AuditCheck['status']): AuditCheck => ({
  id: 1,
  audit_id: 1,
  check_number: 1,
  check_name: 'Test',
  status,
  score: 0,
});

describe('calculateAuditScore', () => {
  it('returns 0 for an empty check list', () => {
    expect(calculateAuditScore([])).toBe(0);
  });

  it('returns 0 when every check is unverified', () => {
    expect(calculateAuditScore([makeCheck('NOT_VERIFIED'), makeCheck('NOT_VERIFIED')])).toBe(0);
  });

  it('scores PASS as 100 and FAIL as 0', () => {
    expect(calculateAuditScore([makeCheck('PASS')])).toBe(100);
    expect(calculateAuditScore([makeCheck('FAIL')])).toBe(0);
    expect(calculateAuditScore([makeCheck('PASS'), makeCheck('FAIL')])).toBe(50);
  });

  it('scores WARNING as 50', () => {
    expect(calculateAuditScore([makeCheck('WARNING')])).toBe(50);
  });

  it('ignores unverified checks when averaging', () => {
    expect(calculateAuditScore([makeCheck('PASS'), makeCheck('NOT_VERIFIED')])).toBe(100);
  });
});

describe('getOverallAuditStatus', () => {
  it('returns NOT_VERIFIED when nothing has been checked', () => {
    expect(getOverallAuditStatus([makeCheck('NOT_VERIFIED')])).toBe('NOT_VERIFIED');
  });

  it('returns FAIL when any check fails', () => {
    expect(getOverallAuditStatus([makeCheck('PASS'), makeCheck('FAIL')])).toBe('FAIL');
  });

  it('returns WARNING when there are warnings but no failures', () => {
    expect(getOverallAuditStatus([makeCheck('PASS'), makeCheck('WARNING')])).toBe('WARNING');
  });

  it('returns PASS when all checks pass', () => {
    expect(getOverallAuditStatus([makeCheck('PASS'), makeCheck('PASS')])).toBe('PASS');
  });
});

describe('calculateLeadScore', () => {
  it('gives a base score with no contact data', () => {
    expect(calculateLeadScore(baseLead)).toBe(25);
  });

  it('adds points for each piece of contact data', () => {
    const withContact = { ...baseLead, email: 'a@b.com', phone: '+34123', website: 'https://x.com' };
    expect(calculateLeadScore(withContact)).toBe(55);
  });

  it('weights priority', () => {
    expect(calculateLeadScore({ ...baseLead, priority: 'critical' })).toBeGreaterThan(
      calculateLeadScore({ ...baseLead, priority: 'low' })
    );
  });

  it('never exceeds 100', () => {
    const maxed = {
      ...baseLead,
      email: 'a@b.com',
      phone: '+34123',
      website: 'https://x.com',
      priority: 'critical' as const,
    };
    const checks = Array.from({ length: 13 }, () => makeCheck('PASS'));
    expect(calculateLeadScore(maxed, checks)).toBeLessThanOrEqual(100);
  });
});
