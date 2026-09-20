import { sql, eq, gte, and, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { leads, emails, follow_ups, activities, errors, automation_runs } from '@/db/schema';
import { ok, withAuth } from '@/lib/api';
import { allIntegrations } from '@/lib/config';
import { PIPELINE_STAGES } from '@/lib/activity';

export const GET = withAuth(async () => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const stageRows = await db
    .select({ status: leads.status, n: sql<number>`count(*)::int` })
    .from(leads)
    .groupBy(leads.status);

  const byStage: Record<string, number> = {};
  for (const stage of PIPELINE_STAGES) byStage[stage] = 0;
  for (const row of stageRows) byStage[row.status] = row.n;

  const totalLeads = stageRows.reduce((sum, r) => sum + r.n, 0);

  const priorityRows = await db
    .select({ priority: leads.priority, n: sql<number>`count(*)::int` })
    .from(leads)
    .groupBy(leads.priority);
  const priorityLeads = priorityRows
    .filter((r) => r.priority === 'high' || r.priority === 'critical')
    .reduce((s, r) => s + r.n, 0);

  const auditedCount = byStage.AUDITED ?? 0;
  const contactedStages = ['CONTACTED','REPLIED','DEMO_SENT','INTERESTED','MEETING','ACCEPTED','PAID','PROJECT','LIVE'];
  const repliedStages = ['REPLIED','INTERESTED','MEETING','ACCEPTED','PAID','PROJECT','LIVE'];

  const sum = (stages: string[]) => stages.reduce((s, k) => s + (byStage[k] ?? 0), 0);

  const [emailsToday, followUpsToday, emailStatusRows, openErrors, automationRows, recentActivity] =
    await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(emails)
        .where(and(eq(emails.status, 'SENT'), gte(emails.sent_at, startOfDay))),
      db.select({ n: sql<number>`count(*)::int` }).from(follow_ups)
        .where(and(eq(follow_ups.status, 'PENDING'), gte(follow_ups.scheduled_at, startOfDay), sql`${follow_ups.scheduled_at} < ${endOfDay}`)),
      db.select({ status: emails.status, n: sql<number>`count(*)::int` }).from(emails).groupBy(emails.status),
      db.select({ n: sql<number>`count(*)::int` }).from(errors).where(eq(errors.resolved, false)),
      db.query.automations.findMany({ with: { runs: { orderBy: [desc(automation_runs.started_at)], limit: 1 } } }),
      db.select().from(activities).orderBy(desc(activities.created_at)).limit(25),
    ]);

  const emailsByStatus: Record<string, number> = {};
  for (const r of emailStatusRows) emailsByStatus[r.status] = r.n;

  return ok({
    stats: {
      total_leads: totalLeads,
      new_leads: byStage.NEW ?? 0,
      audited: auditedCount,
      priority_leads: priorityLeads,
      contacted: sum(contactedStages),
      replies: sum(repliedStages),
      demos: sum(['DEMO_SENT','INTERESTED']),
      meetings: byStage.MEETING ?? 0,
      accepted: byStage.ACCEPTED ?? 0,
      paid: byStage.PAID ?? 0,
      live: byStage.LIVE ?? 0,
      emails_today: emailsToday[0]?.n ?? 0,
      follow_ups_today: followUpsToday[0]?.n ?? 0,
      open_errors: openErrors[0]?.n ?? 0,
    },
    pipeline: byStage,
    emails_by_status: emailsByStatus,
    automations: automationRows,
    activity: recentActivity,
    integrations: allIntegrations(),
  });
});
