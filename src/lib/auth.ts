import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { cookies } from 'next/headers';
import { eq, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { users, sessions } from '@/db/schema';
import { authStatus } from '@/lib/config';

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'vg_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const KEYLEN = 64;

// ---------------------------------------------------------------------------
// Password hashing (scrypt, per-password random salt)
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt, KEYLEN);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createSession(userId: number): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, user_id: userId, expires_at: expiresAt });
  return { id, expiresAt };
}

export async function destroySession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Removes expired sessions. Safe to call repeatedly. */
export async function pruneExpiredSessions(): Promise<number> {
  const stale = await db.select({ id: sessions.id }).from(sessions).where(lt(sessions.expires_at, new Date()));
  if (stale.length === 0) return 0;
  await db.delete(sessions).where(lt(sessions.expires_at, new Date()));
  return stale.length;
}

export interface AuthUser {
  id: number;
  email: string;
  full_name: string | null;
  role: string;
}

/**
 * Resolves the signed-in user from the session cookie, or null.
 * An expired session is treated as absent and deleted.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  if (authStatus().status === 'NOT_CONFIGURED') return null;

  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const row = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    with: { user: true },
  });
  if (!row) return null;

  if (row.expires_at.getTime() < Date.now()) {
    await destroySession(sessionId);
    return null;
  }

  return {
    id: row.user.id,
    email: row.user.email,
    full_name: row.user.full_name,
    role: row.user.role,
  };
}

/** Throws a 401-shaped error when there is no valid session. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    const err = new Error('UNAUTHORIZED') as Error & { statusCode?: number };
    err.statusCode = 401;
    throw err;
  }
  return user;
}

export async function findUserByEmail(email: string) {
  return db.query.users.findFirst({ where: eq(users.email, email.toLowerCase().trim()) });
}

export async function createUser(email: string, password: string, fullName?: string) {
  const password_hash = await hashPassword(password);
  const rows = await db
    .insert(users)
    .values({
      email: email.toLowerCase().trim(),
      password_hash,
      full_name: fullName ?? null,
    })
    .returning();
  return rows[0];
}

export async function countUsers(): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.length;
}
