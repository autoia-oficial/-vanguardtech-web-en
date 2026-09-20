import type { CheckResult } from '@/lib/audit/types';

/**
 * Lead scoring — 0 to 100.
 *
 * The score answers one question: how much is this lead worth contacting next?
 * Vanguard Tech builds and fixes websites, so the ideal lead is a business that
 * visibly needs that work AND can actually be reached. A flawless site scores
 * low not because the business is bad but because there is nothing to sell it.
 *
 * Four components, weights chosen to sum to 100:
 *
 *   Opportunity      0-45   How much the business needs the work.
 *                           No website at all is the strongest signal (45).
 *                           With a website, opportunity is the inverse of the
 *                           audit score: a site scoring 20/100 yields 36 points.
 *                           Un-audited sites get a neutral 20 — unknown, not zero.
 *
 *   Reachability     0-30   Whether we can open a conversation.
 *                           email 18, phone 8, any social profile 4.
 *                           Email dominates because outbound runs on email.
 *
 *   Data quality     0-15   Whether we know enough to write something specific.
 *                           category, city, address, postal/country: 3.75 each.
 *
 *   Evidence         0-10   Confidence in the above. Full 10 only when every
 *                           one of the 13 checks actually ran; proportional
 *                           otherwise. An unverifiable site cannot score top.
 *
 * A lead with no contact route is capped at 40 regardless of opportunity:
 * an unreachable business is not actionable no matter how broken its site.
 */

export const SCORE_WEIGHTS = {
  opportunity: 45,
  reachability: 30,
  dataQuality: 15,
  evidence: 10,
} as const;

/** Cap applied when there is no way to contact the business at all. */
export const UNREACHABLE_CAP = 40;

export interface ScoringInput {
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
  category?: string | null;
  city?: string | null;
  address?: string | null;
  country?: string | null;
}

export interface ScoreBreakdown {
  total: number;
  opportunity: number;
  reachability: number;
  dataQuality: number;
  evidence: number;
  capped: boolean;
  reasons: string[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function auditScoreOf(checks: CheckResult[]): number | null {
  const verified = checks.filter((c) => c.status !== 'NOT_VERIFIED');
  if (verified.length === 0) return null;
  const points = verified.reduce(
    (sum, c) => sum + (c.status === 'PASS' ? 100 : c.status === 'WARNING' ? 50 : 0),
    0,
  );
  return Math.round(points / verified.length);
}

export function scoreLead(lead: ScoringInput, checks: CheckResult[] = []): ScoreBreakdown {
  const reasons: string[] = [];

  // --- Opportunity -------------------------------------------------------
  let opportunity: number;
  const hasWebsite = Boolean(lead.website && lead.website.trim());
  const auditScore = auditScoreOf(checks);

  if (!hasWebsite) {
    opportunity = SCORE_WEIGHTS.opportunity;
    reasons.push('No website on record — maximum opportunity.');
  } else if (auditScore === null) {
    opportunity = Math.round(SCORE_WEIGHTS.opportunity * 0.44);
    reasons.push('Website not audited yet — opportunity unknown, scored neutral.');
  } else {
    opportunity = Math.round(SCORE_WEIGHTS.opportunity * (1 - auditScore / 100));
    reasons.push(`Website audited at ${auditScore}/100 — opportunity scales inversely.`);
  }

  // --- Reachability ------------------------------------------------------
  let reachability = 0;
  const hasEmail = Boolean(lead.email && lead.email.trim());
  const hasPhone = Boolean(lead.phone && lead.phone.trim());
  const hasSocial = Boolean(lead.instagram_url || lead.facebook_url || lead.linkedin_url);

  if (hasEmail) {
    reachability += 18;
    reasons.push('Email on record (+18).');
  }
  if (hasPhone) {
    reachability += 8;
    reasons.push('Phone on record (+8).');
  }
  if (hasSocial) {
    reachability += 4;
    reasons.push('Social profile on record (+4).');
  }
  if (!hasEmail && !hasPhone && !hasSocial) {
    reasons.push('No contact route on record.');
  }

  // --- Data quality ------------------------------------------------------
  const dataFields = [lead.category, lead.city, lead.address, lead.country];
  const filled = dataFields.filter((f) => Boolean(f && String(f).trim())).length;
  const dataQuality = Math.round((filled / dataFields.length) * SCORE_WEIGHTS.dataQuality);
  reasons.push(`${filled}/${dataFields.length} descriptive fields present.`);

  // --- Evidence ----------------------------------------------------------
  const verifiedCount = checks.filter((c) => c.status !== 'NOT_VERIFIED').length;
  const evidence =
    checks.length === 0
      ? 0
      : Math.round((verifiedCount / checks.length) * SCORE_WEIGHTS.evidence);
  if (checks.length > 0) {
    reasons.push(`${verifiedCount}/${checks.length} checks verified.`);
  }

  let total = opportunity + reachability + dataQuality + evidence;
  let capped = false;

  if (reachability === 0 && total > UNREACHABLE_CAP) {
    total = UNREACHABLE_CAP;
    capped = true;
    reasons.push(`Capped at ${UNREACHABLE_CAP}: no way to contact this business.`);
  }

  return {
    total: clamp(Math.round(total), 0, 100),
    opportunity,
    reachability,
    dataQuality,
    evidence,
    capped,
    reasons,
  };
}

/** Priority band derived from the score, used for queue ordering in the CRM. */
export function priorityForScore(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}
