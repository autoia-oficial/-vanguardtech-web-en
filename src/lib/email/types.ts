/**
 * Email transport is provider-based. The queue depends only on this interface,
 * so swapping SMTP for a transactional API is an adapter change.
 */

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  /** Plain-text body. Adapters may derive an HTML part from it. */
  body: string;
}

/**
 * A send either succeeded at the provider, or it did not.
 *
 * `ok: true` is only ever returned when the provider acknowledged the message.
 * It is the sole thing that may move a queued email to SENT.
 */
export type SendResult =
  | { ok: true; provider_message_id: string }
  | { ok: false; error: string; retryable: boolean };

export type ProviderAvailability =
  | { available: true }
  | { available: false; reason: string; missing: string[] };

export interface EmailProvider {
  readonly key: string;
  readonly label: string;
  availability(): ProviderAvailability;
  send(email: OutgoingEmail): Promise<SendResult>;
}

/** Reasons the queue refuses to send. Recorded on the email row. */
export const BlockReason = {
  SUPPRESSED: 'SUPPRESSED',
  DO_NOT_CONTACT: 'DO_NOT_CONTACT',
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  DAILY_LIMIT: 'DAILY_LIMIT',
  HOURLY_LIMIT: 'DAILY_LIMIT_HOURLY',
  CAMPAIGN_LIMIT: 'CAMPAIGN_LIMIT',
  CAMPAIGN_INACTIVE: 'CAMPAIGN_INACTIVE',
  SENDER_UNAVAILABLE: 'SENDER_UNAVAILABLE',
  RECENTLY_CONTACTED: 'RECENTLY_CONTACTED',
  ALREADY_PENDING_FOR_LEAD: 'ALREADY_PENDING_FOR_LEAD',
  LEAD_MISSING: 'LEAD_MISSING',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  MAX_ATTEMPTS: 'MAX_ATTEMPTS',
} as const;

export type BlockReasonValue = (typeof BlockReason)[keyof typeof BlockReason];

export const EmailStatus = {
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type EmailStatusValue = (typeof EmailStatus)[keyof typeof EmailStatus];

/** Conservative syntactic check; deliverability is the provider's verdict. */
export function isPlausibleEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.length < 6 || v.length > 254) return false;
  if (/\s/.test(v)) return false;
  const at = v.indexOf('@');
  if (at <= 0 || at !== v.lastIndexOf('@')) return false;
  const domain = v.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;
  return true;
}
