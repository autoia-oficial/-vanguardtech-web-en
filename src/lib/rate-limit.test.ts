import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { login_attempts } from '@/db/schema';
import {
  checkLoginRate,
  recordLoginFailure,
  clearLoginAttempts,
  pruneLoginAttempts,
  MAX_ATTEMPTS,
  WINDOW_MS,
  LOCKOUT_MS,
} from './rate-limit';
import { resetDatabase } from '@/test/helpers';

const USER = 'attacker@example.com';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await pool.end();
});

describe('checkLoginRate', () => {
  it('allows a first attempt', async () => {
    const state = await checkLoginRate(USER);
    expect(state.allowed).toBe(true);
    expect(state.attemptsRemaining).toBe(MAX_ATTEMPTS);
  });

  it('is case-insensitive about the identifier', async () => {
    await recordLoginFailure(USER);
    const state = await checkLoginRate('ATTACKER@EXAMPLE.COM');
    expect(state.attemptsRemaining).toBe(MAX_ATTEMPTS - 1);
  });
});

describe('recordLoginFailure', () => {
  it('counts down the remaining attempts', async () => {
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const state = await recordLoginFailure(USER);
      expect(state.allowed).toBe(true);
      expect(state.attemptsRemaining).toBe(MAX_ATTEMPTS - i);
    }
  });

  it('locks the identifier once the limit is reached', async () => {
    let state = { allowed: true } as Awaited<ReturnType<typeof recordLoginFailure>>;
    for (let i = 0; i < MAX_ATTEMPTS; i++) state = await recordLoginFailure(USER);

    expect(state.allowed).toBe(false);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);

    const check = await checkLoginRate(USER);
    expect(check.allowed).toBe(false);
    expect(check.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('locks one identifier without affecting another', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordLoginFailure(USER);
    expect((await checkLoginRate(USER)).allowed).toBe(false);
    expect((await checkLoginRate('someone.else@example.com')).allowed).toBe(true);
  });

  it('keeps the window anchored to the first failure in the burst', async () => {
    await recordLoginFailure(USER);
    const first = await db.query.login_attempts.findFirst({
      where: eq(login_attempts.identifier, USER),
    });
    await recordLoginFailure(USER);
    const second = await db.query.login_attempts.findFirst({
      where: eq(login_attempts.identifier, USER),
    });
    expect(second!.first_attempt_at.getTime()).toBe(first!.first_attempt_at.getTime());
    expect(second!.attempts).toBe(2);
  });
});

describe('window expiry', () => {
  it('forgives failures once the window has passed', async () => {
    await recordLoginFailure(USER);
    await recordLoginFailure(USER);

    // Backdate the burst beyond the window.
    await db
      .update(login_attempts)
      .set({ first_attempt_at: new Date(Date.now() - WINDOW_MS - 1000) })
      .where(eq(login_attempts.identifier, USER));

    const state = await checkLoginRate(USER);
    expect(state.allowed).toBe(true);
    expect(state.attemptsRemaining).toBe(MAX_ATTEMPTS);
  });

  it('allows sign-in again once the lockout expires', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordLoginFailure(USER);
    expect((await checkLoginRate(USER)).allowed).toBe(false);

    await db
      .update(login_attempts)
      .set({
        locked_until: new Date(Date.now() - 1000),
        first_attempt_at: new Date(Date.now() - WINDOW_MS - 1000),
      })
      .where(eq(login_attempts.identifier, USER));

    expect((await checkLoginRate(USER)).allowed).toBe(true);
  });
});

describe('clearLoginAttempts', () => {
  it('wipes the counter after a successful sign-in', async () => {
    await recordLoginFailure(USER);
    await recordLoginFailure(USER);
    await clearLoginAttempts(USER);
    expect(await db.select().from(login_attempts)).toHaveLength(0);
    expect((await checkLoginRate(USER)).attemptsRemaining).toBe(MAX_ATTEMPTS);
  });
});

describe('pruneLoginAttempts', () => {
  it('removes stale counters and keeps live ones', async () => {
    await recordLoginFailure('old@example.com');
    await db
      .update(login_attempts)
      .set({ first_attempt_at: new Date(Date.now() - WINDOW_MS - LOCKOUT_MS - 60_000) })
      .where(eq(login_attempts.identifier, 'old@example.com'));

    await recordLoginFailure('recent@example.com');

    expect(await pruneLoginAttempts()).toBe(1);
    const remaining = await db.select().from(login_attempts);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].identifier).toBe('recent@example.com');
  });
});
