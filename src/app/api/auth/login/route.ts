import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { ok, fail, readJson } from '@/lib/api';
import { authStatus } from '@/lib/config';
import { findUserByEmail, verifyPassword, createSession, SESSION_COOKIE } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const status = authStatus();
  if (status.status === 'NOT_CONFIGURED') {
    return fail(503, 'NOT_CONFIGURED', { missing: status.missing, detail: status.detail });
  }

  const body = await readJson<{ email?: string; password?: string }>(req);
  if (!body?.email || !body?.password) {
    return fail(400, 'Email and password are required.');
  }

  const user = await findUserByEmail(body.email);
  // Same response whether the account is unknown or the password is wrong, so
  // the endpoint cannot be used to enumerate accounts.
  const invalid = () => fail(401, 'Incorrect email or password.');
  if (!user) {
    // Still spend the hashing time so timing does not reveal existence.
    await verifyPassword(body.password, 'scrypt:00:00');
    return invalid();
  }

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) return invalid();

  const session = await createSession(user.id);
  const store = await cookies();
  store.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: session.expiresAt,
  });

  return ok({ id: user.id, email: user.email, full_name: user.full_name, role: user.role });
}
