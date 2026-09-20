import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { leads, audits, audit_checks } from '@/db/schema';
import { ok, fail, notFound, withAuth } from '@/lib/api';
import { auditWebsite } from '@/lib/audit/auditor';
import { recordActivity, ActivityType, changeLeadStatus } from '@/lib/activity';
import { rescoreLead } from '@/lib/automation/jobs';

type Ctx = { params: Promise<{ id: string }> };

/** Audits a lead's website on demand and stores the result. */
export const POST = withAuth<Ctx>(async (_req, _user, ctx) => {
  const { id } = await ctx.params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) return fail(400, 'Invalid lead id.');

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  if (!lead) return notFound('Lead');
  if (!lead.website) return fail(400, 'This lead has no website to audit.');

  await recordActivity(leadId, ActivityType.AUDIT_STARTED, `Audit requested for ${lead.website}`);

  const result = await auditWebsite(lead.website, {
    business_name: lead.business_name,
    phone: lead.phone,
    city: lead.city,
    address: lead.address,
  });

  const inserted = await db
    .insert(audits)
    .values({
      lead_id: leadId,
      url: result.url,
      overall_status: result.overall_status,
      overall_score: result.overall_score,
      fetch_error: result.fetch_error,
    })
    .returning();

  await db.insert(audit_checks).values(
    result.checks.map((c) => ({
      audit_id: inserted[0].id,
      check_number: c.check_number,
      check_name: c.check_name,
      status: c.status,
      evidence: c.evidence,
      problem: c.problem,
      impact: c.impact,
      priority: c.priority,
      checked_at: c.checked_at,
    })),
  );

  if (result.fetch_error) {
    await recordActivity(leadId, ActivityType.AUDIT_FAILED, `Could not audit: ${result.fetch_error}`);
  } else {
    const failing = result.checks.filter((c) => c.status === 'FAIL').length;
    await recordActivity(leadId, ActivityType.AUDIT_COMPLETED, `Audit complete — ${failing} failing check(s)`);
    await changeLeadStatus(leadId, 'AUDITED', 'manual audit');
  }

  const score = await rescoreLead(leadId);
  return ok({ audit: inserted[0], checks: result.checks, score }, { status: 201 });
});
