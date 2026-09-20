import { desc, eq, and, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { follow_ups } from '@/db/schema';
import { ok, withAuth, intParam } from '@/lib/api';

export const GET = withAuth(async (req) => {
  const p = req.nextUrl.searchParams;
  const limit = intParam(p.get('limit'), 50, 200);
  const clauses: SQL[] = [];
  const status = p.get('status');
  const leadId = p.get('lead_id');
  if (status) clauses.push(eq(follow_ups.status, status));
  if (leadId && Number.isInteger(Number(leadId))) clauses.push(eq(follow_ups.lead_id, Number(leadId)));

  const rows = await db.select().from(follow_ups)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(follow_ups.scheduled_at))
    .limit(limit);
  return ok({ data: rows });
});
