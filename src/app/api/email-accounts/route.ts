import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { email_accounts } from '@/db/schema';
import { ok, fail, withAuth, readJson } from '@/lib/api';
import { isPlausibleEmail } from '@/lib/email/types';
import { emailStatus } from '@/lib/config';

/**
 * Sending accounts. Credentials live in environment variables, not here —
 * this row only records which address sends and what its limits are.
 */
export const GET = withAuth(async () => {
  const rows = await db.select().from(email_accounts).orderBy(desc(email_accounts.created_at));
  return ok({ data: rows, transport: emailStatus() });
});

export const POST = withAuth(async (req) => {
  const body = await readJson<Record<string, unknown>>(req);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isPlausibleEmail(email)) return fail(400, 'A valid sending address is required.');

  const daily = typeof body?.daily_limit === 'number' ? body.daily_limit : 100;
  const hourly = typeof body?.hourly_limit === 'number' ? body.hourly_limit : 20;
  if (daily < 1 || hourly < 1) return fail(400, 'Limits must be at least 1.');
  if (hourly > daily) return fail(400, 'The hourly limit cannot exceed the daily limit.');

  const rows = await db
    .insert(email_accounts)
    .values({
      email,
      name: typeof body?.name === 'string' ? body.name.trim() : null,
      daily_limit: daily,
      hourly_limit: hourly,
    })
    .onConflictDoNothing({ target: email_accounts.email })
    .returning();

  if (rows.length === 0) return fail(409, 'That sending address already exists.');
  return ok(rows[0], { status: 201 });
});

export const PATCH = withAuth(async (req) => {
  const body = await readJson<Record<string, unknown>>(req);
  const id = typeof body?.id === 'number' ? body.id : null;
  if (id === null) return fail(400, 'id is required.');

  const patch: Record<string, unknown> = {};
  if (typeof body?.name === 'string') patch.name = body.name.trim();
  if (typeof body?.is_active === 'boolean') patch.is_active = body.is_active;
  if (typeof body?.daily_limit === 'number') {
    if (body.daily_limit < 1) return fail(400, 'The daily limit must be at least 1.');
    patch.daily_limit = body.daily_limit;
  }
  if (typeof body?.hourly_limit === 'number') {
    if (body.hourly_limit < 1) return fail(400, 'The hourly limit must be at least 1.');
    patch.hourly_limit = body.hourly_limit;
  }
  if (Object.keys(patch).length === 0) return fail(400, 'Nothing to update.');

  const rows = await db.update(email_accounts).set(patch).where(eq(email_accounts.id, id)).returning();
  if (rows.length === 0) return fail(404, 'Sending account not found.');

  const updated = rows[0];
  if (updated.hourly_limit > updated.daily_limit) {
    return fail(400, 'The hourly limit cannot exceed the daily limit.');
  }
  return ok(updated);
});
