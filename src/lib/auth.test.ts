import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { sessions, users } from '@/db/schema';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  pruneExpiredSessions,
  createUser,
  findUserByEmail,
  countUsers,
} from './auth';
import { resetDatabase } from '@/test/helpers';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await pool.end();
});

describe('password hashing', () => {
  it('never stores the password itself', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
    expect(hash.startsWith('scrypt:')).toBe(true);
  });

  it('salts, so the same password hashes differently each time', async () => {
    const a = await hashPassword('same-password-here');
    const b = await hashPassword('same-password-here');
    expect(a).not.toBe(b);
  });

  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:onlytwo')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt:a:b')).toBe(false);
  });
});

describe('users', () => {
  it('stores the email lowercased and trimmed', async () => {
    const user = await createUser('  Owner@Example.COM ', 'a-long-enough-password');
    expect(user.email).toBe('owner@example.com');
  });

  it('finds a user case-insensitively', async () => {
    await createUser('owner@example.com', 'a-long-enough-password');
    expect(await findUserByEmail('OWNER@EXAMPLE.COM')).toBeTruthy();
  });

  it('refuses a duplicate email at the database level', async () => {
    await createUser('owner@example.com', 'a-long-enough-password');
    await expect(createUser('owner@example.com', 'another-password-x')).rejects.toThrow();
  });

  it('counts users, which is what gates first-run setup', async () => {
    expect(await countUsers()).toBe(0);
    await createUser('a@example.com', 'a-long-enough-password');
    expect(await countUsers()).toBe(1);
  });
});

describe('sessions', () => {
  it('issues an unguessable id with a future expiry', async () => {
    const user = await createUser('a@example.com', 'a-long-enough-password');
    const session = await createSession(user.id);
    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('destroys a session', async () => {
    const user = await createUser('a@example.com', 'a-long-enough-password');
    const session = await createSession(user.id);
    await destroySession(session.id);
    const rows = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(rows).toHaveLength(0);
  });

  it('prunes expired sessions and keeps live ones', async () => {
    const user = await createUser('a@example.com', 'a-long-enough-password');
    const live = await createSession(user.id);
    await db.insert(sessions).values({
      id: 'e'.repeat(64),
      user_id: user.id,
      expires_at: new Date(Date.now() - 1000),
    });

    expect(await pruneExpiredSessions()).toBe(1);
    const remaining = await db.select().from(sessions);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(live.id);
  });

  it('removes a user’s sessions when the user is deleted', async () => {
    const user = await createUser('a@example.com', 'a-long-enough-password');
    await createSession(user.id);
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});
