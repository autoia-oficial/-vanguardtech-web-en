import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { automations, automation_runs } from '@/db/schema';
import { desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');

    let query = db.query.automations.findMany({
      with: {
        automation_runs: {
          limit: 1,
          orderBy: desc(automation_runs.started_at),
        },
      },
    });

    const data = await query;

    if (status) {
      return NextResponse.json(data.filter(a => a.status === status));
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching automations:', error);
    return NextResponse.json({ error: 'Failed to fetch automations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, type, config } = body;

    const result = await db
      .insert(automations)
      .values({
        name,
        description,
        type,
        config,
        status: 'ACTIVE',
      })
      .returning();

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('Error creating automation:', error);
    return NextResponse.json({ error: 'Failed to create automation' }, { status: 500 });
  }
}
