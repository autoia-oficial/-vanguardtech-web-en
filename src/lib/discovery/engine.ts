import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { leads } from '@/db/schema';
import { scoreLead, priorityForScore } from '@/lib/scoring';
import { findDuplicateLead } from '@/lib/dedupe';
import { recordActivity, ActivityType } from '@/lib/activity';
import { OpenStreetMapProvider } from './providers/openstreetmap';
import { GooglePlacesProvider } from './providers/google-places';
import { dedupeKeyFor } from './types';
import type { LeadSourceProvider, DiscoveryQuery, DiscoveredBusiness } from './types';

const REGISTRY: LeadSourceProvider[] = [new OpenStreetMapProvider(), new GooglePlacesProvider()];

export function allProviders(): LeadSourceProvider[] {
  return REGISTRY;
}

export function availableProviders(): LeadSourceProvider[] {
  return REGISTRY.filter((p) => p.availability().available);
}

export function providerByKey(key: string): LeadSourceProvider | undefined {
  return REGISTRY.find((p) => p.key === key);
}

export interface DiscoveryOutcome {
  query: DiscoveryQuery;
  providers_run: string[];
  providers_skipped: Array<{ key: string; reason: string; missing: string[] }>;
  found: number;
  created: number;
  duplicates: number;
  errors: Array<{ provider: string; message: string }>;
  created_lead_ids: number[];
}

/**
 * Runs discovery across every available provider and persists the results.
 *
 * Idempotent: a business already in the CRM is matched on its source identity
 * or on email/phone/website/name+city and skipped, so re-running the same
 * query creates nothing new.
 */
export async function runDiscovery(query: DiscoveryQuery): Promise<DiscoveryOutcome> {
  const outcome: DiscoveryOutcome = {
    query,
    providers_run: [],
    providers_skipped: [],
    found: 0,
    created: 0,
    duplicates: 0,
    errors: [],
    created_lead_ids: [],
  };

  for (const provider of REGISTRY) {
    const availability = provider.availability();
    if (!availability.available) {
      outcome.providers_skipped.push({
        key: provider.key,
        reason: availability.reason,
        missing: availability.missing,
      });
      continue;
    }

    let results: DiscoveredBusiness[] = [];
    try {
      results = await provider.search(query);
      outcome.providers_run.push(provider.key);
    } catch (err) {
      // One failing source must not abort the others.
      outcome.errors.push({
        provider: provider.key,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    outcome.found += results.length;

    for (const business of results) {
      try {
        const created = await persistDiscovered(business);
        if (created === null) outcome.duplicates++;
        else {
          outcome.created++;
          outcome.created_lead_ids.push(created);
        }
      } catch (err) {
        outcome.errors.push({
          provider: provider.key,
          message: `${business.business_name}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  return outcome;
}

/**
 * Inserts a discovered business as a lead unless it already exists.
 * Returns the new lead id, or null when it was a duplicate.
 */
export async function persistDiscovered(business: DiscoveredBusiness): Promise<number | null> {
  const dedupe_key = dedupeKeyFor(business);

  const duplicate = await findDuplicateLead({
    dedupe_key,
    email: business.email,
    phone: business.phone,
    website: business.website,
    google_url: business.google_url,
    business_name: business.business_name,
    city: business.city,
  });
  if (duplicate) return null;

  const rows = await db
    .insert(leads)
    .values({
      business_name: business.business_name,
      category: business.category ?? null,
      city: business.city ?? null,
      province: business.province ?? null,
      country: business.country ?? null,
      address: business.address ?? null,
      phone: business.phone ?? null,
      email: business.email ?? null,
      website: business.website ?? null,
      google_url: business.google_url ?? null,
      instagram_url: business.instagram_url ?? null,
      facebook_url: business.facebook_url ?? null,
      source: business.source,
      source_url: business.source_url ?? null,
      dedupe_key,
      status: 'NEW',
      priority: 'medium',
      score: 0,
    })
    // A concurrent run may insert the same key between the check and here.
    .onConflictDoNothing({ target: leads.dedupe_key })
    .returning();

  if (rows.length === 0) return null;

  const lead = rows[0];

  // Score it now, with no audit yet. A business with no website at all scores
  // full marks on opportunity and never gets audited — nothing would ever come
  // back to score it, so leaving this to the audit job left precisely the best
  // prospects sitting at zero, sorted below everyone else.
  const breakdown = scoreLead(lead, []);
  const priority = priorityForScore(breakdown.total);
  if (breakdown.total !== 0 || priority !== lead.priority) {
    await db
      .update(leads)
      .set({ score: breakdown.total, priority, updated_at: new Date() })
      .where(eq(leads.id, lead.id));
  }

  await recordActivity(
    lead.id,
    ActivityType.LEAD_CREATED,
    `Discovered via ${business.source}`,
    { source: business.source, source_url: business.source_url, external_id: business.external_id },
  );
  return lead.id;
}
