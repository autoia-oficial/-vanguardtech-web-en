import type {
  LeadSourceProvider,
  DiscoveryQuery,
  DiscoveredBusiness,
  ProviderAvailability,
} from '../types';

/**
 * OpenStreetMap via the Overpass API.
 *
 * Needs no credentials, which makes it the default source. It returns only what
 * contributors actually recorded: a business with no `website` tag genuinely has
 * no website on record, which is exactly the signal the CRM is looking for.
 */

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'VanguardCRM/1.0 (lead discovery)';

/** Sector label -> OSM tag filters. Unknown sectors fall back to a name search. */
const CATEGORY_TAGS: Record<string, string[]> = {
  gyms: ['["leisure"="fitness_centre"]', '["amenity"="gym"]'],
  restaurants: ['["amenity"="restaurant"]'],
  bars: ['["amenity"="bar"]', '["amenity"="pub"]'],
  cafes: ['["amenity"="cafe"]'],
  barbers: ['["shop"="hairdresser"]'],
  beauty: ['["shop"="beauty"]'],
  dentists: ['["amenity"="dentist"]'],
  clinics: ['["amenity"="clinic"]', '["amenity"="doctors"]'],
  physiotherapy: ['["healthcare"="physiotherapist"]'],
  veterinary: ['["amenity"="veterinary"]'],
  real_estate: ['["office"="estate_agent"]'],
  law_firms: ['["office"="lawyer"]'],
  accountants: ['["office"="accountant"]'],
  hotels: ['["tourism"="hotel"]', '["tourism"="guest_house"]'],
  academies: ['["amenity"="language_school"]', '["amenity"="driving_school"]'],
  workshops: ['["shop"="car_repair"]'],
  bakeries: ['["shop"="bakery"]'],
  pharmacies: ['["amenity"="pharmacy"]'],
  florists: ['["shop"="florist"]'],
  opticians: ['["shop"="optician"]'],
};

export function supportedCategories(): string[] {
  return Object.keys(CATEGORY_TAGS).sort();
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
}

function escapeOverpass(value: string): string {
  // Values are interpolated into a quoted Overpass string literal.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildOverpassQuery(query: DiscoveryQuery): string | null {
  const area = query.city ?? query.province ?? query.country;
  if (!area) return null;

  const filters = query.category
    ? (CATEGORY_TAGS[query.category.toLowerCase().replace(/[\s-]+/g, '_')] ?? null)
    : null;
  if (!filters) return null;

  const limit = Math.min(query.limit ?? 50, 200);
  const safeArea = escapeOverpass(area);

  const body = filters
    .flatMap((f) => [`  node${f}(area.searchArea);`, `  way${f}(area.searchArea);`])
    .join('\n');

  return `[out:json][timeout:30];
area["name"="${safeArea}"]->.searchArea;
(
${body}
);
out center tags ${limit};`;
}

function toBusiness(el: OverpassElement, query: DiscoveryQuery): DiscoveredBusiness | null {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  // Without a name there is no business to record. Skip rather than invent one.
  if (!name) return null;

  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ').trim();

  return {
    business_name: name,
    category: query.category ?? null,
    city: tags['addr:city']?.trim() ?? query.city ?? null,
    province: query.province ?? null,
    country: query.country ?? null,
    address: street || null,
    phone: (tags.phone ?? tags['contact:phone'])?.trim() ?? null,
    email: (tags.email ?? tags['contact:email'])?.trim() ?? null,
    website: (tags.website ?? tags['contact:website'])?.trim() ?? null,
    google_url: null,
    instagram_url: tags['contact:instagram']?.trim() ?? null,
    facebook_url: tags['contact:facebook']?.trim() ?? null,
    source: 'openstreetmap',
    source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    external_id: `${el.type}/${el.id}`,
  };
}

export class OpenStreetMapProvider implements LeadSourceProvider {
  readonly key = 'openstreetmap';
  readonly label = 'OpenStreetMap (Overpass)';

  availability(): ProviderAvailability {
    return { available: true };
  }

  async search(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    const ql = buildOverpassQuery(query);
    if (!ql) {
      throw new Error(
        `Unsupported discovery query: need an area (city/province/country) and a known category. ` +
          `Known categories: ${supportedCategories().join(', ')}`,
      );
    }

    const endpoint = process.env.OVERPASS_API_URL || DEFAULT_ENDPOINT;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40_000);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: ql,
        signal: controller.signal,
        headers: { 'content-type': 'text/plain', 'user-agent': USER_AGENT },
      });

      if (!res.ok) {
        throw new Error(`Overpass responded ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as { elements?: OverpassElement[] };
      const elements = data.elements ?? [];

      const seen = new Set<string>();
      const out: DiscoveredBusiness[] = [];
      for (const el of elements) {
        const b = toBusiness(el, query);
        if (!b) continue;
        if (seen.has(b.external_id)) continue;
        seen.add(b.external_id);
        out.push(b);
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
}
