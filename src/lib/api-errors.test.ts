import { describe, it, expect } from 'vitest';
import { toErrorResponse } from './api';

async function body(res: Response) {
  return (await res.json()) as { error: string; detail: unknown };
}

/**
 * The shapes below are the ones actually seen in the wild: the Postgres code
 * sits at a different depth depending on how the query was issued, and in some
 * paths it is not exposed at all and only the message says what happened.
 */
describe('toErrorResponse — a table that does not exist', () => {
  const expectMigrationHint = async (err: unknown) => {
    const res = toErrorResponse(err);
    expect(res.status).toBe(500);
    expect((await body(res)).error).toContain('npm run db:migrate');
  };

  it('detects the code on the error itself', async () => {
    await expectMigrationHint(Object.assign(new Error('boom'), { code: '42P01' }));
  });

  it('detects the code one level down, where Drizzle puts it', async () => {
    const cause = Object.assign(new Error('relation "login_attempts" does not exist'), {
      code: '42P01',
    });
    await expectMigrationHint(Object.assign(new Error('Failed query: select …'), { cause }));
  });

  it('detects the code several levels down', async () => {
    const root = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    const mid = Object.assign(new Error('driver error'), { cause: root });
    await expectMigrationHint(Object.assign(new Error('Failed query: select …'), { cause: mid }));
  });

  it('falls back to the message when no code is exposed anywhere', async () => {
    const cause = new Error('relation "login_attempts" does not exist');
    await expectMigrationHint(Object.assign(new Error('Failed query: select …'), { cause }));
  });

  it('keeps the original message as the detail', async () => {
    const err = Object.assign(new Error('Failed query: select "identifier" …'), {
      cause: Object.assign(new Error('nope'), { code: '42P01' }),
    });
    const parsed = await body(toErrorResponse(err));
    expect(JSON.stringify(parsed.detail)).toContain('Failed query');
  });
});

describe('toErrorResponse — a column that does not exist', () => {
  it('points at migrations too', async () => {
    const err = Object.assign(new Error('Failed query'), {
      cause: Object.assign(new Error('column "sequence_step" does not exist'), { code: '42703' }),
    });
    expect((await body(toErrorResponse(err))).error).toContain('npm run db:migrate');
  });
});

describe('toErrorResponse — database unreachable', () => {
  it('answers 503 naming DATABASE_URL', async () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    const res = toErrorResponse(err);
    expect(res.status).toBe(503);
    expect((await body(res)).error).toContain('DATABASE_URL');
  });
});

describe('toErrorResponse — anything else', () => {
  it('passes the message through as a 500', async () => {
    const res = toErrorResponse(new Error('something else broke'));
    expect(res.status).toBe(500);
    expect((await body(res)).error).toBe('something else broke');
  });

  it('survives a thrown non-error', async () => {
    const res = toErrorResponse('just a string');
    expect(res.status).toBe(500);
    expect((await body(res)).error).toBe('just a string');
  });

  it('does not loop forever on a self-referencing cause', async () => {
    const err = new Error('loop') as Error & { cause?: unknown };
    err.cause = err;
    expect(toErrorResponse(err).status).toBe(500);
  });
});
