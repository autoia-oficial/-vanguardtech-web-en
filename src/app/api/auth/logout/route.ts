import { cookies } from 'next/headers';
import { ok } from '@/lib/api';
import { destroySession, SESSION_COOKIE } from '@/lib/auth';

export async function POST() {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) await destroySession(id);
  store.delete(SESSION_COOKIE);
  return ok({ signed_out: true });
}
