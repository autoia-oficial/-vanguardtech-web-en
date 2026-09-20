import { eq, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { leads, audits, contacts, emails, activities, follow_ups, demos, campaign_leads } from '@/db/schema';
import { ok, fail, notFound, withAuth, readJson } from '@/lib/api';
import { recordActivity, ActivityType, isPipelineStage } from '@/lib/activity';

type Ctx = { params: Promise<{ id: string }> };

const idFrom = async (ctx: Ctx): Promise<number | null> => {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const GET = withAuth<Ctx>(async (_req, _user, ctx) => {
  const id = await idFrom(ctx);
  if (id === null) return fail(400, 'Invalid lead id.');

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, id) });
  if (!lead) return notFound('Lead');

  const [auditRows, contactRows, emailRows, activityRows, followUpRows, demoRows, enrollments] =
    await Promise.all([
      db.query.audits.findMany({
        where: eq(audits.lead_id, id),
        with: { checks: true },
        orderBy: [desc(audits.created_at)],
      }),
      db.select().from(contacts).where(eq(contacts.lead_id, id)),
      db.select().from(emails).where(eq(emails.lead_id, id)).orderBy(desc(emails.created_at)),
      db.select().from(activities).where(eq(activities.lead_id, id)).orderBy(desc(activities.created_at)).limit(200),
      db.select().from(follow_ups).where(eq(follow_ups.lead_id, id)),
      db.select().from(demos).where(eq(demos.lead_id, id)),
      db.query.campaign_leads.findMany({ where: eq(campaign_leads.lead_id, id), with: { campaign: true } }),
    ]);

  return ok({
    lead,
    audit: auditRows[0] ?? null,
    audits: auditRows,
    contacts: contactRows,
    emails: emailRows,
    activities: activityRows,
    follow_ups: followUpRows,
    demos: demoRows,
    campaigns: enrollments,
  });
});

const EDITABLE = [
  'business_name','category','subcategory','city','province','country','address',
  'phone','email','website','google_url','instagram_url','facebook_url','linkedin_url','notes',
] as const;

export const PATCH = withAuth<Ctx>(async (req, _user, ctx) => {
  const id = await idFrom(ctx);
  if (id === null) return fail(400, 'Invalid lead id.');

  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail(400, 'Expected a JSON body.');

  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (key in body) {
      const v = body[key];
      patch[key] = typeof v === 'string' && v.trim() ? v.trim() : v === null ? null : undefined;
      if (patch[key] === undefined) delete patch[key];
    }
  }

  if (typeof body.status === 'string') {
    if (!isPipelineStage(body.status)) return fail(400, `Unknown pipeline stage "${body.status}".`);
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) return fail(400, 'Nothing to update.');
  patch.updated_at = new Date();

  const rows = await db.update(leads).set(patch).where(eq(leads.id, id)).returning();
  if (rows.length === 0) return notFound('Lead');

  await recordActivity(id, ActivityType.LEAD_UPDATED, `Updated ${Object.keys(patch).filter(k => k !== 'updated_at').join(', ')}`);
  return ok(rows[0]);
});

/**
 * Deleting a lead removes its history with it, which is why it is an explicit
 * administrative action rather than something any job performs.
 */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const id = await idFrom(ctx);
  if (id === null) return fail(400, 'Invalid lead id.');
  if (user.role !== 'admin') return fail(403, 'Only an administrator may delete a lead.');

  const rows = await db.delete(leads).where(eq(leads.id, id)).returning();
  if (rows.length === 0) return notFound('Lead');
  return ok({ deleted: true, id });
});
