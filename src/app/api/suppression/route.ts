import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { suppression_list } from '@/db/schema';
import { ok, fail, withAuth, readJson } from '@/lib/api';
import { isPlausibleEmail } from '@/lib/email/types';

export const GET = withAuth(async () => {
  const rows = await db.select().from(suppression_list).orderBy(desc(suppression_list.added_at));
  return ok({ data: rows });
});

export const POST = withAuth(async (req) => {
  const body = await readJson<{ email?: string; reason?: string }>(req);
  const email = body?.email?.trim().toLowerCase();
  if (!email || !isPlausibleEmail(email)) return fail(400, 'A valid email is required.');
  const rows = await db.insert(suppression_list)
    .values({ email, reason: body?.reason ?? 'added manually' })
    .onConflictDoNothing({ target: suppression_list.email })
    .returning();
  return ok(rows[0] ?? { email, already_present: true }, { status: 201 });
});

export const DELETE = withAuth(async (req) => {
  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase();
  if (!email) return fail(400, 'email is required.');
  await db.delete(suppression_list).where(eq(suppression_list.email, email));
  return ok({ removed: true, email });
});
