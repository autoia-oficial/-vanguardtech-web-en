import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { ok, fail, withAuth, readJson } from '@/lib/api';
import { setSetting } from '@/lib/automation/jobs';

export const GET = withAuth(async () => {
  const rows = await db.select().from(settings);
  return ok({ data: rows });
});

export const PUT = withAuth(async (req) => {
  const body = await readJson<{ key?: string; value?: string; type?: string }>(req);
  if (!body?.key) return fail(400, 'key is required.');
  await setSetting(body.key, body.value ?? '', body.type ?? 'string');
  return ok({ key: body.key, value: body.value ?? '' });
});
