import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { campaigns, campaign_leads, email_accounts, emails, follow_ups, leads } from '@/db/schema';
import { recordActivity, ActivityType, NO_OUTREACH_STAGES } from '@/lib/activity';
import { enqueueEmail, buildIdempotencyKey } from '@/lib/email/queue';
import { EmailStatus } from '@/lib/email/types';

/**
 * Campaign sequences.
 *
 * A campaign carries an ordered list of steps. A lead enrolled in the campaign
 * advances one step at a time: the step's email is queued, and once it is
 * actually sent the next step is scheduled for `wait_days` later. The sequence
 * stops the moment the lead replies, is marked DO_NOT_CONTACT, or becomes a
 * customer — checked before anything is queued.
 */

export interface SequenceStep {
  step: number;
  /** Days to wait after the previous step was sent before this one is queued. */
  wait_days: number;
  subject: string;
  body: string;
}

export type EnrollmentStatus = 'ACTIVE' | 'COMPLETED' | 'STOPPED';

export const StopReason = {
  REPLIED: 'REPLIED',
  DO_NOT_CONTACT: 'DO_NOT_CONTACT',
  BECAME_CUSTOMER: 'BECAME_CUSTOMER',
  CAMPAIGN_INACTIVE: 'CAMPAIGN_INACTIVE',
  SEQUENCE_COMPLETE: 'SEQUENCE_COMPLETE',
} as const;

export type StopReasonValue = (typeof StopReason)[keyof typeof StopReason];

export function parseSequence(raw: unknown): SequenceStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: SequenceStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const step = Number(o.step);
    const subject = typeof o.subject === 'string' ? o.subject : '';
    const body = typeof o.body === 'string' ? o.body : '';
    if (!Number.isFinite(step) || step < 1 || !subject.trim() || !body.trim()) continue;
    steps.push({
      step,
      wait_days: Number.isFinite(Number(o.wait_days)) ? Math.max(0, Number(o.wait_days)) : 0,
      subject,
      body,
    });
  }
  return steps.sort((a, b) => a.step - b.step);
}

/** Substitutes {{field}} placeholders from the lead record. Unknown fields become ''. */
export function renderTemplate(template: string, lead: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
    const value = lead[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

/**
 * Reasons a lead's sequence must stop, derived from its current state.
 * Returns null when the sequence may continue.
 */
export function stopReasonFor(lead: { status: string }): StopReasonValue | null {
  if (lead.status === 'DO_NOT_CONTACT') return StopReason.DO_NOT_CONTACT;
  if (['PAID', 'PROJECT', 'LIVE'].includes(lead.status)) return StopReason.BECAME_CUSTOMER;
  if (['REPLIED', 'INTERESTED', 'MEETING', 'ACCEPTED'].includes(lead.status)) {
    return StopReason.REPLIED;
  }
  if (lead.status === 'LOST') return StopReason.DO_NOT_CONTACT;
  return null;
}

export async function enrollLead(campaignId: number, leadId: number): Promise<boolean> {
  const rows = await db
    .insert(campaign_leads)
    .values({ campaign_id: campaignId, lead_id: leadId, current_step: 0, status: 'ACTIVE' })
    .onConflictDoNothing({ target: [campaign_leads.campaign_id, campaign_leads.lead_id] })
    .returning();

  if (rows.length === 0) return false;
  await recordActivity(leadId, ActivityType.CAMPAIGN_ADDED, `Enrolled in campaign ${campaignId}`, {
    campaign_id: campaignId,
  });
  return true;
}

export async function stopEnrollment(
  campaignId: number,
  leadId: number,
  reason: StopReasonValue,
): Promise<void> {
  await db
    .update(campaign_leads)
    .set({ status: reason === StopReason.SEQUENCE_COMPLETE ? 'COMPLETED' : 'STOPPED' })
    .where(
      and(eq(campaign_leads.campaign_id, campaignId), eq(campaign_leads.lead_id, leadId)),
    );

  // Any follow-up still waiting for this lead on this campaign is now moot.
  const cancelled = await db
    .update(follow_ups)
    .set({ status: 'CANCELLED', cancel_reason: reason })
    .where(
      and(
        eq(follow_ups.lead_id, leadId),
        eq(follow_ups.campaign_id, campaignId),
        eq(follow_ups.status, 'PENDING'),
      ),
    )
    .returning();

  if (cancelled.length > 0) {
    await recordActivity(
      leadId,
      ActivityType.FOLLOW_UP_CANCELLED,
      `${cancelled.length} pending follow-up(s) cancelled — ${reason}`,
      { campaign_id: campaignId, reason },
    );
  }
}

export interface AdvanceSummary {
  campaign_id: number;
  considered: number;
  queued: number;
  scheduled: number;
  stopped: number;
  skipped: number;
  details: string[];
}

/**
 * Advances every active enrollment in a campaign by at most one step.
 *
 * Idempotent: the email for a given (lead, campaign, step) carries a derived
 * idempotency key, so running this twice queues nothing the second time.
 */
export async function advanceCampaign(campaignId: number, now: Date = new Date()): Promise<AdvanceSummary> {
  const summary: AdvanceSummary = {
    campaign_id: campaignId,
    considered: 0,
    queued: 0,
    scheduled: 0,
    stopped: 0,
    skipped: 0,
    details: [],
  };

  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
  if (!campaign) {
    summary.details.push('Campaign not found.');
    return summary;
  }
  if (campaign.status !== 'ACTIVE') {
    summary.details.push(`Campaign is ${campaign.status}; nothing advanced.`);
    return summary;
  }

  const steps = parseSequence(campaign.sequence);
  if (steps.length === 0) {
    summary.details.push('Campaign has no usable sequence steps.');
    return summary;
  }

  if (!campaign.email_account_id) {
    summary.details.push('Campaign has no sending account; nothing can be queued.');
    return summary;
  }
  const sender = await db.query.email_accounts.findFirst({
    where: eq(email_accounts.id, campaign.email_account_id),
  });
  const senderEmail = sender?.email;
  if (!senderEmail) {
    summary.details.push('Campaign sending account not found.');
    return summary;
  }

  const enrollments = await db.query.campaign_leads.findMany({
    where: and(eq(campaign_leads.campaign_id, campaignId), eq(campaign_leads.status, 'ACTIVE')),
  });

  // Respect the campaign's own daily cap independently of the account's.
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const queuedTodayRows = await db
    .select({ id: emails.id })
    .from(emails)
    .where(and(eq(emails.campaign_id, campaignId), gte(emails.created_at, startOfDay)));
  let remainingToday = Math.max(0, campaign.daily_limit - queuedTodayRows.length);

  for (const enrollment of enrollments) {
    summary.considered++;

    const lead = await db.query.leads.findFirst({ where: eq(leads.id, enrollment.lead_id) });
    if (!lead) {
      summary.skipped++;
      continue;
    }

    const stop = stopReasonFor(lead);
    if (stop) {
      await stopEnrollment(campaignId, lead.id, stop);
      summary.stopped++;
      summary.details.push(`Lead ${lead.id} stopped: ${stop}`);
      continue;
    }

    const nextStepNumber = enrollment.current_step + 1;
    const step = steps.find((s) => s.step === nextStepNumber);
    if (!step) {
      await stopEnrollment(campaignId, lead.id, StopReason.SEQUENCE_COMPLETE);
      summary.stopped++;
      continue;
    }

    // Step 1 goes out immediately; later steps wait for a due follow-up.
    if (nextStepNumber > 1) {
      const due = await db.query.follow_ups.findFirst({
        where: and(
          eq(follow_ups.lead_id, lead.id),
          eq(follow_ups.campaign_id, campaignId),
          eq(follow_ups.sequence_number, nextStepNumber),
          eq(follow_ups.status, 'PENDING'),
        ),
      });
      if (!due) {
        summary.skipped++;
        continue;
      }
      if (due.scheduled_at > now) {
        summary.skipped++;
        continue;
      }
    }

    if (remainingToday <= 0) {
      summary.skipped++;
      summary.details.push(`Campaign daily limit ${campaign.daily_limit} reached.`);
      continue;
    }

    const recipient = lead.email;
    if (!recipient) {
      summary.skipped++;
      summary.details.push(`Lead ${lead.id} has no email address.`);
      continue;
    }

    const leadRecord = lead as unknown as Record<string, unknown>;
    const queued = await enqueueEmail({
      lead_id: lead.id,
      campaign_id: campaignId,
      from_email: senderEmail,
      to_email: recipient,
      subject: renderTemplate(step.subject, leadRecord),
      body: renderTemplate(step.body, leadRecord),
      sequence_step: step.step,
      idempotency_key: buildIdempotencyKey({
        lead_id: lead.id,
        campaign_id: campaignId,
        subject: step.subject,
        step: step.step,
      }),
    });

    if (queued.queued) {
      summary.queued++;
      remainingToday--;
      await db
        .update(campaign_leads)
        .set({ current_step: nextStepNumber })
        .where(eq(campaign_leads.id, enrollment.id));

      if (nextStepNumber > 1) {
        await db
          .update(follow_ups)
          .set({ status: 'QUEUED' })
          .where(
            and(
              eq(follow_ups.lead_id, lead.id),
              eq(follow_ups.campaign_id, campaignId),
              eq(follow_ups.sequence_number, nextStepNumber),
            ),
          );
      }
    } else {
      summary.skipped++;
      summary.details.push(`Lead ${lead.id} step ${nextStepNumber}: ${queued.reason}`);
    }
  }

  return summary;
}

/**
 * After an email for a campaign step is actually sent, books the next step.
 * Does nothing when the sequence has no further steps.
 */
export async function scheduleNextStep(emailId: number, now: Date = new Date()): Promise<boolean> {
  const email = await db.query.emails.findFirst({ where: eq(emails.id, emailId) });
  if (!email || email.status !== EmailStatus.SENT || !email.campaign_id) return false;

  const campaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, email.campaign_id),
  });
  if (!campaign) return false;

  const steps = parseSequence(campaign.sequence);
  const enrollment = await db.query.campaign_leads.findFirst({
    where: and(
      eq(campaign_leads.campaign_id, email.campaign_id),
      eq(campaign_leads.lead_id, email.lead_id),
    ),
  });
  if (!enrollment || enrollment.status !== 'ACTIVE') return false;

  // Only the email for the step the lead is currently on may book the next
  // one, so the wait is always measured from the most recent send regardless
  // of the order rows are read in.
  if (email.sequence_step !== null && email.sequence_step !== enrollment.current_step) {
    return false;
  }

  const next = steps.find((s) => s.step === enrollment.current_step + 1);
  if (!next) {
    await stopEnrollment(email.campaign_id, email.lead_id, StopReason.SEQUENCE_COMPLETE);
    return false;
  }

  const base = email.sent_at ?? now;
  const scheduledAt = new Date(base.getTime() + next.wait_days * 24 * 60 * 60 * 1000);

  const rows = await db
    .insert(follow_ups)
    .values({
      lead_id: email.lead_id,
      campaign_id: email.campaign_id,
      sequence_number: next.step,
      scheduled_at: scheduledAt,
      status: 'PENDING',
    })
    .onConflictDoNothing({
      target: [follow_ups.lead_id, follow_ups.campaign_id, follow_ups.sequence_number],
    })
    .returning();

  if (rows.length === 0) return false;

  await db
    .update(leads)
    .set({ next_follow_up_at: scheduledAt })
    .where(eq(leads.id, email.lead_id));

  await recordActivity(
    email.lead_id,
    ActivityType.FOLLOW_UP_SCHEDULED,
    `Follow-up ${next.step} scheduled for ${scheduledAt.toISOString().slice(0, 10)}`,
    { campaign_id: email.campaign_id, step: next.step },
  );
  return true;
}

/** Stops sequences for every lead that has moved into a stop state. */
export async function reconcileStoppedLeads(): Promise<number> {
  const active = await db.query.campaign_leads.findMany({
    where: eq(campaign_leads.status, 'ACTIVE'),
  });
  let stopped = 0;
  for (const enrollment of active) {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, enrollment.lead_id) });
    if (!lead) continue;
    const reason = stopReasonFor(lead);
    if (reason) {
      await stopEnrollment(enrollment.campaign_id, enrollment.lead_id, reason);
      stopped++;
    }
  }
  return stopped;
}

/** Cancels queued mail for leads that must no longer be contacted. */
export async function cancelOutboundForStoppedLeads(): Promise<number> {
  const pending = await db.query.emails.findMany({
    where: inArray(emails.status, [EmailStatus.PENDING, EmailStatus.QUEUED]),
  });
  let cancelled = 0;
  for (const email of pending) {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, email.lead_id) });
    if (!lead) continue;
    if (!NO_OUTREACH_STAGES.includes(lead.status)) continue;
    await db
      .update(emails)
      .set({
        status: EmailStatus.CANCELLED,
        blocked_reason: 'DO_NOT_CONTACT',
        last_error: `Lead moved to ${lead.status} before sending.`,
      })
      .where(eq(emails.id, email.id));
    cancelled++;
  }
  return cancelled;
}
