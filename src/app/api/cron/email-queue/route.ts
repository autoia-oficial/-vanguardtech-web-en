import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { emails, email_accounts, errors, suppression_list, leads } from '@/db/schema';
import { eq, and, gte } from 'drizzle-orm';

// No email provider is wired up yet. Until one is, this job must never mark an
// email as SENT -- doing so would write a delivery record that never happened.
function emailProviderConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

export async function GET(request: NextRequest) {
  if (!isValidCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!emailProviderConfigured()) {
    return NextResponse.json({
      status: 'NOT_CONFIGURED',
      sent: 0,
      message:
        'No email provider configured. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD ' +
        '(or wire a transactional provider) before this job can send anything. ' +
        'Queued emails are left PENDING.',
    });
  }

  try {
    const pendingEmails = await db.query.emails.findMany({
      where: eq(emails.status, 'PENDING'),
      limit: 100,
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let processed = 0;
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const email of pendingEmails) {
      processed++;
      try {
        const account = await db.query.email_accounts.findFirst({
          where: eq(email_accounts.email, email.from_email),
        });

        if (!account || !account.is_active) {
          skipped++;
          await recordBlock(email.id, email.lead_id, 'SENDER_ACCOUNT_UNAVAILABLE');
          continue;
        }

        const suppressed = await db.query.suppression_list.findFirst({
          where: eq(suppression_list.email, email.to_email),
        });
        if (suppressed) {
          skipped++;
          await recordBlock(email.id, email.lead_id, 'RECIPIENT_SUPPRESSED');
          continue;
        }

        const lead = await db.query.leads.findFirst({ where: eq(leads.id, email.lead_id) });
        if (lead?.status === 'DO_NOT_CONTACT') {
          skipped++;
          await recordBlock(email.id, email.lead_id, 'LEAD_DO_NOT_CONTACT');
          continue;
        }

        const sentToday = await db.query.emails.findMany({
          where: and(
            eq(emails.from_email, email.from_email),
            eq(emails.status, 'SENT'),
            gte(emails.sent_at, startOfDay),
          ),
        });

        if (sentToday.length >= (account.daily_limit ?? 100)) {
          skipped++;
          await recordBlock(email.id, email.lead_id, 'DAILY_LIMIT_REACHED');
          continue;
        }

        // Reaching here means the email passed every gate and a configured
        // provider should deliver it. The provider call is not implemented yet,
        // so fail loudly rather than record a delivery that did not occur.
        throw new Error('Email provider transport not implemented');
      } catch (err) {
        failed++;
        await db.insert(errors).values({
          lead_id: email.lead_id,
          error_type: 'EMAIL_SEND_FAILED',
          message: err instanceof Error ? err.message : String(err),
          context: { email_id: email.id },
        });
      }
    }

    return NextResponse.json({ processed, sent, skipped, failed });
  } catch (error) {
    console.error('Error in email queue cron:', error);
    return NextResponse.json({ error: 'Failed to process email queue' }, { status: 500 });
  }
}

async function recordBlock(emailId: number, leadId: number, reason: string) {
  await db.insert(errors).values({
    lead_id: leadId,
    error_type: 'EMAIL_BLOCKED',
    message: reason,
    context: { email_id: emailId },
  });
}

function isValidCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
