import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { emails, suppression_list } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const lead_id = request.nextUrl.searchParams.get('lead_id');
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20');

    const data = await db.query.emails.findMany({
      ...(lead_id && {
        where: eq(emails.lead_id, parseInt(lead_id)),
      }),
      limit,
      orderBy: [desc(emails.created_at)],
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to_email, subject, body: content, lead_id, contact_id, campaign_id, from_email } = body;

    // Check suppression list
    const suppressed = await db.query.suppression_list.findFirst({
      where: eq(suppression_list.email, to_email),
    });

    if (suppressed) {
      return NextResponse.json(
        { error: 'Email is in suppression list' },
        { status: 400 }
      );
    }

    const result = await db
      .insert(emails)
      .values({
        lead_id,
        contact_id,
        campaign_id,
        from_email,
        to_email,
        subject,
        body: content,
        status: 'PENDING',
      })
      .returning();

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('Error creating email:', error);
    return NextResponse.json({ error: 'Failed to create email' }, { status: 500 });
  }
}
