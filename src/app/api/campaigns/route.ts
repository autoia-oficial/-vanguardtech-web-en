import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { campaigns, campaign_leads } from '@/db/schema';
import { ok, fail, withAuth, readJson } from '@/lib/api';
import { parseSequence } from '@/lib/campaigns/sequences';

const STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'];

export const GET = withAuth(async () => {
  const rows = await db.select().from(campaigns).orderBy(desc(campaigns.created_at));
  const counts = await db
    .select({ campaign_id: campaign_leads.campaign_id, n: sql<number>`count(*)::int` })
    .from(campaign_leads)
    .groupBy(campaign_leads.campaign_id);
  const byId = new Map(counts.map((c) => [c.campaign_id, c.n]));
  return ok({ data: rows.map((c) => ({ ...c, enrolled: byId.get(c.id) ?? 0 })) });
});

export const POST = withAuth(async (req) => {
  const body = await readJson<Record<string, unknown>>(req);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return fail(400, 'name is required.');

  const steps = parseSequence(body?.sequence);
  if (body?.sequence && steps.length === 0) {
    return fail(400, 'sequence must be an array of {step, wait_days, subject, body}.');
  }

  const rows = await db.insert(campaigns).values({
    name,
    description: typeof body?.description === 'string' ? body.description : null,
    target_filter: (body?.target_filter as object) ?? null,
    sequence: steps.length ? steps : null,
    email_account_id: typeof body?.email_account_id === 'number' ? body.email_account_id : null,
    daily_limit: typeof body?.daily_limit === 'number' ? body.daily_limit : 50,
    status: 'DRAFT',
  }).returning();

  return ok(rows[0], { status: 201 });
});

export const PATCH = withAuth(async (req) => {
  const body = await readJson<Record<string, unknown>>(req);
  const id = typeof body?.id === 'number' ? body.id : null;
  if (id === null) return fail(400, 'id is required.');

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (typeof body?.status === 'string') {
    if (!STATUSES.includes(body.status)) return fail(400, `Unknown status "${body.status}".`);
    patch.status = body.status;
  }
  if (typeof body?.name === 'string') patch.name = body.name.trim();
  if (typeof body?.daily_limit === 'number') patch.daily_limit = body.daily_limit;
  if (typeof body?.email_account_id === 'number') patch.email_account_id = body.email_account_id;
  if (body?.sequence !== undefined) {
    const steps = parseSequence(body.sequence);
    if (steps.length === 0) return fail(400, 'sequence must contain at least one usable step.');
    patch.sequence = steps;
  }

  const rows = await db.update(campaigns).set(patch).where(eq(campaigns.id, id)).returning();
  if (rows.length === 0) return fail(404, 'Campaign not found.');
  return ok(rows[0]);
});
