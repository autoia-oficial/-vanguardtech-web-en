import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { ok, fail, readJson, toErrorResponse } from '@/lib/api';
import { authStatus } from '@/lib/config';
import { countUsers, createUser, createSession, SESSION_COOKIE } from '@/lib/auth';

/**
 * Creates the first administrator. Only works while no user exists, so the
 * endpoint closes itself permanently after initial setup.
 */
export async function POST(req: NextRequest) {
  try {
    return await createFirstUser(req);
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function createFirstUser(req: NextRequest) {
  const status = authStatus();
  if (status.status === 'NOT_CONFIGURED') {
    return fail(503, 'NOT_CONFIGURED', { missing: status.missing, detail: status.detail });
  }

  if ((await countUsers()) > 0) {
    return fail(409, 'Setup has already been completed.');
  }

  const body = await readJson<{ email?: string; password?: string; full_name?: string }>(req);
  if (!body?.email || !body?.password) return fail(400, 'Email and password are required.');
  if (body.password.length < 12) {
    return fail(400, 'Password must be at least 12 characters.');
  }

  const user = await createUser(body.email, body.password, body.full_name);
  const session = await createSession(user.id);
  const store = await cookies();
  store.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: session.expiresAt,
  });

  return ok({ id: user.id, email: user.email }, { status: 201 });
}
