import * as cheerio from 'cheerio';
import { extractEmails } from './contacts';
import { fetchPage, probeHttp, normalizeUrl } from './fetcher';
import { ALL_CHECKS } from './checks';
import { CHECK_NAMES, TOTAL_CHECKS } from './types';
import type { AuditResult, CheckResult, CheckStatus, LeadContext } from './types';

/** Every check as NOT_VERIFIED, used when the page could not be fetched. */
function unverifiedChecks(reason: string): CheckResult[] {
  const now = new Date();
  return Array.from({ length: TOTAL_CHECKS }, (_, i) => ({
    check_number: i + 1,
    check_name: CHECK_NAMES[i + 1],
    status: 'NOT_VERIFIED' as CheckStatus,
    evidence: reason,
    problem: null,
    impact: null,
    priority: null,
    checked_at: now,
  }));
}

export function scoreChecks(checks: CheckResult[]): number {
  const verified = checks.filter((c) => c.status !== 'NOT_VERIFIED');
  if (verified.length === 0) return 0;
  const points = verified.reduce((sum, c) => {
    if (c.status === 'PASS') return sum + 100;
    if (c.status === 'WARNING') return sum + 50;
    return sum;
  }, 0);
  return Math.round(points / verified.length);
}

export function overallStatus(checks: CheckResult[]): CheckStatus {
  const verified = checks.filter((c) => c.status !== 'NOT_VERIFIED');
  if (verified.length === 0) return 'NOT_VERIFIED';
  if (verified.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (verified.some((c) => c.status === 'WARNING')) return 'WARNING';
  return 'PASS';
}

/**
 * Audits a live URL. Never fabricates a result: if the page cannot be
 * retrieved, every check comes back NOT_VERIFIED with the fetch error as
 * evidence.
 */
export async function auditWebsite(url: string, lead: LeadContext = {}): Promise<AuditResult> {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    const reason = `Not a usable URL: "${url}"`;
    return {
      url,
      fetch_error: reason,
      overall_status: 'NOT_VERIFIED',
      overall_score: 0,
      checks: unverifiedChecks(reason),
      emails_found: [],
    };
  }

  const outcome = await fetchPage(normalized);
  if (!outcome.ok) {
    const reason = `Could not fetch the site: ${outcome.failure.error}`;
    return {
      url: normalized,
      fetch_error: outcome.failure.error,
      overall_status: 'NOT_VERIFIED',
      overall_score: 0,
      checks: unverifiedChecks(reason),
      emails_found: [],
    };
  }

  const page = outcome.page;
  const $ = cheerio.load(page.html);

  // Only probe plain http when the page itself is https, to tell "TLS enforced"
  // apart from "TLS available but not required".
  const httpProbe = page.https ? await probeHttp(normalized) : undefined;

  const ctx = { $, page, lead, httpProbe };
  const checks: CheckResult[] = [];
  for (const run of ALL_CHECKS) {
    try {
      checks.push(run(ctx));
    } catch (err) {
      // A crashing check must not lose the other twelve, and must not be
      // reported as a finding about the site.
      const n = ALL_CHECKS.indexOf(run) + 1;
      checks.push({
        check_number: n,
        check_name: CHECK_NAMES[n],
        status: 'NOT_VERIFIED',
        evidence: `Check could not run: ${err instanceof Error ? err.message : String(err)}`,
        problem: null,
        impact: null,
        priority: null,
        checked_at: new Date(),
      });
    }
  }

  checks.sort((a, b) => a.check_number - b.check_number);

  return {
    url: page.finalUrl,
    fetch_error: null,
    overall_status: overallStatus(checks),
    overall_score: scoreChecks(checks),
    checks,
    // La página ya está descargada y parseada: es el único momento honesto
    // de recoger una dirección de contacto sin volver a salir a la red.
    emails_found: extractEmails($, page.finalUrl),
  };
}
