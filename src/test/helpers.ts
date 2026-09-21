import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  leads,
  contacts,
  email_accounts,
  campaigns,
  emails,
  suppression_list,
  automations,
} from '@/db/schema';
import type { EmailProvider, SendResult, OutgoingEmail } from '@/lib/email/types';

/** Order matters only for readability; TRUNCATE ... CASCADE handles the graph. */
const TABLES = [
  'email_events',
  'emails',
  'follow_ups',
  'demos',
  'activities',
  'audit_checks',
  'audits',
  'campaign_leads',
  'campaigns',
  'contacts',
  'suppression_list',
  'email_accounts',
  'automation_runs',
  'automations',
  'errors',
  'job_locks',
  'sessions',
  'login_attempts',
  'users',
  'settings',
  'leads',
];

export async function resetDatabase(): Promise<void> {
  await db.execute(
    sql.raw(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`),
  );
}

export async function makeLead(overrides: Partial<typeof leads.$inferInsert> = {}) {
  const rows = await db
    .insert(leads)
    .values({
      business_name: overrides.business_name ?? 'Test Business',
      email: overrides.email ?? 'owner@testbusiness.example',
      ...overrides,
    })
    .returning();
  return rows[0];
}

export async function makeContact(leadId: number, overrides: Partial<typeof contacts.$inferInsert> = {}) {
  const rows = await db
    .insert(contacts)
    .values({
      lead_id: leadId,
      contact_email: overrides.contact_email ?? 'owner@testbusiness.example',
      ...overrides,
    })
    .returning();
  return rows[0];
}

export async function makeSender(overrides: Partial<typeof email_accounts.$inferInsert> = {}) {
  const rows = await db
    .insert(email_accounts)
    .values({
      email: overrides.email ?? 'sales@vanguard.example',
      name: 'Vanguard Sales',
      daily_limit: overrides.daily_limit ?? 100,
      hourly_limit: overrides.hourly_limit ?? 20,
      ...overrides,
    })
    .returning();
  return rows[0];
}

export async function makeCampaign(overrides: Partial<typeof campaigns.$inferInsert> = {}) {
  const rows = await db
    .insert(campaigns)
    .values({
      name: overrides.name ?? 'Test Campaign',
      status: overrides.status ?? 'ACTIVE',
      ...overrides,
    })
    .returning();
  return rows[0];
}

export async function makeAutomation(overrides: Partial<typeof automations.$inferInsert> = {}) {
  const rows = await db
    .insert(automations)
    .values({
      key: overrides.key ?? 'test-job',
      name: overrides.name ?? 'Test Job',
      ...overrides,
    })
    .returning();
  return rows[0];
}

export async function suppress(email: string, reason = 'test') {
  await db.insert(suppression_list).values({ email: email.toLowerCase(), reason });
}

export async function getEmail(id: number) {
  const rows = await db.select().from(emails).where(sql`${emails.id} = ${id}`);
  return rows[0];
}

/** Records every send and returns a scripted result. Never touches the network. */
export class FakeEmailProvider implements EmailProvider {
  readonly key = 'fake';
  readonly label = 'Fake provider (tests)';
  readonly sent: OutgoingEmail[] = [];

  constructor(private script: (email: OutgoingEmail, callIndex: number) => SendResult = () => ({
    ok: true,
    provider_message_id: 'fake-id',
  })) {}

  availability() {
    return { available: true as const };
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const index = this.sent.length;
    this.sent.push(email);
    return this.script(email, index);
  }
}

/** A provider that always reports itself unavailable. */
export class NotConfiguredProvider implements EmailProvider {
  readonly key = 'none';
  readonly label = 'Unconfigured (tests)';
  availability() {
    return { available: false as const, reason: 'NOT_CONFIGURED: test', missing: ['SMTP_HOST'] };
  }
  async send(): Promise<SendResult> {
    return { ok: false, error: 'not configured', retryable: false };
  }
}
