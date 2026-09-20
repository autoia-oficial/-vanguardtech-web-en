import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { leads, emails, errors } from '@/db/schema';
import { eq, gte } from 'drizzle-orm';

export async function GET() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all leads
    const allLeads = (await db.select({ status: leads.status, priority: leads.priority }).from(leads)) as any[];

    const stats = {
      total_leads: allLeads.length,
      new_leads: allLeads.filter(l => l.status === 'NEW').length,
      audited: allLeads.filter(l => l.status === 'AUDITED').length,
      priority_leads: allLeads.filter(l => l.priority === 'critical' || l.priority === 'high').length,
      contacted: allLeads.filter(l => ['CONTACTED', 'REPLIED', 'DEMO_SENT', 'INTERESTED', 'MEETING', 'ACCEPTED', 'PAID', 'PROJECT', 'LIVE'].includes(l.status)).length,
      replies: allLeads.filter(l => ['REPLIED', 'DEMO_SENT', 'INTERESTED', 'MEETING', 'ACCEPTED', 'PAID', 'PROJECT', 'LIVE'].includes(l.status)).length,
      demos: allLeads.filter(l => l.status === 'DEMO_SENT' || l.status === 'INTERESTED').length,
      meetings: allLeads.filter(l => l.status === 'MEETING').length,
      accepted: allLeads.filter(l => l.status === 'ACCEPTED').length,
      paid: allLeads.filter(l => l.status === 'PAID').length,
      live: allLeads.filter(l => l.status === 'LIVE').length,
      emails_today: 0,
      follow_ups_today: 0,
      automation_errors: 0,
    };

    // Get emails sent today
    const emailsToday = await db.query.emails.findMany({
      where: gte(emails.sent_at, today),
    });
    stats.emails_today = emailsToday.length;

    // Get automation errors
    const recentErrors = await db.query.errors.findMany({
      where: eq(errors.resolved, false),
    });
    stats.automation_errors = recentErrors.length;

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
