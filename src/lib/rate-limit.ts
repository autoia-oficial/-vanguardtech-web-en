import { eq, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { login_attempts } from '@/db/schema';

/**
 * Throttles repeated sign-in failures.
 *
 * Counters live in the database, not in memory: serverless instances do not
 * share process state, so an in-memory counter would reset on every cold start
 * and provide no protection at all.
 *
 * The window is sliding — a burst of failures locks the identifier, and the
 * counter resets once the window elapses without a further failure.
 */

export const MAX_ATTEMPTS = 8;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

export interface RateLimitState {
  allowed: boolean;
  retryAfterSeconds?: number;
  attemptsRemaining?: number;
}

export async function checkLoginRate(identifier: string): Promise<RateLimitState> {
  const key = identifier.toLowerCase().trim().slice(0, 255);
  const row = await db.query.login_attempts.findFirst({
    where: eq(login_attempts.identifier, key),
  });
  if (!row) return { allowed: true, attemptsRemaining: MAX_ATTEMPTS };

  const now = Date.now();

  if (row.locked_until && row.locked_until.getTime() > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((row.locked_until.getTime() - now) / 1000),
    };
  }

  // The window has passed with no further failure, so the slate is clean.
  if (now - row.first_attempt_at.getTime() > WINDOW_MS) {
    await clearLoginAttempts(key);
    return { allowed: true, attemptsRemaining: MAX_ATTEMPTS };
  }

  return { allowed: true, attemptsRemaining: Math.max(0, MAX_ATTEMPTS - row.attempts) };
}

/** Records a failure and returns the state after it. */
export async function recordLoginFailure(identifier: string): Promise<RateLimitState> {
  const key = identifier.toLowerCase().trim().slice(0, 255);
  const now = new Date();

  const existing = await db.query.login_attempts.findFirst({
    where: eq(login_attempts.identifier, key),
  });

  const withinWindow =
    existing !== undefined && now.getTime() - existing.first_attempt_at.getTime() <= WINDOW_MS;

  const attempts = withinWindow ? existing.attempts + 1 : 1;
  const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS) : null;

  await db
    .insert(login_attempts)
    .values({
      identifier: key,
      attempts,
      first_attempt_at: withinWindow ? existing.first_attempt_at : now,
      locked_until: lockedUntil,
    })
    .onConflictDoUpdate({
      target: login_attempts.identifier,
      set: {
        attempts,
        first_attempt_at: withinWindow ? existing.first_attempt_at : now,
        locked_until: lockedUntil,
      },
    });

  if (lockedUntil) {
    return { allowed: false, retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000) };
  }
  return { allowed: true, attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attempts) };
}

export async function clearLoginAttempts(identifier: string): Promise<void> {
  await db
    .delete(login_attempts)
    .where(eq(login_attempts.identifier, identifier.toLowerCase().trim().slice(0, 255)));
}

/** Drops counters whose lockout has expired. Called by CRM maintenance. */
export async function pruneLoginAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - WINDOW_MS - LOCKOUT_MS);
  const rows = await db
    .delete(login_attempts)
    .where(lt(login_attempts.first_attempt_at, cutoff))
    .returning();
  return rows.length;
}
