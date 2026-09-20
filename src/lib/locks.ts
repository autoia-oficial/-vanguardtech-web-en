import { randomBytes } from 'crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { job_locks } from '@/db/schema';

/**
 * Cooperative job locks.
 *
 * Acquisition is a single atomic INSERT ... ON CONFLICT DO UPDATE that only
 * succeeds when the existing row is expired, so two concurrent cron
 * invocations can never both hold the same key. `expires_at` acts as a
 * dead-man switch: a worker killed mid-run (a serverless timeout) does not
 * strand the lock forever.
 */

export const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

export interface AcquiredLock {
  key: string;
  owner: string;
}

export async function acquireLock(
  key: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
): Promise<AcquiredLock | null> {
  const owner = randomBytes(16).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const rows = await db
    .insert(job_locks)
    .values({ key, owner, acquired_at: now, expires_at: expiresAt })
    .onConflictDoUpdate({
      target: job_locks.key,
      set: { owner, acquired_at: now, expires_at: expiresAt },
      // Only steal the lock if the incumbent has expired.
      where: lt(job_locks.expires_at, now),
    })
    .returning();

  if (rows.length === 0) return null;
  return { key, owner };
}

export async function releaseLock(lock: AcquiredLock): Promise<void> {
  // Owner check prevents releasing a lock that was already stolen after expiry.
  await db
    .delete(job_locks)
    .where(and(eq(job_locks.key, lock.key), eq(job_locks.owner, lock.owner)));
}

export async function extendLock(lock: AcquiredLock, ttlMs: number): Promise<boolean> {
  const rows = await db
    .update(job_locks)
    .set({ expires_at: new Date(Date.now() + ttlMs) })
    .where(and(eq(job_locks.key, lock.key), eq(job_locks.owner, lock.owner)))
    .returning();
  return rows.length > 0;
}

/**
 * Runs `fn` while holding `key`. Returns null without running when the lock is
 * already held elsewhere. The lock is always released, including on throw.
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
): Promise<T | null> {
  const lock = await acquireLock(key, ttlMs);
  if (!lock) return null;
  try {
    return await fn();
  } finally {
    await releaseLock(lock);
  }
}

export async function clearExpiredLocks(): Promise<number> {
  const rows = await db.delete(job_locks).where(lt(job_locks.expires_at, new Date())).returning();
  return rows.length;
}

/** Exponential backoff with a cap, used for retryable failures. */
export function backoffDelayMs(attempt: number, baseMs = 60_000, capMs = 6 * 60 * 60 * 1000): number {
  const raw = baseMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(raw, capMs);
}

export function nextRetryAt(attempt: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + backoffDelayMs(attempt));
}

export const _sql = sql;
