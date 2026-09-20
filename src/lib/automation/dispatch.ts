import { runJob, JOB_KEYS, type JobKey, type JobOutcome } from './runner';
import {
  jobLeadDiscovery,
  jobWebsiteAudit,
  jobEmailQueue,
  jobFollowUp,
  jobCrmMaintenance,
  jobDuplicateDetection,
  jobErrorRetry,
} from './jobs';

/**
 * One dispatcher for both the cron routes and the "run now" button, so a
 * manual trigger goes through exactly the same locking and run-recording as a
 * scheduled one.
 */
const IMPLEMENTATIONS: Record<JobKey, () => Promise<import('./runner').JobResult>> = {
  'lead-discovery': jobLeadDiscovery,
  'website-audit': () => jobWebsiteAudit(),
  'email-queue': jobEmailQueue,
  'follow-up': () => jobFollowUp(),
  'crm-maintenance': jobCrmMaintenance,
  'duplicate-detection': jobDuplicateDetection,
  'error-retry': () => jobErrorRetry(),
};

export function isJobKey(value: string): value is JobKey {
  return (JOB_KEYS as readonly string[]).includes(value);
}

export async function dispatchJob(key: JobKey, options: { force?: boolean } = {}): Promise<JobOutcome> {
  return runJob(key, IMPLEMENTATIONS[key], options);
}
