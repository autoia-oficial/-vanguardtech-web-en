import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { leads } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const id = parseInt(params.id);

    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, id),
      with: {
        audits: true,
        contacts: true,
        emails: true,
        activities: true,
      },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json(lead);
  } catch (error) {
    console.error('Error fetching lead:', error);
    return NextResponse.json({ error: 'Failed to fetch lead' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const id = parseInt(params.id);
    const body = await req.json();

    const result = await db
      .update(leads)
      .set({
        ...body,
        updated_at: new Date(),
      })
      .where(eq(leads.id, id))
      .returning();

    if (!result.length) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error('Error updating lead:', error);
    return NextResponse.json({ error: 'Failed to update lead' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const id = parseInt(params.id);

    await db.delete(leads).where(eq(leads.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting lead:', error);
    return NextResponse.json({ error: 'Failed to delete lead' }, { status: 500 });
  }
}
