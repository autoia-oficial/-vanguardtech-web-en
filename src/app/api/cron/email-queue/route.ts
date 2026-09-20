import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { emails, email_accounts, activities } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  if (!isValidCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all pending emails
    const pendingEmails = await db.query.emails.findMany({
      where: eq(emails.status, 'PENDING'),
      limit: 100,
    });

    let processed = 0;
    let success = 0;
    let errors = 0;

    for (const email of pendingEmails) {
      try {
        // Check daily limit
        const emailAccount = await db.query.email_accounts.findFirst({
          where: eq(email_accounts.email, email.from_email),
        });

        if (!emailAccount || !emailAccount.is_active) {
          errors++;
          continue;
        }

        // Get today's email count from this account
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sentToday = await db.query.emails.findMany({
          where: and(
            eq(emails.from_email, email.from_email),
            eq(emails.status, 'SENT'),
          ),
        });

        const dailyLimit = emailAccount.daily_limit || 100;
        if (sentToday.length >= dailyLimit) {
          continue;
        }

        // Simulate email sending (in real implementation, integrate with SMTP or email service)
        await db
          .update(emails)
          .set({
            status: 'SENT',
            sent_at: new Date(),
          })
          .where(eq(emails.id, email.id));

        // Create activity log
        await db.insert(activities).values({
          lead_id: email.lead_id,
          activity_type: 'EMAIL_SENT',
          description: `Email sent: "${email.subject}"`,
          created_at: new Date(),
        });

        success++;
      } catch (error) {
        errors++;
        console.error(`Error sending email ${email.id}:`, error);
      }

      processed++;
    }

    return NextResponse.json({
      processed,
      success,
      errors,
      message: 'Email queue processed',
    });
  } catch (error) {
    console.error('Error in email queue cron:', error);
    return NextResponse.json(
      { error: 'Failed to process email queue' },
      { status: 500 }
    );
  }
}

function isValidCronRequest(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET || 'default-secret'}`;
}
