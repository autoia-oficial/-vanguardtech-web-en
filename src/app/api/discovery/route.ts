import { ok, fail, withAuth, readJson } from '@/lib/api';
import { runDiscovery, allProviders } from '@/lib/discovery/engine';
import { supportedCategories } from '@/lib/discovery/providers/openstreetmap';

export const GET = withAuth(async () => {
  return ok({
    providers: allProviders().map((p) => ({ key: p.key, label: p.label, availability: p.availability() })),
    categories: supportedCategories(),
  });
});

/** Runs a discovery search now and stores whatever the sources actually return. */
export const POST = withAuth(async (req) => {
  const body = await readJson<Record<string, unknown>>(req);
  const str = (k: string) => (typeof body?.[k] === 'string' ? (body[k] as string) : undefined);

  const query = {
    country: str('country'),
    province: str('province'),
    city: str('city'),
    category: str('category'),
    limit: typeof body?.limit === 'number' ? body.limit : undefined,
  };

  if (!query.city && !query.province && !query.country) {
    return fail(400, 'At least one of city, province or country is required.');
  }
  if (!query.category) return fail(400, 'category is required.');

  const outcome = await runDiscovery(query);
  return ok(outcome);
});
