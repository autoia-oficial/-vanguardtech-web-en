import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { activities, leads } from '@/db/schema';
import { PIPELINE_STAGES, isPipelineStage, NO_OUTREACH_STAGES, type PipelineStage } from '@/lib/pipeline';

export { PIPELINE_STAGES, isPipelineStage, NO_OUTREACH_STAGES };
export type { PipelineStage };

/**
 * Activity is the lead's permanent history. Nothing here is ever deleted by
 * normal operation — only an explicit administrative action removes a lead,
 * which cascades its history with it.
 */

export const ActivityType = {
  LEAD_CREATED: 'LEAD_CREATED',
  LEAD_UPDATED: 'LEAD_UPDATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  SCORE_CHANGED: 'SCORE_CHANGED',
  AUDIT_STARTED: 'AUDIT_STARTED',
  AUDIT_COMPLETED: 'AUDIT_COMPLETED',
  AUDIT_FAILED: 'AUDIT_FAILED',
  CONTACT_ADDED: 'CONTACT_ADDED',
  EMAIL_QUEUED: 'EMAIL_QUEUED',
  EMAIL_SENT: 'EMAIL_SENT',
  EMAIL_FAILED: 'EMAIL_FAILED',
  EMAIL_BLOCKED: 'EMAIL_BLOCKED',
  EMAIL_OPENED: 'EMAIL_OPENED',
  EMAIL_CLICKED: 'EMAIL_CLICKED',
  EMAIL_REPLIED: 'EMAIL_REPLIED',
  EMAIL_BOUNCED: 'EMAIL_BOUNCED',
  CAMPAIGN_ADDED: 'CAMPAIGN_ADDED',
  CAMPAIGN_REMOVED: 'CAMPAIGN_REMOVED',
  FOLLOW_UP_SCHEDULED: 'FOLLOW_UP_SCHEDULED',
  FOLLOW_UP_CANCELLED: 'FOLLOW_UP_CANCELLED',
  DEMO_SCHEDULED: 'DEMO_SCHEDULED',
  NOTE_ADDED: 'NOTE_ADDED',
  SUPPRESSED: 'SUPPRESSED',
} as const;

export type ActivityTypeValue = (typeof ActivityType)[keyof typeof ActivityType];

export async function recordActivity(
  leadId: number,
  type: ActivityTypeValue,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.insert(activities).values({
    lead_id: leadId,
    activity_type: type,
    description,
    metadata: metadata ?? null,
  });
}

/**
 * Changes a lead's stage and writes the transition to its history.
 * Returns false when the lead does not exist or is already at that stage.
 */
export async function changeLeadStatus(
  leadId: number,
  next: PipelineStage,
  reason?: string,
): Promise<boolean> {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  if (!lead) return false;
  if (lead.status === next) return false;

  await db
    .update(leads)
    .set({ status: next, updated_at: new Date() })
    .where(eq(leads.id, leadId));

  await recordActivity(
    leadId,
    ActivityType.STATUS_CHANGED,
    `${lead.status} → ${next}${reason ? ` (${reason})` : ''}`,
    { from: lead.status, to: next, reason: reason ?? null },
  );
  return true;
}
