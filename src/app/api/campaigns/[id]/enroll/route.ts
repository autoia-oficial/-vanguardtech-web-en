import { and, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { campaigns, leads } from '@/db/schema';
import { ok, fail, withAuth, readJson } from '@/lib/api';
import { enrollLead } from '@/lib/campaigns/sequences';
import { NO_OUTREACH_STAGES } from '@/lib/activity';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Enrols leads into a campaign, either by explicit ids or by a filter.
 * Leads that must not be contacted are refused here, not silently dropped later.
 */
export const POST = withAuth<Ctx>(async (req, _user, ctx) => {
  const { id } = await ctx.params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) return fail(400, 'Invalid campaign id.');

  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
  if (!campaign) return fail(404, 'Campaign not found.');

  const body = await readJson<{ lead_ids?: number[]; filter?: Record<string, string> }>(req);

  let candidates: Array<{ id: number; status: string; email: string | null }> = [];

  if (Array.isArray(body?.lead_ids) && body.lead_ids.length > 0) {
    candidates = await db
      .select({ id: leads.id, status: leads.status, email: leads.email })
      .from(leads)
      .where(inArray(leads.id, body.lead_ids));
  } else if (body?.filter) {
    const clauses: SQL[] = [isNotNull(leads.email)];
    if (body.filter.status) clauses.push(eq(leads.status, body.filter.status));
    if (body.filter.category) clauses.push(eq(leads.category, body.filter.category));
    if (body.filter.city) clauses.push(eq(leads.city, body.filter.city));
    if (body.filter.priority) clauses.push(eq(leads.priority, body.filter.priority));
    candidates = await db
      .select({ id: leads.id, status: leads.status, email: leads.email })
      .from(leads)
      .where(and(...clauses))
      .limit(500);
  } else {
    return fail(400, 'Provide lead_ids or a filter.');
  }

  let enrolled = 0;
  const skipped: Array<{ lead_id: number; reason: string }> = [];

  for (const lead of candidates) {
    if (NO_OUTREACH_STAGES.includes(lead.status)) {
      skipped.push({ lead_id: lead.id, reason: `stage ${lead.status}` });
      continue;
    }
    if (!lead.email) {
      skipped.push({ lead_id: lead.id, reason: 'no email address' });
      continue;
    }
    if (await enrollLead(campaignId, lead.id)) enrolled++;
    else skipped.push({ lead_id: lead.id, reason: 'already enrolled' });
  }

  return ok({ campaign_id: campaignId, enrolled, skipped });
});
