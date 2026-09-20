import { randomBytes, createHash } from 'crypto';
import { and, eq, gte, inArray, lte, or, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  emails,
  email_accounts,
  email_events,
  campaigns,
  leads,
  suppression_list,
} from '@/db/schema';
import { recordActivity, ActivityType, NO_OUTREACH_STAGES } from '@/lib/activity';
import { nextRetryAt } from '@/lib/locks';
import { getEmailProvider } from './providers';
import { BlockReason, EmailStatus, isPlausibleEmail } from './types';
import type { BlockReasonValue } from './types';

/**
 * The email queue.
 *
 * Two rules govern everything here:
 *
 *  1. An email reaches SENT only after the provider acknowledged it. Every
 *     other outcome leaves it PENDING (retryable) or FAILED/CANCELLED.
 *  2. Nothing is sent twice. Enqueueing is keyed on an idempotency key backed
 *     by a unique index, and a worker claims a row with a conditional update
 *     so two concurrent runs cannot both take it.
 */

export const DEFAULT_RECENT_CONTACT_DAYS = 14;

export interface EnqueueInput {
  lead_id: number;
  contact_id?: number | null;
  campaign_id?: number | null;
  from_email: string;
  to_email: string;
  subject: string;
  body: string;
  scheduled_at?: Date;
  /** Supply to control dedupe; otherwise derived from lead+campaign+subject. */
  idempotency_key?: string;
}

export type EnqueueResult =
  | { queued: true; email_id: number }
  | { queued: false; reason: BlockReasonValue | 'DUPLICATE'; detail: string };

export function buildIdempotencyKey(input: {
  lead_id: number;
  campaign_id?: number | null;
  subject: string;
  step?: number | null;
}): string {
  const basis = [
    input.lead_id,
    input.campaign_id ?? 'nocampaign',
    input.step ?? 'nostep',
    input.subject.trim().toLowerCase(),
  ].join('|');
  return createHash('sha256').update(basis).digest('hex').slice(0, 48);
}

/**
 * Validates and queues an email. Returns why it was refused rather than
 * throwing, so callers can record the reason against the lead.
 */
export async function enqueueEmail(input: EnqueueInput): Promise<EnqueueResult> {
  const to = input.to_email.trim().toLowerCase();

  if (!isPlausibleEmail(to)) {
    return { queued: false, reason: BlockReason.INVALID_RECIPIENT, detail: `Not a usable address: "${input.to_email}"` };
  }

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, input.lead_id) });
  if (!lead) {
    return { queued: false, reason: BlockReason.LEAD_MISSING, detail: `Lead ${input.lead_id} does not exist.` };
  }
  if (NO_OUTREACH_STAGES.includes(lead.status)) {
    return {
      queued: false,
      reason: BlockReason.DO_NOT_CONTACT,
      detail: `Lead is at stage ${lead.status}; outbound sales email stops here.`,
    };
  }

  const suppressed = await db.query.suppression_list.findFirst({
    where: eq(suppression_list.email, to),
  });
  if (suppressed) {
    return {
      queued: false,
      reason: BlockReason.SUPPRESSED,
      detail: `${to} is on the suppression list${suppressed.reason ? ` (${suppressed.reason})` : ''}.`,
    };
  }

  if (input.campaign_id) {
    const campaign = await db.query.campaigns.findFirst({
      where: eq(campaigns.id, input.campaign_id),
    });
    if (!campaign || campaign.status !== 'ACTIVE') {
      return {
        queued: false,
        reason: BlockReason.CAMPAIGN_INACTIVE,
        detail: `Campaign ${input.campaign_id} is ${campaign?.status ?? 'missing'}, not ACTIVE.`,
      };
    }
  }

  // One outstanding email per lead at a time: a second one queued before the
  // first is sent would arrive as a double-send from the recipient's side.
  const outstanding = await db.query.emails.findFirst({
    where: and(
      eq(emails.lead_id, input.lead_id),
      inArray(emails.status, [EmailStatus.PENDING, EmailStatus.QUEUED, EmailStatus.SENDING]),
    ),
  });
  if (outstanding) {
    return {
      queued: false,
      reason: BlockReason.ALREADY_PENDING_FOR_LEAD,
      detail: `Email ${outstanding.id} is already awaiting send for this lead.`,
    };
  }

  const idempotency_key =
    input.idempotency_key ??
    buildIdempotencyKey({
      lead_id: input.lead_id,
      campaign_id: input.campaign_id,
      subject: input.subject,
    });

  const rows = await db
    .insert(emails)
    .values({
      lead_id: input.lead_id,
      contact_id: input.contact_id ?? null,
      campaign_id: input.campaign_id ?? null,
      from_email: input.from_email.trim().toLowerCase(),
      to_email: to,
      subject: input.subject,
      body: input.body,
      status: EmailStatus.PENDING,
      idempotency_key,
      scheduled_at: input.scheduled_at ?? new Date(),
    })
    .onConflictDoNothing({ target: emails.idempotency_key })
    .returning();

  if (rows.length === 0) {
    return {
      queued: false,
      reason: 'DUPLICATE',
      detail: `An email with this idempotency key already exists; not queueing a second copy.`,
    };
  }

  await recordActivity(input.lead_id, ActivityType.EMAIL_QUEUED, `Queued: "${input.subject}"`, {
    email_id: rows[0].id,
    campaign_id: input.campaign_id ?? null,
  });

  return { queued: true, email_id: rows[0].id };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface ProcessOptions {
  batchSize?: number;
  now?: Date;
  recentContactDays?: number;
}

export interface ProcessSummary {
  provider: string;
  provider_available: boolean;
  claimed: number;
  sent: number;
  blocked: number;
  failed: number;
  retry_scheduled: number;
  blocked_reasons: Record<string, number>;
  /** Present when nothing could be attempted because no transport is set up. */
  not_configured?: { reason: string; missing: string[] };
}

async function countSentSince(fromEmail: string, since: Date): Promise<number> {
  const rows = await db
    .select({ id: emails.id })
    .from(emails)
    .where(and(eq(emails.from_email, fromEmail), eq(emails.status, EmailStatus.SENT), gte(emails.sent_at, since)));
  return rows.length;
}

async function block(
  emailId: number,
  leadId: number,
  reason: BlockReasonValue,
  detail: string,
): Promise<void> {
  await db
    .update(emails)
    .set({
      status: EmailStatus.CANCELLED,
      blocked_reason: reason,
      last_error: detail,
      locked_at: null,
      locked_by: null,
    })
    .where(eq(emails.id, emailId));

  await recordActivity(leadId, ActivityType.EMAIL_BLOCKED, `Not sent — ${reason}: ${detail}`, {
    email_id: emailId,
    reason,
  });
}

/**
 * Claims and processes due emails.
 *
 * When no transport is configured nothing is claimed at all: the queue is left
 * exactly as it was and the summary says so.
 */
export async function processEmailQueue(options: ProcessOptions = {}): Promise<ProcessSummary> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 25;
  const recentDays = options.recentContactDays ?? DEFAULT_RECENT_CONTACT_DAYS;

  const provider = getEmailProvider();
  const availability = provider.availability();

  const summary: ProcessSummary = {
    provider: provider.key,
    provider_available: availability.available,
    claimed: 0,
    sent: 0,
    blocked: 0,
    failed: 0,
    retry_scheduled: 0,
    blocked_reasons: {},
  };

  if (!availability.available) {
    summary.not_configured = { reason: availability.reason, missing: availability.missing };
    return summary;
  }

  const countBlock = (reason: string) => {
    summary.blocked_reasons[reason] = (summary.blocked_reasons[reason] ?? 0) + 1;
    summary.blocked++;
  };

  const due = await db
    .select({ id: emails.id })
    .from(emails)
    .where(
      and(
        inArray(emails.status, [EmailStatus.PENDING, EmailStatus.QUEUED]),
        lte(emails.scheduled_at, now),
        or(isNull(emails.next_retry_at), lte(emails.next_retry_at, now)),
      ),
    )
    .orderBy(emails.scheduled_at)
    .limit(batchSize);

  const workerId = randomBytes(8).toString('hex');

  for (const { id } of due) {
    // Atomic claim: only one worker can move a row out of PENDING/QUEUED.
    const claimed = await db
      .update(emails)
      .set({ status: EmailStatus.SENDING, locked_at: now, locked_by: workerId })
      .where(
        and(
          eq(emails.id, id),
          inArray(emails.status, [EmailStatus.PENDING, EmailStatus.QUEUED]),
        ),
      )
      .returning();

    if (claimed.length === 0) continue;
    const email = claimed[0];
    summary.claimed++;

    try {
      const lead = await db.query.leads.findFirst({ where: eq(leads.id, email.lead_id) });
      if (!lead) {
        await block(email.id, email.lead_id, BlockReason.LEAD_MISSING, 'Lead no longer exists.');
        countBlock(BlockReason.LEAD_MISSING);
        continue;
      }
      if (NO_OUTREACH_STAGES.includes(lead.status)) {
        await block(email.id, lead.id, BlockReason.DO_NOT_CONTACT, `Lead is at stage ${lead.status}.`);
        countBlock(BlockReason.DO_NOT_CONTACT);
        continue;
      }

      const suppressed = await db.query.suppression_list.findFirst({
        where: eq(suppression_list.email, email.to_email),
      });
      if (suppressed) {
        await block(email.id, lead.id, BlockReason.SUPPRESSED, `${email.to_email} is suppressed.`);
        countBlock(BlockReason.SUPPRESSED);
        continue;
      }

      if (!isPlausibleEmail(email.to_email)) {
        await block(email.id, lead.id, BlockReason.INVALID_RECIPIENT, `Bad address: ${email.to_email}`);
        countBlock(BlockReason.INVALID_RECIPIENT);
        continue;
      }

      if (email.campaign_id) {
        const campaign = await db.query.campaigns.findFirst({
          where: eq(campaigns.id, email.campaign_id),
        });
        if (!campaign || campaign.status !== 'ACTIVE') {
          await block(
            email.id,
            lead.id,
            BlockReason.CAMPAIGN_INACTIVE,
            `Campaign is ${campaign?.status ?? 'missing'}.`,
          );
          countBlock(BlockReason.CAMPAIGN_INACTIVE);
          continue;
        }
      }

      // Do not contact the same lead again within the cool-off window.
      if (lead.last_contact_at) {
        const cutoff = new Date(now.getTime() - recentDays * 24 * 60 * 60 * 1000);
        if (lead.last_contact_at > cutoff) {
          await block(
            email.id,
            lead.id,
            BlockReason.RECENTLY_CONTACTED,
            `Last contacted ${lead.last_contact_at.toISOString()}, inside the ${recentDays}-day window.`,
          );
          countBlock(BlockReason.RECENTLY_CONTACTED);
          continue;
        }
      }

      const account = await db.query.email_accounts.findFirst({
        where: eq(email_accounts.email, email.from_email),
      });
      if (!account || !account.is_active) {
        await block(
          email.id,
          lead.id,
          BlockReason.SENDER_UNAVAILABLE,
          `Sender ${email.from_email} is ${account ? 'inactive' : 'not configured'}.`,
        );
        countBlock(BlockReason.SENDER_UNAVAILABLE);
        continue;
      }

      // Limits are computed over the relevant window only, never the lifetime total.
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const sentToday = await countSentSince(email.from_email, startOfDay);
      if (sentToday >= account.daily_limit) {
        // A limit is temporary, so the email goes back to PENDING for tomorrow
        // rather than being cancelled.
        await db
          .update(emails)
          .set({
            status: EmailStatus.PENDING,
            blocked_reason: BlockReason.DAILY_LIMIT,
            last_error: `Daily limit ${account.daily_limit} reached for ${email.from_email}.`,
            next_retry_at: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000),
            locked_at: null,
            locked_by: null,
          })
          .where(eq(emails.id, email.id));
        countBlock(BlockReason.DAILY_LIMIT);
        continue;
      }

      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const sentThisHour = await countSentSince(email.from_email, hourAgo);
      if (sentThisHour >= account.hourly_limit) {
        await db
          .update(emails)
          .set({
            status: EmailStatus.PENDING,
            blocked_reason: BlockReason.HOURLY_LIMIT,
            last_error: `Hourly limit ${account.hourly_limit} reached for ${email.from_email}.`,
            next_retry_at: new Date(now.getTime() + 60 * 60 * 1000),
            locked_at: null,
            locked_by: null,
          })
          .where(eq(emails.id, email.id));
        countBlock(BlockReason.HOURLY_LIMIT);
        continue;
      }

      // --- the actual send -------------------------------------------------
      const attempt = email.attempts + 1;
      const result = await provider.send({
        from: email.from_email,
        to: email.to_email,
        subject: email.subject,
        body: email.body,
      });

      if (result.ok) {
        const sentAt = new Date();
        await db
          .update(emails)
          .set({
            status: EmailStatus.SENT,
            sent_at: sentAt,
            attempts: attempt,
            provider_message_id: result.provider_message_id,
            last_error: null,
            blocked_reason: null,
            next_retry_at: null,
            locked_at: null,
            locked_by: null,
          })
          .where(eq(emails.id, email.id));

        await db.insert(email_events).values({
          email_id: email.id,
          event_type: 'SENT',
          event_data: { provider: provider.key, provider_message_id: result.provider_message_id },
        });

        await db
          .update(leads)
          .set({ last_contact_at: sentAt, updated_at: sentAt })
          .where(eq(leads.id, lead.id));

        await recordActivity(lead.id, ActivityType.EMAIL_SENT, `Sent: "${email.subject}"`, {
          email_id: email.id,
          provider_message_id: result.provider_message_id,
        });

        summary.sent++;
        continue;
      }

      // --- failure ---------------------------------------------------------
      const exhausted = attempt >= email.max_attempts || !result.retryable;
      await db
        .update(emails)
        .set({
          status: exhausted ? EmailStatus.FAILED : EmailStatus.PENDING,
          attempts: attempt,
          last_error: result.error,
          next_retry_at: exhausted ? null : nextRetryAt(attempt, now),
          blocked_reason: exhausted && !result.retryable ? BlockReason.MAX_ATTEMPTS : null,
          locked_at: null,
          locked_by: null,
        })
        .where(eq(emails.id, email.id));

      if (exhausted) {
        summary.failed++;
        await recordActivity(
          lead.id,
          ActivityType.EMAIL_FAILED,
          `Send failed permanently after ${attempt} attempt(s): ${result.error}`,
          { email_id: email.id },
        );
      } else {
        summary.retry_scheduled++;
      }
    } catch (err) {
      // An unexpected error must release the claim, never strand the row in SENDING.
      const message = err instanceof Error ? err.message : String(err);
      const attempt = email.attempts + 1;
      const exhausted = attempt >= email.max_attempts;
      await db
        .update(emails)
        .set({
          status: exhausted ? EmailStatus.FAILED : EmailStatus.PENDING,
          attempts: attempt,
          last_error: message,
          next_retry_at: exhausted ? null : nextRetryAt(attempt, now),
          locked_at: null,
          locked_by: null,
        })
        .where(eq(emails.id, email.id));
      if (exhausted) summary.failed++;
      else summary.retry_scheduled++;
    }
  }

  return summary;
}

/**
 * Releases rows stuck in SENDING past the stale window, so a worker killed
 * mid-send does not park an email forever.
 */
export async function reclaimStuckSending(staleMs = 10 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await db
    .update(emails)
    .set({ status: EmailStatus.PENDING, locked_at: null, locked_by: null })
    .where(and(eq(emails.status, EmailStatus.SENDING), lte(emails.locked_at, cutoff)))
    .returning();
  return rows.length;
}

export const _sql = sql;
