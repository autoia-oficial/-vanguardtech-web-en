import { ok, fail, withCronAuth } from '@/lib/api';
import { dispatchJob, isJobKey } from '@/lib/automation/dispatch';

/**
 * One route per job via the path segment. Vercel Cron calls these on the
 * schedules declared in vercel.json.
 *
 * Auth is enforced by withCronAuth, which refuses outright when CRON_SECRET is
 * not set rather than falling back to any default value.
 */
export const GET = withCronAuth(async (req) => {
  const segments = req.nextUrl.pathname.split('/');
  const job = segments[segments.length - 1];

  if (!isJobKey(job)) return fail(404, `Unknown job "${job}".`);

  const outcome = await dispatchJob(job);
  if (!outcome.ran) {
    // A locked or paused job is a normal, non-error outcome for a scheduler.
    return ok({ job, ran: false, reason: outcome.reason, detail: outcome.detail ?? null });
  }
  return ok({ job, ...outcome });
});

export const POST = GET;
