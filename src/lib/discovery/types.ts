/**
 * Lead discovery is provider-based: the CRM depends on this interface only,
 * so a new source is added by writing an adapter, never by changing the CRM.
 */

export interface DiscoveryQuery {
  country?: string;
  province?: string;
  city?: string;
  /** Free-form sector label, e.g. "gyms", "restaurants", "dentists". */
  category?: string;
  limit?: number;
}

/**
 * A business as reported by a source. Every field is optional because sources
 * genuinely differ in what they expose; a missing field is null, never filled in.
 */
export interface DiscoveredBusiness {
  business_name: string;
  category?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  google_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  /** Which adapter produced this record. */
  source: string;
  source_url?: string | null;
  /**
   * Stable identifier within the source, used to make repeated runs
   * idempotent. Combined with `source` to form the lead's dedupe key.
   */
  external_id: string;
}

export type ProviderAvailability =
  | { available: true }
  | { available: false; reason: string; missing: string[] };

export interface LeadSourceProvider {
  /** Stable machine name, stored on the lead as `source`. */
  readonly key: string;
  readonly label: string;
  /**
   * Whether this provider can run right now. A provider that needs a missing
   * credential reports unavailable; the discovery run skips it and says so,
   * rather than returning nothing silently or inventing records.
   */
  availability(): ProviderAvailability;
  search(query: DiscoveryQuery): Promise<DiscoveredBusiness[]>;
}

export function dedupeKeyFor(b: DiscoveredBusiness): string {
  return `${b.source}:${b.external_id}`;
}
