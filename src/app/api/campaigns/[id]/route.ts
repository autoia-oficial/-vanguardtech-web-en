import { eq, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { campaigns, campaign_leads, emails } from '@/db/schema';
import { ok, fail, notFound, withAuth } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(async (_req, _user, ctx) => {
  const { id } = await ctx.params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) return fail(400, 'Invalid campaign id.');

  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
  if (!campaign) return notFound('Campaign');

  const [enrollments, sent] = await Promise.all([
    db.query.campaign_leads.findMany({
      where: eq(campaign_leads.campaign_id, campaignId),
      with: { lead: true },
      limit: 200,
    }),
    db.select().from(emails).where(eq(emails.campaign_id, campaignId)).orderBy(desc(emails.created_at)).limit(100),
  ]);

  return ok({ campaign, enrollments, emails: sent });
});
