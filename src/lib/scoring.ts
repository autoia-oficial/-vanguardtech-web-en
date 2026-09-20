import type { Lead, AuditCheck } from '@/types';

export const calculateLeadScore = (lead: Lead, auditChecks?: AuditCheck[]): number => {
  let score = 0;

  // Base score: 20 points
  score += 20;

  // Contact information: up to 30 points
  if (lead.email) score += 10;
  if (lead.phone) score += 10;
  if (lead.website) score += 10;

  // Website quality: up to 20 points
  if (auditChecks && auditChecks.length > 0) {
    const passCount = auditChecks.filter(c => c.status === 'PASS').length;
    const totalChecks = auditChecks.length;
    score += Math.round((passCount / totalChecks) * 20);
  }

  // Audit completion: up to 15 points
  if (auditChecks && auditChecks.length > 0) {
    const verifiedCount = auditChecks.filter(c => c.status !== 'NOT_VERIFIED').length;
    if (verifiedCount > 0) score += 15;
  }

  // Priority boost: up to 15 points
  if (lead.priority === 'critical') score += 15;
  else if (lead.priority === 'high') score += 10;
  else if (lead.priority === 'medium') score += 5;

  return Math.min(score, 100);
};

export const calculateAuditScore = (checks: AuditCheck[]): number => {
  if (checks.length === 0) return 0;

  const scores: number[] = checks
    .filter(c => c.status !== 'NOT_VERIFIED')
    .map(c => {
      if (c.status === 'PASS') return 100;
      if (c.status === 'WARNING') return 50;
      return 0;
    });

  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
};

export const getOverallAuditStatus = (checks: AuditCheck[]): 'PASS' | 'WARNING' | 'FAIL' | 'NOT_VERIFIED' => {
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  const warningCount = checks.filter(c => c.status === 'WARNING').length;
  const notVerifiedCount = checks.filter(c => c.status === 'NOT_VERIFIED').length;

  if (notVerifiedCount === checks.length) return 'NOT_VERIFIED';
  if (failCount > 0) return 'FAIL';
  if (warningCount > 0) return 'WARNING';
  return 'PASS';
};
