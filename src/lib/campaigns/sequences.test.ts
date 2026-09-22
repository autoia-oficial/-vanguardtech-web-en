import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { emails, follow_ups, campaign_leads, leads } from '@/db/schema';
import {
  parseSequence,
  renderTemplate,
  stopReasonFor,
  enrollLead,
  advanceCampaign,
  scheduleNextStep,
  reconcileStoppedLeads,
  cancelOutboundForStoppedLeads,
  StopReason,
} from './sequences';
import { processEmailQueue } from '@/lib/email/queue';
import { setEmailProvider } from '@/lib/email/providers';
import { EmailStatus } from '@/lib/email/types';
import { resetDatabase, makeLead, makeSender, makeCampaign, FakeEmailProvider } from '@/test/helpers';

const SEQUENCE = [
  { step: 1, wait_days: 0, subject: 'Your website, {{business_name}}', body: 'Hi {{business_name}} in {{city}}' },
  { step: 2, wait_days: 3, subject: 'Following up', body: 'Just checking in' },
  { step: 3, wait_days: 7, subject: 'Last note', body: 'Closing the loop' },
];

async function setup() {
  const sender = await makeSender({ daily_limit: 100, hourly_limit: 100 });
  const campaign = await makeCampaign({
    status: 'ACTIVE',
    sequence: SEQUENCE,
    email_account_id: sender.id,
    daily_limit: 100,
  });
  const lead = await makeLead({ business_name: 'Atlas', city: 'Madrid', email: 'owner@atlas.example' });
  await enrollLead(campaign.id, lead.id);
  return { sender, campaign, lead };
}

beforeEach(async () => {
  await resetDatabase();
  setEmailProvider(null);
});

afterAll(async () => {
  setEmailProvider(null);
  await pool.end();
});

describe('parseSequence', () => {
  it('keeps usable steps and sorts them', () => {
    const steps = parseSequence([
      { step: 2, wait_days: 3, subject: 'b', body: 'b' },
      { step: 1, wait_days: 0, subject: 'a', body: 'a' },
    ]);
    expect(steps.map((s) => s.step)).toEqual([1, 2]);
  });

  it('drops steps missing a subject or body', () => {
    expect(parseSequence([{ step: 1, subject: '', body: 'x' }])).toHaveLength(0);
    expect(parseSequence([{ step: 1, subject: 'x', body: '  ' }])).toHaveLength(0);
  });

  it('returns nothing for a non-array', () => {
    expect(parseSequence(null)).toHaveLength(0);
    expect(parseSequence('nope')).toHaveLength(0);
  });

  it('defaults a missing wait to zero and never negative', () => {
    expect(parseSequence([{ step: 1, subject: 'a', body: 'a' }])[0].wait_days).toBe(0);
    expect(parseSequence([{ step: 1, wait_days: -5, subject: 'a', body: 'a' }])[0].wait_days).toBe(0);
  });
});

describe('renderTemplate', () => {
  it('substitutes known fields', () => {
    expect(renderTemplate('Hi {{business_name}}', { business_name: 'Atlas' })).toBe('Hi Atlas');
  });

  it('renders an unknown or null field as empty rather than leaving the placeholder', () => {
    expect(renderTemplate('Hi {{nope}}!', {})).toBe('Hi !');
    expect(renderTemplate('In {{city}}.', { city: null })).toBe('In .');
  });
});

describe('stopReasonFor', () => {
  it('stops on do-not-contact', () => {
    expect(stopReasonFor({ status: 'DO_NOT_CONTACT' })).toBe(StopReason.DO_NOT_CONTACT);
  });
  it('stops once the lead replied or showed interest', () => {
    for (const s of ['REPLIED', 'INTERESTED', 'MEETING', 'ACCEPTED']) {
      expect(stopReasonFor({ status: s })).toBe(StopReason.REPLIED);
    }
  });
  it('stops once the lead became a customer', () => {
    for (const s of ['PAID', 'PROJECT', 'LIVE']) {
      expect(stopReasonFor({ status: s })).toBe(StopReason.BECAME_CUSTOMER);
    }
  });
  it('continues for an ordinary prospect', () => {
    expect(stopReasonFor({ status: 'NEW' })).toBeNull();
    expect(stopReasonFor({ status: 'AUDITED' })).toBeNull();
  });
});

describe('enrolment', () => {
  it('enrols a lead once', async () => {
    const { campaign, lead } = await setup();
    expect(await enrollLead(campaign.id, lead.id)).toBe(false); // already enrolled by setup
    const rows = await db.select().from(campaign_leads).where(eq(campaign_leads.lead_id, lead.id));
    expect(rows).toHaveLength(1);
  });
});

describe('advanceCampaign', () => {
  it('queues the first step immediately', async () => {
    const { campaign, lead } = await setup();
    const summary = await advanceCampaign(campaign.id);
    expect(summary.queued).toBe(1);

    const queued = await db.select().from(emails).where(eq(emails.lead_id, lead.id));
    expect(queued).toHaveLength(1);
    expect(queued[0].subject).toBe('Your website, Atlas');
    expect(queued[0].body).toBe('Hi Atlas in Madrid');
    expect(queued[0].status).toBe(EmailStatus.PENDING);
  });

  it('is idempotent — running twice queues nothing extra', async () => {
    const { campaign, lead } = await setup();
    await advanceCampaign(campaign.id);
    const second = await advanceCampaign(campaign.id);
    expect(second.queued).toBe(0);
    const rows = await db.select().from(emails).where(eq(emails.lead_id, lead.id));
    expect(rows).toHaveLength(1);
  });

  it('does nothing when the campaign is paused', async () => {
    const { campaign } = await setup();
    await db.execute(`UPDATE campaigns SET status = 'PAUSED' WHERE id = ${campaign.id}` as never);
    const summary = await advanceCampaign(campaign.id);
    expect(summary.queued).toBe(0);
    expect(summary.details.join(' ')).toContain('PAUSED');
  });

  it('stops a lead that has replied instead of queueing', async () => {
    const { campaign, lead } = await setup();
    await db.update(leads).set({ status: 'REPLIED' }).where(eq(leads.id, lead.id));

    const summary = await advanceCampaign(campaign.id);
    expect(summary.queued).toBe(0);
    expect(summary.stopped).toBe(1);

    const enrollment = await db.query.campaign_leads.findFirst({
      where: eq(campaign_leads.lead_id, lead.id),
    });
    expect(enrollment?.status).toBe('STOPPED');
    expect(await db.select().from(emails).where(eq(emails.lead_id, lead.id))).toHaveLength(0);
  });

  it('stops a lead marked do-not-contact', async () => {
    const { campaign, lead } = await setup();
    await db.update(leads).set({ status: 'DO_NOT_CONTACT' }).where(eq(leads.id, lead.id));
    const summary = await advanceCampaign(campaign.id);
    expect(summary.stopped).toBe(1);
    expect(await db.select().from(emails).where(eq(emails.lead_id, lead.id))).toHaveLength(0);
  });

  it('stops a lead that became a customer', async () => {
    const { campaign, lead } = await setup();
    await db.update(leads).set({ status: 'PAID' }).where(eq(leads.id, lead.id));
    const summary = await advanceCampaign(campaign.id);
    expect(summary.stopped).toBe(1);
  });

  it('respects the campaign daily cap', async () => {
    const sender = await makeSender();
    const campaign = await makeCampaign({
      status: 'ACTIVE', sequence: SEQUENCE, email_account_id: sender.id, daily_limit: 1,
    });
    for (let i = 0; i < 3; i++) {
      const lead = await makeLead({ business_name: `B${i}`, email: `b${i}@x.example` });
      await enrollLead(campaign.id, lead.id);
    }
    const summary = await advanceCampaign(campaign.id);
    expect(summary.queued).toBe(1);
    expect(summary.details.join(' ')).toContain('daily limit');
  });

  it('skips a lead with no email address', async () => {
    const sender = await makeSender();
    const campaign = await makeCampaign({ status: 'ACTIVE', sequence: SEQUENCE, email_account_id: sender.id });
    const lead = await makeLead({ business_name: 'No Email', email: null });
    await enrollLead(campaign.id, lead.id);
    const summary = await advanceCampaign(campaign.id);
    expect(summary.queued).toBe(0);
    expect(summary.details.join(' ')).toContain('no email address');
  });

  it('reports a campaign with no sending account rather than failing silently', async () => {
    const campaign = await makeCampaign({ status: 'ACTIVE', sequence: SEQUENCE, email_account_id: null });
    const summary = await advanceCampaign(campaign.id);
    expect(summary.details.join(' ')).toContain('no sending account');
  });
});

describe('scheduleNextStep', () => {
  it('books the next step only after the previous one was actually sent', async () => {
    const { campaign, lead } = await setup();
    await advanceCampaign(campaign.id);

    const queued = (await db.select().from(emails).where(eq(emails.lead_id, lead.id)))[0];
    // Not sent yet, so nothing is booked.
    expect(await scheduleNextStep(queued.id)).toBe(false);
    expect(await db.select().from(follow_ups).where(eq(follow_ups.lead_id, lead.id))).toHaveLength(0);

    setEmailProvider(new FakeEmailProvider());
    await processEmailQueue();

    expect(await scheduleNextStep(queued.id)).toBe(true);
    const booked = await db.select().from(follow_ups).where(eq(follow_ups.lead_id, lead.id));
    expect(booked).toHaveLength(1);
    expect(booked[0].sequence_number).toBe(2);
  });

  it('schedules the wait from when the email was sent', async () => {
    const { campaign, lead } = await setup();
    await advanceCampaign(campaign.id);
    setEmailProvider(new FakeEmailProvider());
    await processEmailQueue();

    const sent = (await db.select().from(emails).where(eq(emails.lead_id, lead.id)))[0];
    await scheduleNextStep(sent.id);

    const booked = (await db.select().from(follow_ups).where(eq(follow_ups.lead_id, lead.id)))[0];
    const expected = sent.sent_at!.getTime() + 3 * 24 * 60 * 60 * 1000;
    expect(Math.abs(booked.scheduled_at.getTime() - expected)).toBeLessThan(2000);
  });

  it('does not book the same step twice', async () => {
    const { campaign, lead } = await setup();
    await advanceCampaign(campaign.id);
    setEmailProvider(new FakeEmailProvider());
    await processEmailQueue();
    const sent = (await db.select().from(emails).where(eq(emails.lead_id, lead.id)))[0];

    expect(await scheduleNextStep(sent.id)).toBe(true);
    expect(await scheduleNextStep(sent.id)).toBe(false);
    expect(await db.select().from(follow_ups).where(eq(follow_ups.lead_id, lead.id))).toHaveLength(1);
  });

  it('completes the enrolment after the last step', async () => {
    const sender = await makeSender();
    const campaign = await makeCampaign({
      status: 'ACTIVE',
      sequence: [{ step: 1, wait_days: 0, subject: 'Only step', body: 'x' }],
      email_account_id: sender.id,
    });
    const lead = await makeLead({ email: 'solo@x.example' });
    await enrollLead(campaign.id, lead.id);
    await advanceCampaign(campaign.id);
    setEmailProvider(new FakeEmailProvider());
    await processEmailQueue();

    const sent = (await db.select().from(emails).where(eq(emails.lead_id, lead.id)))[0];
    expect(await scheduleNextStep(sent.id)).toBe(false);

    const enrollment = await db.query.campaign_leads.findFirst({
      where: eq(campaign_leads.lead_id, lead.id),
    });
    expect(enrollment?.status).toBe('COMPLETED');
  });
});

describe('a follow-up does not go out before it is due', () => {
  it('waits for the scheduled date', async () => {
    const { campaign, lead } = await setup();
    await advanceCampaign(campaign.id);
    setEmailProvider(new FakeEmailProvider());
    await processEmailQueue();
    const sent = (await db.select().from(emails).where(eq(emails.lead_id, lead.id)))[0];
    await scheduleNextStep(sent.id);

    // Step 2 is three days out, so advancing now must not queue it.
    const summary = await advanceCampaign(campaign.id);
    expect(summary.queued).toBe(0);

    const later = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const dueSummary = await advanceCampaign(campaign.id, later);
    expect(dueSummary.queued).toBe(1);

    const all = await db.select().from(emails).where(eq(emails.lead_id, lead.id));
    expect(all).toHaveLength(2);
    expect(all.some((e) => e.subject === 'Following up')).toBe(true);
  });
});

describe('reconcileStoppedLeads', () => {
  it('stops enrolments whose lead left the funnel', async () => {
    const { lead } = await setup();
    await db.update(leads).set({ status: 'LIVE' }).where(eq(leads.id, lead.id));
    expect(await reconcileStoppedLeads()).toBe(1);
    const enrollment = await db.query.campaign_leads.findFirst({
      where: eq(campaign_leads.lead_id, lead.id),
    });
    expect(enrollment?.status).toBe('STOPPED');
  });

  it('cancels pending follow-ups when the sequence stops', async () => {
    const { campaign, lead } = await setup();
    await advanceCampaign(campaign.id);
    setEmailProvider(new FakeEmailProvider());
    await processEmailQueue();
    const sent = (await db.select().from(emails).where(eq(emails.lead_id, lead.id)))[0];
    await scheduleNextStep(sent.id);

    await db.update(leads).set({ status: 'REPLIED' }).where(eq(leads.id, lead.id));
    await reconcileStoppedLeads();

    const booked = await db.select().from(follow_ups).where(eq(follow_ups.lead_id, lead.id));
    expect(booked[0].status).toBe('CANCELLED');
    expect(booked[0].cancel_reason).toBe(StopReason.REPLIED);
  });
});

describe('cancelOutboundForStoppedLeads', () => {
  it('cancels queued email once the lead must not be contacted', async () => {
    const { campaign, lead } = await setup();
    await advanceCampaign(campaign.id);
    await db.update(leads).set({ status: 'DO_NOT_CONTACT' }).where(eq(leads.id, lead.id));

    expect(await cancelOutboundForStoppedLeads()).toBe(1);
    const row = (await db.select().from(emails).where(eq(emails.lead_id, lead.id)))[0];
    expect(row.status).toBe(EmailStatus.CANCELLED);
    expect(row.blocked_reason).toBe('DO_NOT_CONTACT');
  });

  it('leaves queued email alone for an active prospect', async () => {
    const { campaign } = await setup();
    await advanceCampaign(campaign.id);
    expect(await cancelOutboundForStoppedLeads()).toBe(0);
  });
});

describe('full sequence', () => {
  it('runs all three steps in order and then completes', async () => {
    const { campaign, lead } = await setup();
    const fake = new FakeEmailProvider();
    setEmailProvider(fake);

    let clock = new Date();
    for (let i = 0; i < 3; i++) {
      await advanceCampaign(campaign.id, clock);
      // The worker runs after the queueing, as it does under cron; the
      // cool-off would otherwise block steps 2 and 3 for a fortnight.
      const workerAt = new Date(clock.getTime() + 60_000);
      await processEmailQueue({ now: workerAt, recentContactDays: 0 });
      const sentRows = await db
        .select()
        .from(emails)
        .where(and(eq(emails.lead_id, lead.id), eq(emails.status, EmailStatus.SENT)));
      for (const row of sentRows) await scheduleNextStep(row.id, workerAt);
      clock = new Date(clock.getTime() + 10 * 24 * 60 * 60 * 1000);
    }

    expect(fake.sent.map((e) => e.subject)).toEqual([
      'Your website, Atlas',
      'Following up',
      'Last note',
    ]);

    const enrollment = await db.query.campaign_leads.findFirst({
      where: eq(campaign_leads.lead_id, lead.id),
    });
    expect(enrollment?.status).toBe('COMPLETED');
  });
});

describe('sender fields in templates', () => {
  it('fills {{sender_email}} from the campaign account, not with an empty string', async () => {
    const account = await makeSender({ email: 'ventas@vanguard.example', name: 'Vanguard Tech' });
    const lead = await makeLead({ business_name: 'Bar Central', email: 'bar@ejemplo.example' });
    const campaign = await makeCampaign({
      email_account_id: account.id,
      status: 'ACTIVE',
      sequence: [
        {
          step: 1,
          wait_days: 0,
          subject: 'Hola {{business_name}}',
          body: 'Escríbeme a {{sender_email}} — {{sender_name}}',
        },
      ],
    });
    await enrollLead(campaign.id, lead.id);

    await advanceCampaign(campaign.id);

    const queued = await db.query.emails.findFirst({ where: eq(emails.lead_id, lead.id) });
    expect(queued?.body).toContain('ventas@vanguard.example');
    expect(queued?.body).toContain('Vanguard Tech');
    expect(queued?.body).not.toContain('{{');
  });
});
