import { eq, and, lte, or, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { automations, automation_runs, errors } from '@/db/schema';
import { withLock } from '@/lib/locks';

/**
 * Every scheduled job runs through here, which guarantees four things:
 *
 *  - it holds a lock, so two overlapping cron invocations never both run it;
 *  - it records a run row with counts, whether it succeeds or throws;
 *  - a throw is captured as an error row rather than taking down the request;
 *  - a paused automation does not run at all.
 */

export interface JobCounters {
  processed: number;
  success: number;
  failed: number;
  skipped: number;
}

export interface JobResult extends Partial<JobCounters> {
  detail?: Record<string, unknown>;
}

export type JobOutcome =
  | { ran: true; run_id: number; counters: JobCounters; detail: Record<string, unknown> }
  | { ran: false; reason: 'LOCKED' | 'PAUSED' | 'UNKNOWN_JOB'; detail?: string };

export const JOB_KEYS = [
  'lead-discovery',
  'website-audit',
  'email-queue',
  'follow-up',
  'crm-maintenance',
  'duplicate-detection',
  'error-retry',
] as const;

export type JobKey = (typeof JOB_KEYS)[number];

export const JOB_DEFINITIONS: Record<JobKey, { name: string; description: string; schedule: string }> = {
  'lead-discovery': {
    name: 'Lead discovery',
    description: 'Searches configured sources for new businesses and records the ones not already known.',
    schedule: '0 */6 * * *',
  },
  'website-audit': {
    name: 'Website audit',
    description: 'Audits leads that have a website and no completed audit, then rescores them.',
    schedule: '15 * * * *',
  },
  'email-queue': {
    name: 'Email queue',
    description: 'Sends due queued email, subject to every safety gate and rate limit.',
    schedule: '*/5 * * * *',
  },
  'follow-up': {
    name: 'Follow-ups',
    description: 'Advances campaign sequences and queues due follow-up steps.',
    schedule: '0 9 * * *',
  },
  'crm-maintenance': {
    name: 'CRM maintenance',
    description: 'Stops sequences for replied or converted leads, reclaims stuck sends, prunes sessions and locks.',
    schedule: '30 * * * *',
  },
  'duplicate-detection': {
    name: 'Duplicate detection',
    description: 'Reports groups of leads that look like the same business.',
    schedule: '0 2 * * 0',
  },
  'error-retry': {
    name: 'Error retry',
    description: 'Re-attempts recorded failures whose backoff has elapsed.',
    schedule: '*/30 * * * *',
  },
};

/** Creates any automation rows that do not exist yet. Safe to call repeatedly. */
export async function ensureAutomations(): Promise<void> {
  for (const key of JOB_KEYS) {
    const def = JOB_DEFINITIONS[key];
    await db
      .insert(automations)
      .values({ key, name: def.name, description: def.description, status: 'ACTIVE' })
      .onConflictDoNothing({ target: automations.key });
  }
}

export async function getAutomation(key: JobKey) {
  await ensureAutomations();
  return db.query.automations.findFirst({ where: eq(automations.key, key) });
}

/**
 * Runs `fn` as the named job.
 *
 * `force` bypasses the paused check for an explicit "run now" from the UI, but
 * never bypasses the lock — a manual trigger must not collide with a cron run.
 */
export async function runJob(
  key: JobKey,
  fn: () => Promise<JobResult>,
  options: { force?: boolean; lockTtlMs?: number } = {},
): Promise<JobOutcome> {
  const automation = await getAutomation(key);
  if (!automation) return { ran: false, reason: 'UNKNOWN_JOB' };

  if (automation.status !== 'ACTIVE' && !options.force) {
    return { ran: false, reason: 'PAUSED', detail: `Automation "${key}" is ${automation.status}.` };
  }

  const outcome = await withLock(
    `job:${key}`,
    async (): Promise<JobOutcome> => {
      const startedAt = new Date();
      const runRows = await db
        .insert(automation_runs)
        .values({ automation_id: automation.id, started_at: startedAt, status: 'RUNNING' })
        .returning();
      const run = runRows[0];

      try {
        const result = await fn();
        const counters: JobCounters = {
          processed: result.processed ?? 0,
          success: result.success ?? 0,
          failed: result.failed ?? 0,
          skipped: result.skipped ?? 0,
        };
        const detail = result.detail ?? {};

        await db
          .update(automation_runs)
          .set({
            ...counters,
            detail,
            status: 'COMPLETED',
            completed_at: new Date(),
          })
          .where(eq(automation_runs.id, run.id));

        await db
          .update(automations)
          .set({ last_run: startedAt })
          .where(eq(automations.id, automation.id));

        return { ran: true, run_id: run.id, counters, detail };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        await db
          .update(automation_runs)
          .set({
            status: 'FAILED',
            completed_at: new Date(),
            detail: { error: message },
          })
          .where(eq(automation_runs.id, run.id));

        await db.insert(errors).values({
          automation_id: automation.id,
          error_type: 'JOB_FAILED',
          message,
          context: { job: key, run_id: run.id },
        });

        await db
          .update(automations)
          .set({ last_run: startedAt })
          .where(eq(automations.id, automation.id));

        // The job failed, but the request itself succeeded in recording that.
        return {
          ran: true,
          run_id: run.id,
          counters: { processed: 0, success: 0, failed: 1, skipped: 0 },
          detail: { error: message },
        };
      }
    },
    options.lockTtlMs,
  );

  if (outcome === null) {
    return { ran: false, reason: 'LOCKED', detail: `Another run of "${key}" is in progress.` };
  }
  return outcome;
}

/**
 * Records a per-item failure without aborting the surrounding job.
 * One broken lead must never stop the queue.
 */
export async function recordItemError(params: {
  job: JobKey;
  leadId?: number | null;
  type: string;
  message: string;
  context?: Record<string, unknown>;
  retryCount?: number;
  nextRetryAt?: Date | null;
}): Promise<void> {
  const automation = await getAutomation(params.job);
  await db.insert(errors).values({
    automation_id: automation?.id ?? null,
    lead_id: params.leadId ?? null,
    error_type: params.type,
    message: params.message,
    context: { job: params.job, ...(params.context ?? {}) },
    retry_count: params.retryCount ?? 0,
    next_retry_at: params.nextRetryAt ?? null,
  });
}

export async function dueErrors(now: Date = new Date(), limit = 50) {
  return db.query.errors.findMany({
    where: and(
      eq(errors.resolved, false),
      or(isNull(errors.next_retry_at), lte(errors.next_retry_at, now)),
    ),
    limit,
  });
}

export async function resolveError(id: number): Promise<void> {
  await db.update(errors).set({ resolved: true }).where(eq(errors.id, id));
}
