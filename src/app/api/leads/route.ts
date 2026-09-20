import { and, desc, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { leads } from '@/db/schema';
import { ok, fail, withAuth, readJson, intParam } from '@/lib/api';
import { findDuplicateLead } from '@/lib/dedupe';
import { recordActivity, ActivityType, isPipelineStage } from '@/lib/activity';
import { scoreLead, priorityForScore } from '@/lib/scoring';

const SORTABLE = {
  created_at: leads.created_at,
  updated_at: leads.updated_at,
  score: leads.score,
  business_name: leads.business_name,
  status: leads.status,
} as const;

export const GET = withAuth(async (req) => {
  const p = req.nextUrl.searchParams;
  const limit = intParam(p.get('limit'), 25, 200);
  const offset = intParam(p.get('offset'), 0);
  const sortKey = (p.get('sort') ?? 'created_at') as keyof typeof SORTABLE;
  const column = SORTABLE[sortKey] ?? leads.created_at;
  const direction = p.get('order') === 'asc' ? asc : desc;

  const filters: SQL[] = [];
  const status = p.get('status');
  const priority = p.get('priority');
  const category = p.get('category');
  const city = p.get('city');
  const search = p.get('q');

  if (status) filters.push(eq(leads.status, status));
  if (priority) filters.push(eq(leads.priority, priority));
  if (category) filters.push(eq(leads.category, category));
  if (city) filters.push(eq(leads.city, city));
  if (search) {
    const term = `%${search}%`;
    filters.push(
      or(
        ilike(leads.business_name, term),
        ilike(leads.email, term),
        ilike(leads.website, term),
        ilike(leads.city, term),
      ) as SQL,
    );
  }

  const where = filters.length ? and(...filters) : undefined;

  const rows = await db
    .select()
    .from(leads)
    .where(where)
    .orderBy(direction(column))
    .limit(limit)
    .offset(offset);

  const counted = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(where);

  return ok({ data: rows, pagination: { limit, offset, total: counted[0]?.n ?? 0 } });
});

export const POST = withAuth(async (req) => {
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail(400, 'Expected a JSON body.');

  const business_name = typeof body.business_name === 'string' ? body.business_name.trim() : '';
  if (!business_name) return fail(400, 'business_name is required.');

  const str = (k: string): string | null => {
    const v = body[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  const candidate = {
    business_name,
    email: str('email'),
    phone: str('phone'),
    website: str('website'),
    google_url: str('google_url'),
    city: str('city'),
  };

  const duplicate = await findDuplicateLead(candidate);
  if (duplicate) {
    return fail(409, 'This business is already in the CRM.', duplicate);
  }

  const status = str('status');
  if (status && !isPipelineStage(status)) return fail(400, `Unknown pipeline stage "${status}".`);

  const draft = {
    business_name,
    category: str('category'),
    subcategory: str('subcategory'),
    city: candidate.city,
    province: str('province'),
    country: str('country'),
    address: str('address'),
    phone: candidate.phone,
    email: candidate.email,
    website: candidate.website,
    google_url: candidate.google_url,
    instagram_url: str('instagram_url'),
    facebook_url: str('facebook_url'),
    linkedin_url: str('linkedin_url'),
    source: str('source') ?? 'manual',
    source_url: str('source_url'),
    notes: str('notes'),
  };

  // Score what we know now; the audit job refines it once the site is checked.
  const breakdown = scoreLead(draft);

  const rows = await db
    .insert(leads)
    .values({
      ...draft,
      status: status ?? 'NEW',
      score: breakdown.total,
      priority: priorityForScore(breakdown.total),
    })
    .returning();

  await recordActivity(rows[0].id, ActivityType.LEAD_CREATED, 'Created manually', {
    score: breakdown,
  });

  return ok(rows[0], { status: 201 });
});
