import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { audits, audit_checks } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { calculateAuditScore, getOverallAuditStatus } from '@/lib/scoring';

export async function GET(request: NextRequest) {
  try {
    const lead_id = request.nextUrl.searchParams.get('lead_id');

    let query = db.query.audits.findMany({
      with: { checks: true },
    });

    if (lead_id) {
      const data = await db.query.audits.findFirst({
        where: eq(audits.lead_id, parseInt(lead_id)),
        with: { checks: true },
      });
      return NextResponse.json(data || {});
    }

    const data = await query;
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching audits:', error);
    return NextResponse.json({ error: 'Failed to fetch audits' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lead_id, checks } = body;

    // Create audit
    const audit = await db
      .insert(audits)
      .values({
        lead_id,
        overall_status: 'NOT_VERIFIED',
        overall_score: 0,
      })
      .returning();

    // Create checks
    if (checks && checks.length > 0) {
      await db.insert(audit_checks).values(
        checks.map((check: any, index: number) => ({
          audit_id: audit[0].id,
          check_number: index + 1,
          ...check,
        }))
      );
    }

    // Update audit with calculated score
    const allChecks = await db.query.audit_checks.findMany({
      where: eq(audit_checks.audit_id, audit[0].id),
    });

    const score = calculateAuditScore(allChecks as any);
    const status = getOverallAuditStatus(allChecks as any);

    const updated = await db
      .update(audits)
      .set({ overall_score: score, overall_status: status })
      .where(eq(audits.id, audit[0].id))
      .returning();

    return NextResponse.json(updated[0], { status: 201 });
  } catch (error) {
    console.error('Error creating audit:', error);
    return NextResponse.json({ error: 'Failed to create audit' }, { status: 500 });
  }
}
