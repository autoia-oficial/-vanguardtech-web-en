import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { automations } from '@/db/schema';
import { ok, fail, withAuth, readJson } from '@/lib/api';
import { ensureAutomations } from '@/lib/automation/runner';
import { dispatchJob, isJobKey } from '@/lib/automation/dispatch';

type Ctx = { params: Promise<{ key: string }> };

/**
 * Pause, resume, or run a job immediately.
 *
 * "run" is safe to press twice: the dispatcher takes the same lock a cron run
 * would, so a second press while one is in flight is refused rather than
 * duplicating work.
 */
export const POST = withAuth<Ctx>(async (req, _user, ctx) => {
  const { key } = await ctx.params;
  if (!isJobKey(key)) return fail(404, `Unknown automation "${key}".`);

  const body = await readJson<{ action?: string }>(req);
  const action = body?.action;
  await ensureAutomations();

  if (action === 'pause' || action === 'resume') {
    const status = action === 'pause' ? 'PAUSED' : 'ACTIVE';
    const rows = await db.update(automations).set({ status }).where(eq(automations.key, key)).returning();
    return ok(rows[0]);
  }

  if (action === 'run') {
    const outcome = await dispatchJob(key, { force: true });
    if (!outcome.ran) {
      return fail(outcome.reason === 'LOCKED' ? 409 : 400, outcome.reason, outcome.detail);
    }
    return ok(outcome);
  }

  return fail(400, 'action must be one of: pause, resume, run.');
});
