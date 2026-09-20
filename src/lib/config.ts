/**
 * Single source of truth for which external integrations are wired up.
 *
 * Nothing in the app may assume an integration exists. Every caller checks
 * here first and degrades to NOT_CONFIGURED rather than inventing a result.
 */

export type IntegrationStatus = 'CONFIGURED' | 'NOT_CONFIGURED';

export interface IntegrationReport {
  key: string;
  label: string;
  status: IntegrationStatus;
  /** Env vars that must be set for this integration to become available. */
  missing: string[];
  detail: string;
}

const present = (name: string): boolean => {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
};

const missingFrom = (names: string[]): string[] => names.filter((n) => !present(n));

export function databaseStatus(): IntegrationReport {
  const missing = missingFrom(['DATABASE_URL']);
  return {
    key: 'database',
    label: 'PostgreSQL (Neon)',
    status: missing.length ? 'NOT_CONFIGURED' : 'CONFIGURED',
    missing,
    detail: missing.length
      ? 'Set DATABASE_URL to a PostgreSQL connection string. Neon works without code changes.'
      : 'Connected via DATABASE_URL.',
  };
}

export function emailStatus(): IntegrationReport {
  // SMTP is the only transport implemented. A transactional provider can be
  // added as another EmailProvider adapter without touching callers.
  const missing = missingFrom(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD']);
  return {
    key: 'email',
    label: 'Email transport (SMTP)',
    status: missing.length ? 'NOT_CONFIGURED' : 'CONFIGURED',
    missing,
    detail: missing.length
      ? 'Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD. Until then the queue holds mail at PENDING and sends nothing.'
      : 'SMTP transport ready.',
  };
}

export function cronStatus(): IntegrationReport {
  const missing = missingFrom(['CRON_SECRET']);
  return {
    key: 'cron',
    label: 'Scheduled jobs',
    status: missing.length ? 'NOT_CONFIGURED' : 'CONFIGURED',
    missing,
    detail: missing.length
      ? 'Set CRON_SECRET. Without it every /api/cron/* route rejects all callers — there is no default secret.'
      : 'Cron routes authenticated via CRON_SECRET.',
  };
}

export function authStatus(): IntegrationReport {
  const missing = missingFrom(['AUTH_SECRET']);
  return {
    key: 'auth',
    label: 'Authentication',
    status: missing.length ? 'NOT_CONFIGURED' : 'CONFIGURED',
    missing,
    detail: missing.length
      ? 'Set AUTH_SECRET (32+ random chars). Without it sign-in is refused and the CRM stays locked.'
      : 'Session auth ready.',
  };
}

/** Optional data sources for lead discovery. Absence is expected, not an error. */
export function discoveryStatus(): IntegrationReport {
  const configured = present('OVERPASS_API_URL') || true; // OpenStreetMap needs no key
  return {
    key: 'discovery',
    label: 'Lead discovery sources',
    status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    missing: [],
    detail:
      'OpenStreetMap/Overpass requires no credentials. Optional: set GOOGLE_PLACES_API_KEY to enable the Google Places source.',
  };
}

export function googlePlacesStatus(): IntegrationReport {
  const missing = missingFrom(['GOOGLE_PLACES_API_KEY']);
  return {
    key: 'google_places',
    label: 'Google Places source',
    status: missing.length ? 'NOT_CONFIGURED' : 'CONFIGURED',
    missing,
    detail: missing.length
      ? 'Optional. Set GOOGLE_PLACES_API_KEY to enable this discovery source. Other sources keep working without it.'
      : 'Google Places source enabled.',
  };
}

export function allIntegrations(): IntegrationReport[] {
  return [
    databaseStatus(),
    authStatus(),
    cronStatus(),
    emailStatus(),
    discoveryStatus(),
    googlePlacesStatus(),
  ];
}
