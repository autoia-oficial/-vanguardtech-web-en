import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, and } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  leads, audits, audit_checks, contacts, emails, activities,
  follow_ups, campaign_leads, automation_runs, errors as errorsTable,
} from '@/db/schema';
import { auditWebsite } from '@/lib/audit/auditor';
import { scoreLead, priorityForScore } from '@/lib/scoring';
import { persistDiscovered } from '@/lib/discovery/engine';
import { enrollLead, advanceCampaign, scheduleNextStep } from '@/lib/campaigns/sequences';
import { processEmailQueue } from '@/lib/email/queue';
import { setEmailProvider } from '@/lib/email/providers';
import { EmailStatus } from '@/lib/email/types';
import { changeLeadStatus, recordActivity, ActivityType } from '@/lib/activity';
import { runJob } from '@/lib/automation/runner';
import { findDuplicateLead } from '@/lib/dedupe';
import { resetDatabase, makeSender, makeCampaign, FakeEmailProvider } from '@/test/helpers';
import type { CheckResult } from '@/lib/audit/types';

/**
 * One lead, start to finish, against the real database:
 *
 *   discovered → audited → scored → contact recorded → enrolled → email queued
 *   → sent → follow-up booked → stage advanced → activity written
 *   → visible in the CRM views → cleaned up.
 *
 * The website is served from loopback so the audit is a genuine fetch and parse
 * rather than a stubbed result.
 */

const SITE = `<!doctype html>
<html>
<head><title>Gimnasio Atlas</title></head>
<body>
  <div>Gimnasio Atlas, Madrid</div>
  <img src="a.jpg">
</body></html>`;

let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SITE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  setEmailProvider(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe('end to end: one lead through the whole system', () => {
  it('persists every stage and then cleans up', async () => {
    await resetDatabase();

    // --- 1. Discovery -----------------------------------------------------
    const leadId = await persistDiscovered({
      business_name: 'Gimnasio Atlas',
      category: 'gyms',
      city: 'Madrid',
      province: 'Madrid',
      country: 'Spain',
      address: 'Calle Mayor 1',
      phone: '+34 910 000 111',
      email: 'owner@atlas.example',
      website: base,
      source: 'openstreetmap',
      source_url: 'https://www.openstreetmap.org/node/1',
      external_id: 'node/1',
    });
    expect(leadId).not.toBeNull();

    const created = await db.query.leads.findFirst({ where: eq(leads.id, leadId!) });
    expect(created?.business_name).toBe('Gimnasio Atlas');
    expect(created?.status).toBe('NEW');
    expect(created?.dedupe_key).toBe('openstreetmap:node/1');

    // Re-running discovery must not create a second copy.
    const again = await persistDiscovered({
      business_name: 'Gimnasio Atlas',
      website: base,
      source: 'openstreetmap',
      external_id: 'node/1',
    });
    expect(again).toBeNull();
    expect(await db.select().from(leads)).toHaveLength(1);

    // --- 2. Audit ---------------------------------------------------------
    const result = await auditWebsite(base, {
      business_name: created!.business_name,
      phone: created!.phone,
      city: created!.city,
    });
    expect(result.fetch_error).toBeNull();
    expect(result.checks).toHaveLength(13);

    const auditRow = (
      await db.insert(audits).values({
        lead_id: leadId!,
        url: result.url,
        overall_status: result.overall_status,
        overall_score: result.overall_score,
        fetch_error: result.fetch_error,
      }).returning()
    )[0];

    await db.insert(audit_checks).values(
      result.checks.map((c) => ({
        audit_id: auditRow.id,
        check_number: c.check_number,
        check_name: c.check_name,
        status: c.status,
        evidence: c.evidence,
        problem: c.problem,
        impact: c.impact,
        priority: c.priority,
        checked_at: c.checked_at,
      })),
    );

    const storedChecks = await db.select().from(audit_checks).where(eq(audit_checks.audit_id, auditRow.id));
    expect(storedChecks).toHaveLength(13);
    // The fixture site is poor, so real failures must have been found.
    expect(storedChecks.some((c) => c.status === 'FAIL')).toBe(true);
    // And every failure must carry evidence, not just a verdict.
    for (const c of storedChecks) {
      if (c.status === 'FAIL') {
        expect(c.evidence).toBeTruthy();
        expect(c.problem).toBeTruthy();
      }
    }

    await recordActivity(leadId!, ActivityType.AUDIT_COMPLETED, 'Audit complete');
    await changeLeadStatus(leadId!, 'AUDITED', 'audit completed');

    // --- 3. Score ---------------------------------------------------------
    const checks: CheckResult[] = storedChecks.map((c) => ({
      check_number: c.check_number,
      check_name: c.check_name,
      status: c.status as CheckResult['status'],
      evidence: c.evidence,
      problem: c.problem,
      impact: c.impact,
      priority: c.priority as CheckResult['priority'],
      checked_at: c.checked_at ?? new Date(),
    }));
    const breakdown = scoreLead(created!, checks);
    await db.update(leads).set({
      score: breakdown.total,
      priority: priorityForScore(breakdown.total),
    }).where(eq(leads.id, leadId!));

    const scored = await db.query.leads.findFirst({ where: eq(leads.id, leadId!) });
    expect(scored!.score).toBeGreaterThan(0);
    // Reachable business with a failing site should rank as worth contacting.
    expect(scored!.score).toBeGreaterThanOrEqual(60);

    // --- 4. Contact -------------------------------------------------------
    const contact = (
      await db.insert(contacts).values({
        lead_id: leadId!,
        contact_email: 'owner@atlas.example',
        contact_name: 'Owner',
      }).returning()
    )[0];
    expect(contact.id).toBeGreaterThan(0);

    // --- 5. Campaign ------------------------------------------------------
    const sender = await makeSender({ daily_limit: 50, hourly_limit: 10 });
    const campaign = await makeCampaign({
      name: 'Madrid gyms',
      status: 'ACTIVE',
      email_account_id: sender.id,
      daily_limit: 50,
      sequence: [
        { step: 1, wait_days: 0, subject: 'About {{business_name}}', body: 'Hi {{business_name}}' },
        { step: 2, wait_days: 4, subject: 'Following up', body: 'Checking in' },
      ],
    });
    expect(await enrollLead(campaign.id, leadId!)).toBe(true);

    // --- 6. Queue ---------------------------------------------------------
    const advance = await advanceCampaign(campaign.id);
    expect(advance.queued).toBe(1);

    const queued = (await db.select().from(emails).where(eq(emails.lead_id, leadId!)))[0];
    expect(queued.status).toBe(EmailStatus.PENDING);
    expect(queued.subject).toBe('About Gimnasio Atlas');
    expect(queued.sent_at).toBeNull();
    expect(queued.sequence_step).toBe(1);

    // --- 7. Worker --------------------------------------------------------
    const fake = new FakeEmailProvider(() => ({ ok: true, provider_message_id: 'e2e-msg-1' }));
    setEmailProvider(fake);
    const workerAt = new Date(Date.now() + 60_000);
    const summary = await processEmailQueue({ now: workerAt });
    expect(summary.sent).toBe(1);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].to).toBe('owner@atlas.example');

    const sent = (await db.select().from(emails).where(eq(emails.lead_id, leadId!)))[0];
    expect(sent.status).toBe(EmailStatus.SENT);
    expect(sent.provider_message_id).toBe('e2e-msg-1');
    expect(sent.sent_at).toBeInstanceOf(Date);

    // --- 8. Follow-up -----------------------------------------------------
    expect(await scheduleNextStep(sent.id, workerAt)).toBe(true);
    const booked = await db.select().from(follow_ups).where(eq(follow_ups.lead_id, leadId!));
    expect(booked).toHaveLength(1);
    expect(booked[0].sequence_number).toBe(2);
    expect(booked[0].status).toBe('PENDING');

    // --- 9. Stage ---------------------------------------------------------
    await changeLeadStatus(leadId!, 'CONTACTED', 'first email sent');
    const contacted = await db.query.leads.findFirst({ where: eq(leads.id, leadId!) });
    expect(contacted!.status).toBe('CONTACTED');
    expect(contacted!.last_contact_at).toBeInstanceOf(Date);

    // --- 10. Automation run ----------------------------------------------
    const outcome = await runJob('crm-maintenance', async () => ({ processed: 1, success: 1 }));
    expect(outcome.ran).toBe(true);
    const runs = await db.select().from(automation_runs);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('COMPLETED');

    // --- 11. History ------------------------------------------------------
    const history = await db.select().from(activities).where(eq(activities.lead_id, leadId!));
    const types = history.map((a) => a.activity_type);
    expect(types).toContain('LEAD_CREATED');
    expect(types).toContain('AUDIT_COMPLETED');
    expect(types).toContain('STATUS_CHANGED');
    expect(types).toContain('CAMPAIGN_ADDED');
    expect(types).toContain('EMAIL_QUEUED');
    expect(types).toContain('EMAIL_SENT');
    expect(types).toContain('FOLLOW_UP_SCHEDULED');

    // --- 12. Visible in the CRM's own views -------------------------------
    const duplicate = await findDuplicateLead({ email: 'OWNER@ATLAS.EXAMPLE' });
    expect(duplicate?.lead_id).toBe(leadId);

    const enrollment = await db.query.campaign_leads.findFirst({
      where: and(eq(campaign_leads.lead_id, leadId!), eq(campaign_leads.campaign_id, campaign.id)),
    });
    expect(enrollment?.current_step).toBe(1);
    expect(enrollment?.status).toBe('ACTIVE');

    // Nothing anywhere should be an invented failure.
    expect(await db.select().from(errorsTable)).toHaveLength(0);

    // --- 13. Cleanup ------------------------------------------------------
    await db.delete(leads).where(eq(leads.id, leadId!));

    expect(await db.select().from(leads)).toHaveLength(0);
    // Deleting the lead cascades its whole history, which is why it is an
    // explicit administrative action rather than something a job does.
    expect(await db.select().from(activities)).toHaveLength(0);
    expect(await db.select().from(audits)).toHaveLength(0);
    expect(await db.select().from(audit_checks)).toHaveLength(0);
    expect(await db.select().from(emails)).toHaveLength(0);
    expect(await db.select().from(follow_ups)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(await db.select().from(campaign_leads)).toHaveLength(0);

    await resetDatabase();
  });
});
