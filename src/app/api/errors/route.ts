import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { errors } from '@/db/schema';
import { ok, fail, withAuth, readJson, intParam } from '@/lib/api';

export const GET = withAuth(async (req) => {
  const resolved = req.nextUrl.searchParams.get('resolved') === 'true';
  const limit = intParam(req.nextUrl.searchParams.get('limit'), 50, 200);
  const rows = await db.select().from(errors)
    .where(eq(errors.resolved, resolved))
    .orderBy(desc(errors.created_at))
    .limit(limit);
  return ok({ data: rows });
});

export const PATCH = withAuth(async (req) => {
  const body = await readJson<{ id?: number; resolved?: boolean }>(req);
  if (!body?.id) return fail(400, 'id is required.');
  const rows = await db.update(errors)
    .set({ resolved: body.resolved ?? true })
    .where(eq(errors.id, body.id))
    .returning();
  if (rows.length === 0) return fail(404, 'Error not found.');
  return ok(rows[0]);
});
