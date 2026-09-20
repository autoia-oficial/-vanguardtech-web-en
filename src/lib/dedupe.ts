import { or, eq, and, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { leads } from '@/db/schema';

/**
 * Duplicate detection for leads.
 *
 * Normalisation matters more than the comparison: the same business is
 * routinely recorded as "+34 910 000 111" / "910000111" and
 * "https://www.atlas.com/" / "atlas.com", and those must collapse to one key.
 */

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return v.includes('@') ? v : null;
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (d.length < 7) return null;
  // Compare on the last 9 digits so country prefixes do not split a match.
  return d.slice(-9);
}

export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^https?:\/\//, '');
  v = v.replace(/^www\./, '');
  v = v.split('/')[0];
  v = v.split('?')[0];
  v = v.split('#')[0];
  if (!v.includes('.')) return null;
  return v;
}

export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return v.length > 0 ? v : null;
}

export interface DuplicateCandidate {
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  google_url?: string | null;
  business_name?: string | null;
  city?: string | null;
  dedupe_key?: string | null;
}

export interface DuplicateMatch {
  lead_id: number;
  matched_on: string;
}

/**
 * Finds an existing lead that is the same business as `candidate`.
 * Returns the strongest match, or null.
 */
export async function findDuplicateLead(
  candidate: DuplicateCandidate,
): Promise<DuplicateMatch | null> {
  // Exact source identity is the strongest signal and makes re-running a
  // discovery job a no-op.
  if (candidate.dedupe_key) {
    const exact = await db.query.leads.findFirst({
      where: eq(leads.dedupe_key, candidate.dedupe_key),
    });
    if (exact) return { lead_id: exact.id, matched_on: 'dedupe_key' };
  }

  const email = normalizeEmail(candidate.email);
  const phone = normalizePhone(candidate.phone);
  const domain = normalizeDomain(candidate.website);
  const googleUrl = candidate.google_url?.trim() || null;

  const clauses = [];
  if (email) clauses.push(sql`lower(${leads.email}) = ${email}`);
  if (phone) clauses.push(sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9) = ${phone}`);
  if (googleUrl) clauses.push(eq(leads.google_url, googleUrl));

  if (clauses.length > 0) {
    const row = await db
      .select()
      .from(leads)
      .where(or(...clauses))
      .limit(1);
    if (row.length > 0) {
      const hit = row[0];
      let matchedOn = 'unknown';
      if (email && normalizeEmail(hit.email) === email) matchedOn = 'email';
      else if (phone && normalizePhone(hit.phone) === phone) matchedOn = 'phone';
      else if (googleUrl && hit.google_url === googleUrl) matchedOn = 'google_url';
      return { lead_id: hit.id, matched_on: matchedOn };
    }
  }

  // Domain comparison needs normalising on both sides, so it is done in JS
  // over the candidate set rather than in SQL.
  if (domain) {
    const rows = await db.select({ id: leads.id, website: leads.website }).from(leads);
    const hit = rows.find((r) => normalizeDomain(r.website) === domain);
    if (hit) return { lead_id: hit.id, matched_on: 'website' };
  }

  const name = normalizeName(candidate.business_name);
  const city = normalizeName(candidate.city);
  if (name && city) {
    const rows = await db
      .select({ id: leads.id, business_name: leads.business_name, city: leads.city })
      .from(leads);
    const hit = rows.find(
      (r) => normalizeName(r.business_name) === name && normalizeName(r.city) === city,
    );
    if (hit) return { lead_id: hit.id, matched_on: 'name+city' };
  }

  return null;
}

/** Groups existing leads that look like the same business. Used by the maintenance job. */
export async function findDuplicateGroups(): Promise<
  Array<{ key: string; matched_on: string; lead_ids: number[] }>
> {
  const rows = await db.select().from(leads);
  const buckets = new Map<string, { matched_on: string; ids: number[] }>();

  const add = (key: string, matched_on: string, id: number) => {
    const existing = buckets.get(key);
    if (existing) existing.ids.push(id);
    else buckets.set(key, { matched_on, ids: [id] });
  };

  for (const r of rows) {
    const email = normalizeEmail(r.email);
    const phone = normalizePhone(r.phone);
    const domain = normalizeDomain(r.website);
    const name = normalizeName(r.business_name);
    const city = normalizeName(r.city);

    if (email) add(`email:${email}`, 'email', r.id);
    if (phone) add(`phone:${phone}`, 'phone', r.id);
    if (domain) add(`website:${domain}`, 'website', r.id);
    if (r.google_url) add(`google:${r.google_url}`, 'google_url', r.id);
    if (name && city) add(`namecity:${name}|${city}`, 'name+city', r.id);
  }

  return Array.from(buckets.entries())
    .filter(([, v]) => new Set(v.ids).size > 1)
    .map(([key, v]) => ({ key, matched_on: v.matched_on, lead_ids: Array.from(new Set(v.ids)).sort() }));
}

export const _and = and;
