import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { leads } from '@/db/schema';
import { ok, fail, notFound, withAuth, readJson } from '@/lib/api';
import { recordActivity, ActivityType } from '@/lib/activity';

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) return fail(400, 'Invalid lead id.');

  const body = await readJson<{ note?: string }>(req);
  const note = body?.note?.trim();
  if (!note) return fail(400, 'note is required.');

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  if (!lead) return notFound('Lead');

  const stamped = `[${new Date().toISOString().slice(0, 16)} ${user.email}] ${note}`;
  const combined = lead.notes ? `${lead.notes}\n${stamped}` : stamped;

  await db.update(leads).set({ notes: combined, updated_at: new Date() }).where(eq(leads.id, leadId));
  await recordActivity(leadId, ActivityType.NOTE_ADDED, note);
  return ok({ notes: combined });
});
