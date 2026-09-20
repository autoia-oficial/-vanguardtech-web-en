/**
 * Pipeline constants with no database import, so client components can use
 * them without pulling the server-only db client into the browser bundle.
 */

export const PIPELINE_STAGES = [
  'NEW',
  'QUALIFIED',
  'AUDIT_READY',
  'AUDITED',
  'DEMO_READY',
  'CONTACTED',
  'REPLIED',
  'DEMO_SENT',
  'INTERESTED',
  'MEETING',
  'ACCEPTED',
  'PAID',
  'PROJECT',
  'LIVE',
  'LOST',
  'DO_NOT_CONTACT',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function isPipelineStage(v: string): v is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(v);
}

/** Stages at which outbound sales email must stop. */
export const NO_OUTREACH_STAGES: readonly string[] = [
  'DO_NOT_CONTACT',
  'LOST',
  'PAID',
  'PROJECT',
  'LIVE',
];
