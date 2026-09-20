import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { campaigns } from '@/db/schema';

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');

    let query = db.query.campaigns.findMany();

    if (status) {
      const data = await db.query.campaigns.findMany();
      return NextResponse.json(data.filter(c => c.status === status));
    }

    const data = await query;
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, target_filter, email_account_id, daily_limit } = body;

    const result = await db
      .insert(campaigns)
      .values({
        name,
        description,
        target_filter,
        email_account_id,
        daily_limit,
        status: 'DRAFT',
      })
      .returning();

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('Error creating campaign:', error);
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }
}
