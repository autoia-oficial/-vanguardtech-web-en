import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { follow_ups, leads, activities } from '@/db/schema';
import { eq, and, lte } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  if (!isValidCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();

    // Get due follow-ups
    const dueFollowUps = await db.query.follow_ups.findMany({
      where: and(
        eq(follow_ups.status, 'PENDING'),
        lte(follow_ups.scheduled_at, now),
      ),
    });

    let processed = 0;
    let success = 0;

    for (const followUp of dueFollowUps) {
      try {
        // Check if lead is in DO_NOT_CONTACT status
        const lead = await db.query.leads.findFirst({
          where: eq(leads.id, followUp.lead_id),
        });

        if (lead && lead.status === 'DO_NOT_CONTACT') {
          // Cancel follow-up
          await db
            .update(follow_ups)
            .set({ status: 'CANCELLED' })
            .where(eq(follow_ups.id, followUp.id));
          processed++;
          continue;
        }

        // Mark as sent
        await db
          .update(follow_ups)
          .set({
            status: 'SENT',
            sent_at: new Date(),
          })
          .where(eq(follow_ups.id, followUp.id));

        // Create activity
        await db.insert(activities).values({
          lead_id: followUp.lead_id,
          activity_type: 'FOLLOW_UP_SENT',
          description: `Follow-up email sent (Sequence: ${followUp.sequence_number})`,
          created_at: new Date(),
        });

        success++;
      } catch (error) {
        console.error(`Error processing follow-up ${followUp.id}:`, error);
      }

      processed++;
    }

    return NextResponse.json({
      processed,
      success,
      message: 'Follow-ups processed',
    });
  } catch (error) {
    console.error('Error in follow-ups cron:', error);
    return NextResponse.json(
      { error: 'Failed to process follow-ups' },
      { status: 500 }
    );
  }
}

function isValidCronRequest(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET || 'default-secret'}`;
}
