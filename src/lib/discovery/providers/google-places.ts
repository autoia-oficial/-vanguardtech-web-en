import type {
  LeadSourceProvider,
  DiscoveryQuery,
  DiscoveredBusiness,
  ProviderAvailability,
} from '../types';

/**
 * Google Places (Text Search, Places API v1).
 *
 * Requires GOOGLE_PLACES_API_KEY. Without it the provider reports itself
 * unavailable and the discovery run skips it — other sources keep working.
 */

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.primaryType',
].join(',');

interface PlaceResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryType?: string;
}

export class GooglePlacesProvider implements LeadSourceProvider {
  readonly key = 'google_places';
  readonly label = 'Google Places';

  availability(): ProviderAvailability {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key || !key.trim()) {
      return {
        available: false,
        reason: 'NOT_CONFIGURED: Google Places needs an API key.',
        missing: ['GOOGLE_PLACES_API_KEY'],
      };
    }
    return { available: true };
  }

  async search(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    const availability = this.availability();
    if (!availability.available) throw new Error(availability.reason);

    const where = [query.city, query.province, query.country].filter(Boolean).join(', ');
    const textQuery = [query.category, where].filter(Boolean).join(' in ');
    if (!textQuery.trim()) throw new Error('Google Places needs at least a category or a location.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY as string,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery,
          maxResultCount: Math.min(query.limit ?? 20, 20),
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Google Places responded ${res.status}: ${detail.slice(0, 200)}`);
      }

      const data = (await res.json()) as { places?: PlaceResult[] };
      const places = data.places ?? [];

      return places.flatMap((p): DiscoveredBusiness[] => {
        const name = p.displayName?.text?.trim();
        if (!name || !p.id) return [];
        return [
          {
            business_name: name,
            category: query.category ?? p.primaryType ?? null,
            city: query.city ?? null,
            province: query.province ?? null,
            country: query.country ?? null,
            address: p.formattedAddress ?? null,
            phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
            // Places does not expose email addresses.
            email: null,
            website: p.websiteUri ?? null,
            google_url: p.googleMapsUri ?? null,
            instagram_url: null,
            facebook_url: null,
            source: 'google_places',
            source_url: p.googleMapsUri ?? null,
            external_id: p.id,
          },
        ];
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
