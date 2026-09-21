import { and, eq, isNotNull, lte, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { leads, audits, audit_checks, campaigns, emails, errors, follow_ups, settings } from '@/db/schema';
import { auditWebsite } from '@/lib/audit/auditor';
import { scoreLead, priorityForScore } from '@/lib/scoring';
import { runDiscovery } from '@/lib/discovery/engine';
import { processEmailQueue, reclaimStuckSending } from '@/lib/email/queue';
import {
  advanceCampaign,
  scheduleNextStep,
  reconcileStoppedLeads,
  cancelOutboundForStoppedLeads,
} from '@/lib/campaigns/sequences';
import { findDuplicateGroups } from '@/lib/dedupe';
import { recordActivity, ActivityType, changeLeadStatus } from '@/lib/activity';
import { clearExpiredLocks, nextRetryAt } from '@/lib/locks';
import { pruneExpiredSessions } from '@/lib/auth';
import { pruneLoginAttempts } from '@/lib/rate-limit';
import { dueErrors, recordItemError, resolveError } from './runner';
import type { JobResult } from './runner';
import type { CheckResult } from '@/lib/audit/types';

/** Attempts before an unreachable site stops being re-queued. */
const MAX_AUDIT_RETRIES = 5;

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string, type = 'string'): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, type, updated_at: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, type, updated_at: new Date() } });
}

async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// lead-discovery
// ---------------------------------------------------------------------------

/**
 * Runs the saved discovery queries. Queries live in settings so the job has
 * something concrete to do without inventing a search of its own.
 */
export async function jobLeadDiscovery(): Promise<JobResult> {
  const raw = await getSetting('discovery.queries');
  if (!raw) {
    return {
      processed: 0,
      detail: {
        note: 'No saved discovery queries. Add them under Settings → discovery.queries as a JSON array of {country, province, city, category, limit}.',
      },
    };
  }

  let queries: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(raw);
    queries = Array.isArray(parsed) ? parsed : [];
  } catch {
    return { failed: 1, detail: { error: 'discovery.queries is not valid JSON.' } };
  }

  let processed = 0;
  let created = 0;
  let duplicates = 0;
  let failed = 0;
  const perQuery: unknown[] = [];

  for (const q of queries) {
    processed++;
    try {
      const outcome = await runDiscovery({
        country: typeof q.country === 'string' ? q.country : undefined,
        province: typeof q.province === 'string' ? q.province : undefined,
        city: typeof q.city === 'string' ? q.city : undefined,
        category: typeof q.category === 'string' ? q.category : undefined,
        limit: typeof q.limit === 'number' ? q.limit : undefined,
      });
      created += outcome.created;
      duplicates += outcome.duplicates;
      failed += outcome.errors.length;
      perQuery.push(outcome);
    } catch (err) {
      failed++;
      await recordItemError({
        job: 'lead-discovery',
        type: 'DISCOVERY_QUERY_FAILED',
        message: err instanceof Error ? err.message : String(err),
        context: { query: q },
      });
    }
  }

  return {
    processed,
    success: created,
    skipped: duplicates,
    failed,
    detail: { created, duplicates, queries: perQuery },
  };
}

// ---------------------------------------------------------------------------
// website-audit
// ---------------------------------------------------------------------------

async function persistAudit(leadId: number, url: string, lead: typeof leads.$inferSelect) {
  const result = await auditWebsite(url, {
    business_name: lead.business_name,
    phone: lead.phone,
    city: lead.city,
    address: lead.address,
  });

  const auditRows = await db
    .insert(audits)
    .values({
      lead_id: leadId,
      url: result.url,
      overall_status: result.overall_status,
      overall_score: result.overall_score,
      fetch_error: result.fetch_error,
    })
    .returning();
  const audit = auditRows[0];

  await db.insert(audit_checks).values(
    result.checks.map((c) => ({
      audit_id: audit.id,
      check_number: c.check_number,
      check_name: c.check_name,
      status: c.status,
      evidence: c.evidence,
      problem: c.problem,
      impact: c.impact,
      priority: c.priority,
      checked_at: c.checked_at,
    })),
  );

  return { audit, checks: result.checks, fetchError: result.fetch_error };
}

/** Recomputes and stores a lead's score from its most recent audit. */
export async function rescoreLead(leadId: number): Promise<number | null> {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  if (!lead) return null;

  const latest = await db.query.audits.findFirst({
    where: eq(audits.lead_id, leadId),
    orderBy: (a, { desc }) => [desc(a.created_at)],
    with: { checks: true },
  });

  const checks: CheckResult[] = (latest?.checks ?? []).map((c) => ({
    check_number: c.check_number,
    check_name: c.check_name,
    status: c.status as CheckResult['status'],
    evidence: c.evidence,
    problem: c.problem,
    impact: c.impact,
    priority: c.priority as CheckResult['priority'],
    checked_at: c.checked_at ?? new Date(),
  }));

  const breakdown = scoreLead(lead, checks);
  const priority = priorityForScore(breakdown.total);

  if (lead.score !== breakdown.total || lead.priority !== priority) {
    await db
      .update(leads)
      .set({ score: breakdown.total, priority, updated_at: new Date() })
      .where(eq(leads.id, leadId));

    await recordActivity(
      leadId,
      ActivityType.SCORE_CHANGED,
      `Score ${lead.score} → ${breakdown.total} (${priority})`,
      { breakdown },
    );
  }

  return breakdown.total;
}

export async function jobWebsiteAudit(limit?: number): Promise<JobResult> {
  const batch = limit ?? (await getNumberSetting('audit.batch_size', 10));

  // Leads with a website that have never been audited.
  const candidates = await db.query.leads.findMany({
    where: and(isNotNull(leads.website), inArray(leads.status, ['NEW', 'QUALIFIED', 'AUDIT_READY'])),
    limit: batch * 3,
  });

  let processed = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const lead of candidates) {
    if (processed >= batch) break;
    if (!lead.website) {
      skipped++;
      continue;
    }

    const existing = await db.query.audits.findFirst({ where: eq(audits.lead_id, lead.id) });
    if (existing) {
      skipped++;
      continue;
    }

    processed++;
    try {
      await recordActivity(lead.id, ActivityType.AUDIT_STARTED, `Auditing ${lead.website}`);
      const { checks, fetchError } = await persistAudit(lead.id, lead.website, lead);
      await rescoreLead(lead.id);

      if (fetchError) {
        await recordActivity(
          lead.id,
          ActivityType.AUDIT_FAILED,
          `Site could not be audited: ${fetchError}`,
        );
        await recordItemError({
          job: 'website-audit',
          leadId: lead.id,
          type: 'AUDIT_FETCH_FAILED',
          message: fetchError,
          context: { url: lead.website },
          nextRetryAt: nextRetryAt(1),
        });
        failed++;
      } else {
        const problems = checks.filter((c) => c.status === 'FAIL').length;
        await recordActivity(
          lead.id,
          ActivityType.AUDIT_COMPLETED,
          `Audit complete — ${problems} failing check(s)`,
        );
        await changeLeadStatus(lead.id, 'AUDITED', 'audit completed');
        success++;
      }
    } catch (err) {
      failed++;
      // One unauditable site must not stop the batch.
      await recordItemError({
        job: 'website-audit',
        leadId: lead.id,
        type: 'AUDIT_CRASHED',
        message: err instanceof Error ? err.message : String(err),
        context: { url: lead.website },
        nextRetryAt: nextRetryAt(1),
      });
    }
  }

  return { processed, success, failed, skipped };
}

// ---------------------------------------------------------------------------
// email-queue
// ---------------------------------------------------------------------------

export async function jobEmailQueue(): Promise<JobResult> {
  const batchSize = await getNumberSetting('email.batch_size', 25);
  const recentDays = await getNumberSetting('email.recent_contact_days', 14);

  await reclaimStuckSending();
  const summary = await processEmailQueue({ batchSize, recentContactDays: recentDays });

  // Booking the next sequence step only makes sense for mail that actually went out.
  const justSent = await db.query.emails.findMany({
    where: and(eq(emails.status, 'SENT'), isNotNull(emails.campaign_id)),
    limit: batchSize,
    orderBy: (e, { desc }) => [desc(e.sent_at)],
  });
  for (const email of justSent) {
    try {
      await scheduleNextStep(email.id);
    } catch (err) {
      await recordItemError({
        job: 'email-queue',
        leadId: email.lead_id,
        type: 'SCHEDULE_NEXT_STEP_FAILED',
        message: err instanceof Error ? err.message : String(err),
        context: { email_id: email.id },
      });
    }
  }

  return {
    processed: summary.claimed,
    success: summary.sent,
    failed: summary.failed,
    skipped: summary.blocked,
    detail: summary as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// follow-up
// ---------------------------------------------------------------------------

export async function jobFollowUp(now: Date = new Date()): Promise<JobResult> {
  const active = await db.query.campaigns.findMany({ where: eq(campaigns.status, 'ACTIVE') });

  let processed = 0;
  let queued = 0;
  let stopped = 0;
  let skipped = 0;
  const details: unknown[] = [];

  for (const campaign of active) {
    processed++;
    try {
      const summary = await advanceCampaign(campaign.id, now);
      queued += summary.queued;
      stopped += summary.stopped;
      skipped += summary.skipped;
      details.push(summary);
    } catch (err) {
      await recordItemError({
        job: 'follow-up',
        type: 'CAMPAIGN_ADVANCE_FAILED',
        message: err instanceof Error ? err.message : String(err),
        context: { campaign_id: campaign.id },
      });
    }
  }

  // Follow-ups whose lead left the funnel entirely.
  const orphaned = await db.query.follow_ups.findMany({
    where: and(eq(follow_ups.status, 'PENDING'), lte(follow_ups.scheduled_at, now)),
  });
  for (const f of orphaned) {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, f.lead_id) });
    if (lead && ['DO_NOT_CONTACT', 'LOST', 'PAID', 'PROJECT', 'LIVE'].includes(lead.status)) {
      await db
        .update(follow_ups)
        .set({ status: 'CANCELLED', cancel_reason: lead.status })
        .where(eq(follow_ups.id, f.id));
      stopped++;
    }
  }

  return { processed, success: queued, skipped, detail: { stopped, campaigns: details } };
}

// ---------------------------------------------------------------------------
// crm-maintenance
// ---------------------------------------------------------------------------

export async function jobCrmMaintenance(): Promise<JobResult> {
  const stoppedSequences = await reconcileStoppedLeads();
  const cancelledEmails = await cancelOutboundForStoppedLeads();
  const reclaimed = await reclaimStuckSending();
  const locks = await clearExpiredLocks();
  const sessions = await pruneExpiredSessions();
  const loginAttempts = await pruneLoginAttempts();

  // Leads whose audit finished but whose stage never moved on.
  const auditedLeads = await db.query.leads.findMany({
    where: inArray(leads.status, ['NEW', 'QUALIFIED', 'AUDIT_READY']),
    limit: 200,
  });
  let promoted = 0;
  for (const lead of auditedLeads) {
    const audit = await db.query.audits.findFirst({ where: eq(audits.lead_id, lead.id) });
    if (audit && audit.overall_status !== 'NOT_VERIFIED') {
      if (await changeLeadStatus(lead.id, 'AUDITED', 'maintenance reconciliation')) promoted++;
    }
  }

  return {
    processed:
      stoppedSequences + cancelledEmails + reclaimed + locks + sessions + loginAttempts + promoted,
    success: stoppedSequences + cancelledEmails + promoted,
    detail: {
      sequences_stopped: stoppedSequences,
      outbound_cancelled: cancelledEmails,
      stuck_sends_reclaimed: reclaimed,
      expired_locks_cleared: locks,
      expired_sessions_pruned: sessions,
      login_attempt_counters_pruned: loginAttempts,
      leads_promoted_to_audited: promoted,
    },
  };
}

// ---------------------------------------------------------------------------
// duplicate-detection
// ---------------------------------------------------------------------------

export async function jobDuplicateDetection(): Promise<JobResult> {
  const groups = await findDuplicateGroups();

  for (const group of groups) {
    await recordItemError({
      job: 'duplicate-detection',
      leadId: group.lead_ids[0],
      type: 'DUPLICATE_LEADS',
      message: `${group.lead_ids.length} leads match on ${group.matched_on}: ${group.lead_ids.join(', ')}`,
      context: { matched_on: group.matched_on, lead_ids: group.lead_ids, key: group.key },
    });
  }

  return {
    processed: groups.length,
    success: groups.length,
    detail: { groups },
  };
}

// ---------------------------------------------------------------------------
// error-retry
// ---------------------------------------------------------------------------

/**
 * Re-attempts recorded failures whose backoff has elapsed.
 * Only error types with a defined retry action are acted on; the rest are left
 * for a human, which is why they stay unresolved and visible.
 */
export async function jobErrorRetry(now: Date = new Date()): Promise<JobResult> {
  const pending = await dueErrors(now, 50);

  let processed = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const error of pending) {
    processed++;

    if (error.error_type === 'AUDIT_FETCH_FAILED' || error.error_type === 'AUDIT_CRASHED') {
      const leadId = error.lead_id;
      if (!leadId) {
        skipped++;
        continue;
      }
      const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
      if (!lead?.website) {
        await resolveError(error.id);
        skipped++;
        continue;
      }

      try {
        const { fetchError } = await persistAudit(leadId, lead.website, lead);
        await rescoreLead(leadId);
        if (fetchError) {
          const attempt = error.retry_count + 1;
          if (attempt >= MAX_AUDIT_RETRIES) {
            // Give up rather than retrying a dead domain forever.
            await resolveError(error.id);
            await recordActivity(
              leadId,
              ActivityType.AUDIT_FAILED,
              `Audit abandoned after ${attempt} attempts: ${fetchError}`,
            );
          } else {
            await db
              .update(errors)
              .set({ retry_count: attempt, next_retry_at: nextRetryAt(attempt, now) })
              .where(eq(errors.id, error.id));
          }
          failed++;
        } else {
          await resolveError(error.id);
          await changeLeadStatus(leadId, 'AUDITED', 'audit retry succeeded');
          success++;
        }
      } catch {
        failed++;
      }
      continue;
    }

    skipped++;
  }

  return { processed, success, failed, skipped };
}
