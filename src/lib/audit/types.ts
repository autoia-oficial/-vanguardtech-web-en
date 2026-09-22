export type CheckStatus = 'PASS' | 'WARNING' | 'FAIL' | 'NOT_VERIFIED';
export type CheckPriority = 'low' | 'medium' | 'high' | 'critical';

export interface CheckResult {
  check_number: number;
  check_name: string;
  status: CheckStatus;
  /** What was actually observed. Never a guess. */
  evidence: string | null;
  /** The problem this represents, when the status is not PASS. */
  problem: string | null;
  /** Why it matters commercially. */
  impact: string | null;
  priority: CheckPriority | null;
  checked_at: Date;
}

export interface AuditResult {
  url: string;
  /** Set when the site could not be fetched at all; every check is NOT_VERIFIED. */
  fetch_error: string | null;
  overall_status: CheckStatus;
  overall_score: number;
  checks: CheckResult[];
  /**
   * Contact addresses published on the page. Empty when the page publishes
   * none — never inferred from the domain.
   */
  emails_found: string[];
}

/** Facts gathered about a lead that some checks compare the page against. */
export interface LeadContext {
  business_name?: string | null;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
}

export const CHECK_NAMES: Record<number, string> = {
  1: 'Mobile / Responsive',
  2: 'HTTPS',
  3: 'Performance',
  4: 'Visual Structure',
  5: 'CTA',
  6: 'Click to Call',
  7: 'Opening Hours',
  8: 'Services',
  9: 'Location',
  10: 'Contactability',
  11: 'Basic SEO',
  12: 'Images / Content',
  13: 'Local Consistency',
};

export const TOTAL_CHECKS = 13;
