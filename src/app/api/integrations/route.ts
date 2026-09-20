import { ok, withAuth } from '@/lib/api';
import { allIntegrations } from '@/lib/config';
import { allProviders } from '@/lib/discovery/engine';
import { getEmailProvider } from '@/lib/email/providers';

/** What is wired up and what is not, with the exact variable that is missing. */
export const GET = withAuth(async () => {
  const emailProvider = getEmailProvider();
  return ok({
    integrations: allIntegrations(),
    email_provider: { key: emailProvider.key, label: emailProvider.label, availability: emailProvider.availability() },
    discovery_providers: allProviders().map((p) => ({
      key: p.key, label: p.label, availability: p.availability(),
    })),
  });
});
