import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';

export async function GET(request: NextRequest) {
  if (!isValidCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allLeads = await db.query.leads.findMany();

    const duplicates: { [key: string]: number[] } = {};
    let processedDuplicates = 0;

    // Find duplicates by email and phone
    for (const lead of allLeads) {
      if (lead.email) {
        const key = `email:${lead.email.toLowerCase()}`;
        if (!duplicates[key]) duplicates[key] = [];
        duplicates[key].push(lead.id);
      }

      if (lead.phone) {
        const key = `phone:${lead.phone}`;
        if (!duplicates[key]) duplicates[key] = [];
        duplicates[key].push(lead.id);
      }

      if (lead.website) {
        const key = `website:${lead.website.toLowerCase()}`;
        if (!duplicates[key]) duplicates[key] = [];
        duplicates[key].push(lead.id);
      }
    }

    // Mark duplicates (keep the oldest, mark others as potential duplicates in notes)
    for (const [key, ids] of Object.entries(duplicates)) {
      if (ids.length > 1) {
        processedDuplicates += ids.length - 1;

        // Note: In production, implement merge logic
        console.log(`Duplicate detected: ${key} with ${ids.length} leads`);
      }
    }

    return NextResponse.json({
      status: 'success',
      message: 'Duplicate detection completed',
      duplicates_found: processedDuplicates,
      total_leads: allLeads.length,
    });
  } catch (error) {
    console.error('Error in duplicate detection cron:', error);
    return NextResponse.json(
      { error: 'Failed to process duplicate detection' },
      { status: 500 }
    );
  }
}

function isValidCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
