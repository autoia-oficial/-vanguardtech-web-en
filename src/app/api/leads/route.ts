import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { leads } from '@/db/schema';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Simple implementation - get all and filter in memory
    const allLeads = await db.query.leads.findMany({
      limit: 1000,
    });

    let filtered = allLeads;

    // Apply filters in memory
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');

    if (status) {
      filtered = filtered.filter(l => l.status === status);
    }
    if (priority) {
      filtered = filtered.filter(l => l.priority === priority);
    }

    // Apply pagination
    const data = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      data,
      pagination: { limit, offset, total: filtered.length },
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_name, category, city, province, email, phone, website, source } = body;

    const result = await db.insert(leads).values({
      business_name,
      category,
      city,
      province,
      email,
      phone,
      website,
      source,
      status: 'NEW',
      priority: 'medium',
      score: 0,
    }).returning();

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('Error creating lead:', error);
    return NextResponse.json({ error: 'Failed to create lead' }, { status: 500 });
  }
}
