import { ok } from '@/lib/api';
import { getCurrentUser, countUsers } from '@/lib/auth';
import { authStatus } from '@/lib/config';

export async function GET() {
  const status = authStatus();
  if (status.status === 'NOT_CONFIGURED') {
    return ok({ user: null, configured: false, needs_setup: false, missing: status.missing });
  }
  const user = await getCurrentUser();
  return ok({ user, configured: true, needs_setup: (await countUsers()) === 0 });
}
