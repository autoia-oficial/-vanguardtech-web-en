import { desc, eq, and, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { emails } from '@/db/schema';
import { ok, fail, withAuth, readJson, intParam } from '@/lib/api';
import { enqueueEmail } from '@/lib/email/queue';

export const GET = withAuth(async (req) => {
  const p = req.nextUrl.searchParams;
  const limit = intParam(p.get('limit'), 50, 200);
  const clauses: SQL[] = [];
  const leadId = p.get('lead_id');
  const status = p.get('status');
  if (leadId && Number.isInteger(Number(leadId))) clauses.push(eq(emails.lead_id, Number(leadId)));
  if (status) clauses.push(eq(emails.status, status));

  const rows = await db.select().from(emails)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(emails.created_at))
    .limit(limit);
  return ok({ data: rows });
});

/** Queues an email. It is not sent here — the queue worker decides that. */
export const POST = withAuth(async (req) => {
  const body = await readJson<Record<string, unknown>>(req);
  const lead_id = typeof body?.lead_id === 'number' ? body.lead_id : null;
  const from_email = typeof body?.from_email === 'string' ? body.from_email : '';
  const to_email = typeof body?.to_email === 'string' ? body.to_email : '';
  const subject = typeof body?.subject === 'string' ? body.subject : '';
  const content = typeof body?.body === 'string' ? body.body : '';

  if (lead_id === null || !from_email || !to_email || !subject || !content) {
    return fail(400, 'lead_id, from_email, to_email, subject and body are required.');
  }

  const result = await enqueueEmail({
    lead_id,
    contact_id: typeof body?.contact_id === 'number' ? body.contact_id : null,
    campaign_id: typeof body?.campaign_id === 'number' ? body.campaign_id : null,
    from_email, to_email, subject, body: content,
  });

  if (!result.queued) return fail(409, result.reason, result.detail);
  return ok({ queued: true, email_id: result.email_id }, { status: 201 });
});
