import { desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { automation_runs } from '@/db/schema';
import { ok, withAuth } from '@/lib/api';
import { ensureAutomations, JOB_DEFINITIONS, type JobKey } from '@/lib/automation/runner';

export const GET = withAuth(async () => {
  await ensureAutomations();
  const rows = await db.query.automations.findMany({
    with: { runs: { orderBy: [desc(automation_runs.started_at)], limit: 5 } },
  });

  return ok({
    data: rows.map((a) => {
      const def = JOB_DEFINITIONS[a.key as JobKey];
      const last = a.runs[0] ?? null;
      return {
        ...a,
        schedule: def?.schedule ?? null,
        description: a.description ?? def?.description ?? null,
        last_run_detail: last,
        totals: a.runs.reduce(
          (acc, r) => ({
            processed: acc.processed + r.processed,
            success: acc.success + r.success,
            failed: acc.failed + r.failed,
            skipped: acc.skipped + r.skipped,
          }),
          { processed: 0, success: 0, failed: 0, skipped: 0 },
        ),
      };
    }),
  });
});
