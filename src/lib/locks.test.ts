import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { pool } from '@/db/client';
import {
  acquireLock,
  releaseLock,
  withLock,
  extendLock,
  clearExpiredLocks,
  backoffDelayMs,
  nextRetryAt,
} from './locks';
import { resetDatabase } from '@/test/helpers';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await pool.end();
});

describe('acquireLock', () => {
  it('grants a free lock', async () => {
    const lock = await acquireLock('job:test');
    expect(lock).not.toBeNull();
  });

  it('refuses a lock already held', async () => {
    const first = await acquireLock('job:test');
    expect(first).not.toBeNull();
    const second = await acquireLock('job:test');
    expect(second).toBeNull();
  });

  it('grants the lock again after release', async () => {
    const first = await acquireLock('job:test');
    await releaseLock(first!);
    const second = await acquireLock('job:test');
    expect(second).not.toBeNull();
  });

  it('lets a different key through', async () => {
    await acquireLock('job:a');
    expect(await acquireLock('job:b')).not.toBeNull();
  });

  it('steals a lock whose holder died, once it has expired', async () => {
    const first = await acquireLock('job:test', -1000);
    expect(first).not.toBeNull();
    const second = await acquireLock('job:test');
    expect(second).not.toBeNull();
    expect(second!.owner).not.toBe(first!.owner);
  });

  it('only ever grants one holder under concurrent attempts', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => acquireLock('job:race')),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('releaseLock', () => {
  it('will not release a lock that was already stolen', async () => {
    const stale = await acquireLock('job:test', -1000);
    const fresh = await acquireLock('job:test');
    // The previous owner tries to clean up after the lock moved on.
    await releaseLock(stale!);
    // The new holder still owns it.
    expect(await acquireLock('job:test')).toBeNull();
    await releaseLock(fresh!);
    expect(await acquireLock('job:test')).not.toBeNull();
  });
});

describe('withLock', () => {
  it('runs the body and releases afterwards', async () => {
    let ran = false;
    const result = await withLock('job:test', async () => {
      ran = true;
      return 'done';
    });
    expect(ran).toBe(true);
    expect(result).toBe('done');
    expect(await acquireLock('job:test')).not.toBeNull();
  });

  it('returns null without running when the lock is held', async () => {
    await acquireLock('job:test');
    let ran = false;
    const result = await withLock('job:test', async () => {
      ran = true;
      return 'done';
    });
    expect(ran).toBe(false);
    expect(result).toBeNull();
  });

  it('releases the lock even when the body throws', async () => {
    await expect(
      withLock('job:test', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await acquireLock('job:test')).not.toBeNull();
  });

  it('serialises overlapping runs so only one body executes', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const body = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 30));
      concurrent--;
      return true;
    };
    const results = await Promise.all([
      withLock('job:serial', body),
      withLock('job:serial', body),
      withLock('job:serial', body),
    ]);
    expect(maxConcurrent).toBe(1);
    expect(results.filter((r) => r === true)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(2);
  });
});

describe('extendLock', () => {
  it('extends a lock the caller owns', async () => {
    const lock = await acquireLock('job:test', 1000);
    expect(await extendLock(lock!, 60_000)).toBe(true);
  });

  it('will not extend a lock the caller no longer owns', async () => {
    const stale = await acquireLock('job:test', -1000);
    await acquireLock('job:test');
    expect(await extendLock(stale!, 60_000)).toBe(false);
  });
});

describe('clearExpiredLocks', () => {
  it('removes expired rows and leaves live ones', async () => {
    await acquireLock('job:expired', -1000);
    await acquireLock('job:live', 60_000);
    expect(await clearExpiredLocks()).toBe(1);
    expect(await acquireLock('job:live')).toBeNull();
  });
});

describe('backoff', () => {
  it('doubles each attempt', () => {
    expect(backoffDelayMs(1, 1000)).toBe(1000);
    expect(backoffDelayMs(2, 1000)).toBe(2000);
    expect(backoffDelayMs(3, 1000)).toBe(4000);
  });

  it('caps the delay', () => {
    expect(backoffDelayMs(30, 1000, 10_000)).toBe(10_000);
  });

  it('never returns a time in the past', () => {
    expect(nextRetryAt(1).getTime()).toBeGreaterThan(Date.now());
  });
});
