import { ok, fail, withAuth, readJson } from '@/lib/api';
import { changeLeadStatus, isPipelineStage } from '@/lib/activity';

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (req, _user, ctx) => {
  const { id } = await ctx.params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) return fail(400, 'Invalid lead id.');

  const body = await readJson<{ status?: string; reason?: string }>(req);
  if (!body?.status) return fail(400, 'status is required.');
  if (!isPipelineStage(body.status)) return fail(400, `Unknown pipeline stage "${body.status}".`);

  const changed = await changeLeadStatus(leadId, body.status, body.reason);
  return ok({ changed, status: body.status });
});
