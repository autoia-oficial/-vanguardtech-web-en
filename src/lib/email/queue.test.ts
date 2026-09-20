import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { emails, leads, email_events, activities } from '@/db/schema';
import {
  enqueueEmail,
  processEmailQueue,
  buildIdempotencyKey,
  reclaimStuckSending,
} from './queue';
import { setEmailProvider } from './providers';
import { EmailStatus, BlockReason, isPlausibleEmail } from './types';
import {
  resetDatabase,
  makeLead,
  makeSender,
  makeCampaign,
  suppress,
  getEmail,
  FakeEmailProvider,
  NotConfiguredProvider,
} from '@/test/helpers';

const SENDER = 'sales@vanguard.example';

async function queueOne(overrides: Record<string, unknown> = {}) {
  const lead = (overrides.lead as Awaited<ReturnType<typeof makeLead>>) ?? (await makeLead());
  return enqueueEmail({
    lead_id: lead.id,
    from_email: SENDER,
    to_email: lead.email ?? 'owner@testbusiness.example',
    subject: 'A quick note about your website',
    body: 'Hello',
    ...(overrides.input as object),
  });
}

beforeEach(async () => {
  await resetDatabase();
  setEmailProvider(null);
});

afterAll(async () => {
  setEmailProvider(null);
  await pool.end();
});

// ---------------------------------------------------------------------------

describe('isPlausibleEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isPlausibleEmail('owner@shop.com')).toBe(true);
    expect(isPlausibleEmail('a.b+c@sub.domain.co.uk')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['', 'nope', 'a@b', 'a@@b.com', 'a b@c.com', 'a@.com', 'a@b..com', 'a@b.']) {
      expect(isPlausibleEmail(bad), bad).toBe(false);
    }
  });
});

describe('enqueueEmail — gates', () => {
  it('queues a valid email', async () => {
    const res = await queueOne();
    expect(res.queued).toBe(true);
    const row = await getEmail((res as { email_id: number }).email_id);
    expect(row.status).toBe(EmailStatus.PENDING);
    expect(row.sent_at).toBeNull();
  });

  it('refuses an invalid recipient', async () => {
    const lead = await makeLead({ email: 'not-an-email' });
    const res = await enqueueEmail({
      lead_id: lead.id,
      from_email: SENDER,
      to_email: 'not-an-email',
      subject: 's',
      body: 'b',
    });
    expect(res).toMatchObject({ queued: false, reason: BlockReason.INVALID_RECIPIENT });
  });

  it('refuses a suppressed recipient', async () => {
    const lead = await makeLead({ email: 'blocked@shop.example' });
    await suppress('blocked@shop.example', 'unsubscribed');
    const res = await queueOne({ lead });
    expect(res).toMatchObject({ queued: false, reason: BlockReason.SUPPRESSED });
  });

  it('refuses a DO_NOT_CONTACT lead', async () => {
    const lead = await makeLead({ status: 'DO_NOT_CONTACT' });
    const res = await queueOne({ lead });
    expect(res).toMatchObject({ queued: false, reason: BlockReason.DO_NOT_CONTACT });
  });

  it.each(['LOST', 'PAID', 'PROJECT', 'LIVE'])(
    'stops sales outreach to a lead at stage %s',
    async (status) => {
      const lead = await makeLead({ status });
      const res = await queueOne({ lead });
      expect(res).toMatchObject({ queued: false, reason: BlockReason.DO_NOT_CONTACT });
    },
  );

  it('refuses when the campaign is not active', async () => {
    const lead = await makeLead();
    const campaign = await makeCampaign({ status: 'PAUSED' });
    const res = await enqueueEmail({
      lead_id: lead.id,
      campaign_id: campaign.id,
      from_email: SENDER,
      to_email: lead.email!,
      subject: 's',
      body: 'b',
    });
    expect(res).toMatchObject({ queued: false, reason: BlockReason.CAMPAIGN_INACTIVE });
  });

  it('refuses a second outstanding email for the same lead', async () => {
    const lead = await makeLead();
    const first = await queueOne({ lead });
    expect(first.queued).toBe(true);
    const second = await enqueueEmail({
      lead_id: lead.id,
      from_email: SENDER,
      to_email: lead.email!,
      subject: 'A different subject entirely',
      body: 'b',
    });
    expect(second).toMatchObject({ queued: false, reason: BlockReason.ALREADY_PENDING_FOR_LEAD });
  });

  it('refuses an unknown lead', async () => {
    const res = await enqueueEmail({
      lead_id: 999999,
      from_email: SENDER,
      to_email: 'a@b.com',
      subject: 's',
      body: 'b',
    });
    expect(res).toMatchObject({ queued: false, reason: BlockReason.LEAD_MISSING });
  });
});

describe('enqueueEmail — idempotency', () => {
  it('derives a stable key from lead, campaign, step and subject', () => {
    const a = buildIdempotencyKey({ lead_id: 1, campaign_id: 2, subject: 'Hello', step: 1 });
    const b = buildIdempotencyKey({ lead_id: 1, campaign_id: 2, subject: 'hello ', step: 1 });
    const c = buildIdempotencyKey({ lead_id: 1, campaign_id: 2, subject: 'Hello', step: 2 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('will not queue the same key twice, even after the first is sent', async () => {
    const lead = await makeLead();
    await makeSender();
    const key = 'fixed-key-for-this-test';

    const first = await enqueueEmail({
      lead_id: lead.id,
      from_email: SENDER,
      to_email: lead.email!,
      subject: 's',
      body: 'b',
      idempotency_key: key,
    });
    expect(first.queued).toBe(true);

    setEmailProvider(new FakeEmailProvider());
    await processEmailQueue();

    const second = await enqueueEmail({
      lead_id: lead.id,
      from_email: SENDER,
      to_email: lead.email!,
      subject: 's',
      body: 'b',
      idempotency_key: key,
    });
    expect(second).toMatchObject({ queued: false, reason: 'DUPLICATE' });

    const all = await db.select().from(emails).where(eq(emails.lead_id, lead.id));
    expect(all).toHaveLength(1);
  });

  it('enforces uniqueness at the database level, not just in code', async () => {
    const lead = await makeLead();
    await db.insert(emails).values({
      lead_id: lead.id,
      from_email: SENDER,
      to_email: 'a@b.com',
      subject: 's',
      body: 'b',
      idempotency_key: 'dup',
    });
    await expect(
      db.insert(emails).values({
        lead_id: lead.id,
        from_email: SENDER,
        to_email: 'a@b.com',
        subject: 's2',
        body: 'b',
        idempotency_key: 'dup',
      }),
    ).rejects.toThrow();
  });
});

describe('processEmailQueue — no transport configured', () => {
  it('sends nothing and marks nothing as sent', async () => {
    await makeSender();
    const res = await queueOne();
    expect(res.queued).toBe(true);

    setEmailProvider(new NotConfiguredProvider());
    const summary = await processEmailQueue();

    expect(summary.provider_available).toBe(false);
    expect(summary.not_configured?.missing).toContain('SMTP_HOST');
    expect(summary.claimed).toBe(0);
    expect(summary.sent).toBe(0);

    const row = await getEmail((res as { email_id: number }).email_id);
    expect(row.status).toBe(EmailStatus.PENDING);
    expect(row.sent_at).toBeNull();
    expect(row.provider_message_id).toBeNull();
  });

  it('writes no SENT event when there is no transport', async () => {
    await makeSender();
    await queueOne();
    setEmailProvider(new NotConfiguredProvider());
    await processEmailQueue();
    const events = await db.select().from(email_events);
    expect(events).toHaveLength(0);
  });
});

describe('processEmailQueue — sending', () => {
  it('marks SENT only with a provider message id, and records the event', async () => {
    await makeSender();
    const res = await queueOne();
    const fake = new FakeEmailProvider(() => ({ ok: true, provider_message_id: 'msg-123' }));
    setEmailProvider(fake);

    const summary = await processEmailQueue();
    expect(summary.sent).toBe(1);
    expect(fake.sent).toHaveLength(1);

    const row = await getEmail((res as { email_id: number }).email_id);
    expect(row.status).toBe(EmailStatus.SENT);
    expect(row.provider_message_id).toBe('msg-123');
    expect(row.sent_at).toBeInstanceOf(Date);
    expect(row.attempts).toBe(1);

    const events = await db.select().from(email_events).where(eq(email_events.email_id, row.id));
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('SENT');
  });

  it('stamps last_contact_at on the lead when a send succeeds', async () => {
    await makeSender();
    const lead = await makeLead();
    await queueOne({ lead });
    setEmailProvider(new FakeEmailProvider());
    await processEmailQueue();

    const after = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) });
    expect(after?.last_contact_at).toBeInstanceOf(Date);
  });

  it('leaves the email unsent when the provider refuses', async () => {
    await makeSender();
    const res = await queueOne();
    setEmailProvider(
      new FakeEmailProvider(() => ({ ok: false, error: 'mailbox full', retryable: true })),
    );

    const summary = await processEmailQueue();
    expect(summary.sent).toBe(0);
    expect(summary.retry_scheduled).toBe(1);

    const row = await getEmail((res as { email_id: number }).email_id);
    expect(row.status).toBe(EmailStatus.PENDING);
    expect(row.sent_at).toBeNull();
    expect(row.last_error).toBe('mailbox full');
    expect(row.next_retry_at).toBeInstanceOf(Date);
  });

  it('never sends the same email twice across repeated runs', async () => {
    await makeSender();
    await queueOne();
    const fake = new FakeEmailProvider();
    setEmailProvider(fake);

    await processEmailQueue();
    await processEmailQueue();
    await processEmailQueue();

    expect(fake.sent).toHaveLength(1);
  });

  it('does not pick up an email scheduled for the future', async () => {
    await makeSender();
    const lead = await makeLead();
    await enqueueEmail({
      lead_id: lead.id,
      from_email: SENDER,
      to_email: lead.email!,
      subject: 's',
      body: 'b',
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000),
    });
    const fake = new FakeEmailProvider();
    setEmailProvider(fake);
    await processEmailQueue();
    expect(fake.sent).toHaveLength(0);
  });
});

describe('processEmailQueue — retry policy', () => {
  it('retries a retryable failure until max_attempts, then fails permanently', async () => {
    await makeSender();
    const res = await queueOne();
    const id = (res as { email_id: number }).email_id;
    setEmailProvider(
      new FakeEmailProvider(() => ({ ok: false, error: 'temporary', retryable: true })),
    );

    for (let i = 1; i <= 3; i++) {
      // Clear the backoff so the next run is due.
      await db.update(emails).set({ next_retry_at: null }).where(eq(emails.id, id));
      await processEmailQueue();
    }

    const row = await getEmail(id);
    expect(row.attempts).toBe(3);
    expect(row.status).toBe(EmailStatus.FAILED);
    expect(row.sent_at).toBeNull();
  });

  it('does not retry a permanent rejection', async () => {
    await makeSender();
    const res = await queueOne();
    setEmailProvider(
      new FakeEmailProvider(() => ({ ok: false, error: 'no such mailbox', retryable: false })),
    );
    await processEmailQueue();

    const row = await getEmail((res as { email_id: number }).email_id);
    expect(row.status).toBe(EmailStatus.FAILED);
    expect(row.attempts).toBe(1);
    expect(row.next_retry_at).toBeNull();
  });

  it('backs off further on each successive attempt', async () => {
    await makeSender();
    const res = await queueOne();
    const id = (res as { email_id: number }).email_id;
    setEmailProvider(new FakeEmailProvider(() => ({ ok: false, error: 'x', retryable: true })));

    await processEmailQueue();
    const first = (await getEmail(id)).next_retry_at!;

    await db.update(emails).set({ next_retry_at: null }).where(eq(emails.id, id));
    await processEmailQueue();
    const second = (await getEmail(id)).next_retry_at!;

    expect(second.getTime() - Date.now()).toBeGreaterThan(first.getTime() - Date.now());
  });
});

describe('processEmailQueue — limits', () => {
  it('stops at the daily limit and defers rather than cancelling', async () => {
    await makeSender({ daily_limit: 1, hourly_limit: 100 });
    const a = await makeLead({ business_name: 'A', email: 'a@shop.example' });
    const b = await makeLead({ business_name: 'B', email: 'b@shop.example' });
    await queueOne({ lead: a });
    await queueOne({ lead: b });

    setEmailProvider(new FakeEmailProvider());
    const summary = await processEmailQueue();

    expect(summary.sent).toBe(1);
    expect(summary.blocked_reasons[BlockReason.DAILY_LIMIT]).toBe(1);

    const rows = await db.select().from(emails);
    const deferred = rows.find((r) => r.status === EmailStatus.PENDING);
    expect(deferred?.blocked_reason).toBe(BlockReason.DAILY_LIMIT);
    expect(deferred?.next_retry_at).toBeInstanceOf(Date);
  });

  it('counts the daily limit over today only, not all history', async () => {
    const sender = await makeSender({ daily_limit: 2, hourly_limit: 100 });
    const old = await makeLead({ business_name: 'Old', email: 'old@shop.example' });

    // A send from well before today must not consume today's allowance.
    await db.insert(emails).values({
      lead_id: old.id,
      from_email: sender.email,
      to_email: 'old@shop.example',
      subject: 'historic',
      body: 'b',
      status: EmailStatus.SENT,
      idempotency_key: 'historic-1',
      sent_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const fresh = await makeLead({ business_name: 'Fresh', email: 'fresh@shop.example' });
    await queueOne({ lead: fresh });

    setEmailProvider(new FakeEmailProvider());
    const summary = await processEmailQueue();
    expect(summary.sent).toBe(1);
  });

  it('stops at the hourly limit', async () => {
    const sender = await makeSender({ daily_limit: 100, hourly_limit: 1 });
    const a = await makeLead({ business_name: 'A', email: 'a@shop.example' });
    await db.insert(emails).values({
      lead_id: a.id,
      from_email: sender.email,
      to_email: 'a@shop.example',
      subject: 'earlier',
      body: 'b',
      status: EmailStatus.SENT,
      idempotency_key: 'earlier-1',
      sent_at: new Date(Date.now() - 5 * 60 * 1000),
    });

    const b = await makeLead({ business_name: 'B', email: 'b@shop.example' });
    await queueOne({ lead: b });

    setEmailProvider(new FakeEmailProvider());
    const summary = await processEmailQueue();
    expect(summary.sent).toBe(0);
    expect(summary.blocked_reasons[BlockReason.HOURLY_LIMIT]).toBe(1);
  });

  it('refuses to send to a lead contacted inside the cool-off window', async () => {
    await makeSender();
    const lead = await makeLead({ last_contact_at: new Date(Date.now() - 24 * 60 * 60 * 1000) });
    const res = await queueOne({ lead });
    setEmailProvider(new FakeEmailProvider());

    const summary = await processEmailQueue({ recentContactDays: 14 });
    expect(summary.sent).toBe(0);
    expect(summary.blocked_reasons[BlockReason.RECENTLY_CONTACTED]).toBe(1);

    const row = await getEmail((res as { email_id: number }).email_id);
    expect(row.status).toBe(EmailStatus.CANCELLED);
  });

  it('sends once the cool-off window has passed', async () => {
    await makeSender();
    const lead = await makeLead({ last_contact_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });
    await queueOne({ lead });
    setEmailProvider(new FakeEmailProvider());
    const summary = await processEmailQueue({ recentContactDays: 14 });
    expect(summary.sent).toBe(1);
  });
});

describe('processEmailQueue — gates re-checked at send time', () => {
  it('cancels when the lead was set to DO_NOT_CONTACT after queueing', async () => {
    await makeSender();
    const lead = await makeLead();
    const res = await queueOne({ lead });
    await db.update(leads).set({ status: 'DO_NOT_CONTACT' }).where(eq(leads.id, lead.id));

    const fake = new FakeEmailProvider();
    setEmailProvider(fake);
    const summary = await processEmailQueue();

    expect(fake.sent).toHaveLength(0);
    expect(summary.blocked_reasons[BlockReason.DO_NOT_CONTACT]).toBe(1);
    const row = await getEmail((res as { email_id: number }).email_id);
    expect(row.status).toBe(EmailStatus.CANCELLED);
  });

  it('cancels when the recipient was suppressed after queueing', async () => {
    await makeSender();
    const lead = await makeLead({ email: 'later@shop.example' });
    await queueOne({ lead });
    await suppress('later@shop.example', 'complained');

    const fake = new FakeEmailProvider();
    setEmailProvider(fake);
    const summary = await processEmailQueue();

    expect(fake.sent).toHaveLength(0);
    expect(summary.blocked_reasons[BlockReason.SUPPRESSED]).toBe(1);
  });

  it('cancels when the campaign was paused after queueing', async () => {
    await makeSender();
    const lead = await makeLead();
    const campaign = await makeCampaign({ status: 'ACTIVE' });
    await enqueueEmail({
      lead_id: lead.id,
      campaign_id: campaign.id,
      from_email: SENDER,
      to_email: lead.email!,
      subject: 's',
      body: 'b',
    });
    await db.execute(sql`UPDATE campaigns SET status = 'PAUSED'`);

    const fake = new FakeEmailProvider();
    setEmailProvider(fake);
    const summary = await processEmailQueue();

    expect(fake.sent).toHaveLength(0);
    expect(summary.blocked_reasons[BlockReason.CAMPAIGN_INACTIVE]).toBe(1);
  });

  it('cancels when the sending account was deactivated', async () => {
    await makeSender({ is_active: false });
    await queueOne();
    const fake = new FakeEmailProvider();
    setEmailProvider(fake);
    const summary = await processEmailQueue();
    expect(fake.sent).toHaveLength(0);
    expect(summary.blocked_reasons[BlockReason.SENDER_UNAVAILABLE]).toBe(1);
  });
});

describe('processEmailQueue — concurrency', () => {
  it('two simultaneous runs never send the same email twice', async () => {
    await makeSender({ daily_limit: 100, hourly_limit: 100 });
    for (let i = 0; i < 5; i++) {
      const lead = await makeLead({ business_name: `B${i}`, email: `b${i}@shop.example` });
      await queueOne({ lead });
    }

    const fake = new FakeEmailProvider(
      () =>
        // A little latency widens the window for a double-claim to show up.
        ({ ok: true, provider_message_id: 'x' }),
    );
    setEmailProvider(fake);

    await Promise.all([processEmailQueue(), processEmailQueue(), processEmailQueue()]);

    expect(fake.sent).toHaveLength(5);
    const sentRows = await db.select().from(emails).where(eq(emails.status, EmailStatus.SENT));
    expect(sentRows).toHaveLength(5);
  });
});

describe('reclaimStuckSending', () => {
  it('returns a stranded SENDING row to PENDING', async () => {
    const lead = await makeLead();
    const rows = await db
      .insert(emails)
      .values({
        lead_id: lead.id,
        from_email: SENDER,
        to_email: 'a@b.com',
        subject: 's',
        body: 'b',
        status: EmailStatus.SENDING,
        idempotency_key: 'stuck-1',
        locked_at: new Date(Date.now() - 60 * 60 * 1000),
        locked_by: 'dead-worker',
      })
      .returning();

    const reclaimed = await reclaimStuckSending(10 * 60 * 1000);
    expect(reclaimed).toBe(1);
    const row = await getEmail(rows[0].id);
    expect(row.status).toBe(EmailStatus.PENDING);
    expect(row.locked_by).toBeNull();
  });

  it('leaves a freshly claimed row alone', async () => {
    const lead = await makeLead();
    await db.insert(emails).values({
      lead_id: lead.id,
      from_email: SENDER,
      to_email: 'a@b.com',
      subject: 's',
      body: 'b',
      status: EmailStatus.SENDING,
      idempotency_key: 'fresh-1',
      locked_at: new Date(),
      locked_by: 'live-worker',
    });
    expect(await reclaimStuckSending(10 * 60 * 1000)).toBe(0);
  });
});

describe('audit trail', () => {
  it('records queue and send activity against the lead', async () => {
    await makeSender();
    const lead = await makeLead();
    await queueOne({ lead });
    setEmailProvider(new FakeEmailProvider());
    await processEmailQueue();

    const rows = await db.select().from(activities).where(eq(activities.lead_id, lead.id));
    const types = rows.map((r) => r.activity_type);
    expect(types).toContain('EMAIL_QUEUED');
    expect(types).toContain('EMAIL_SENT');
  });

  it('records why an email was blocked', async () => {
    await makeSender();
    const lead = await makeLead({ email: 'x@shop.example' });
    await queueOne({ lead });
    await suppress('x@shop.example');
    setEmailProvider(new FakeEmailProvider());
    await processEmailQueue();

    const rows = await db.select().from(activities).where(eq(activities.lead_id, lead.id));
    const blocked = rows.find((r) => r.activity_type === 'EMAIL_BLOCKED');
    expect(blocked?.description).toContain('SUPPRESSED');
  });
});
