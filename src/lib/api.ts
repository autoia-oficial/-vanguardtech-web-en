import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { cronStatus } from '@/lib/config';

/** Shared helpers so every route enforces auth and shapes errors the same way. */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(status: number, error: string, detail?: unknown) {
  return NextResponse.json({ error, detail: detail ?? null }, { status });
}

export const unauthorized = () => fail(401, 'Not signed in.');
export const forbidden = () => fail(403, 'Not allowed.');
export const notFound = (what = 'Resource') => fail(404, `${what} not found.`);

/**
 * Wraps a route handler so it only runs for a signed-in user.
 * Everything under the CRM goes through this.
 */
export function withAuth<Ctx>(
  handler: (req: NextRequest, user: AuthUser, ctx: Ctx) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    let user: AuthUser | null = null;
    try {
      user = await getCurrentUser();
    } catch (err) {
      return toErrorResponse(err);
    }
    if (!user) return unauthorized();

    try {
      return await handler(req, user, ctx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/**
 * Wraps a cron route. Rejects when CRON_SECRET is unset — there is deliberately
 * no default secret, so an unconfigured deployment exposes nothing.
 */
export function withCronAuth(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest): Promise<Response> => {
    const status = cronStatus();
    if (status.status === 'NOT_CONFIGURED') {
      return fail(503, 'NOT_CONFIGURED', {
        missing: status.missing,
        detail: status.detail,
      });
    }

    const expected = `Bearer ${process.env.CRON_SECRET}`;
    const provided = req.headers.get('authorization');
    // Vercel Cron sends this header on scheduled invocations.
    if (provided !== expected) return unauthorized();

    try {
      return await handler(req);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/**
 * Turns a thrown error into a response.
 *
 * A missing table (Postgres 42P01) means the database is behind the code —
 * almost always a migration that was never applied after a pull. Saying so is
 * far more use than a bare 500, which is what this looked like the first time
 * it happened.
 */
/** Walks the cause chain collecting every code and message it finds. */
function unwrap(err: unknown): { codes: string[]; messages: string[] } {
  const codes: string[] = [];
  const messages: string[] = [];
  let node: unknown = err;

  // Drizzle wraps driver errors, and the depth varies by call path, so follow
  // the chain rather than guessing how many levels down the code sits.
  for (let depth = 0; node && depth < 8; depth++) {
    const o = node as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof o.code === 'string') codes.push(o.code);
    if (typeof o.message === 'string') messages.push(o.message);
    node = o.cause;
  }
  return { codes, messages };
}

export function toErrorResponse(err: unknown) {
  const { codes, messages } = unwrap(err);
  const text = messages.join(' | ');

  const missingRelation =
    codes.includes('42P01') ||
    // Postgres phrases it this way; match it in case the code is not exposed.
    /relation ".*" does not exist/i.test(text) ||
    /relation .* does not exist/i.test(text);

  if (missingRelation) {
    return fail(500, 'The database schema is out of date. Run: npm run db:migrate', {
      hint: 'A table the code expects does not exist in this database yet.',
      detail: messages[0] ?? String(err),
    });
  }

  const missingColumn = codes.includes('42703') || /column .* does not exist/i.test(text);
  if (missingColumn) {
    return fail(500, 'The database schema is out of date. Run: npm run db:migrate', {
      hint: 'A column the code expects does not exist in this database yet.',
      detail: messages[0] ?? String(err),
    });
  }

  if (codes.includes('ECONNREFUSED') || codes.includes('57P03') || /ECONNREFUSED/.test(text)) {
    return fail(503, 'The database is not reachable. Check DATABASE_URL and that PostgreSQL is running.', {
      detail: messages[0] ?? String(err),
    });
  }

  return fail(500, messages[0] ?? String(err));
}

export async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function intParam(value: string | null, fallback: number, max?: number): number {
  // Number(null) and Number('') are both 0, which would silently become a
  // limit of zero and return no rows. An absent or blank parameter must use
  // the fallback instead.
  if (value === null || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < 0) return fallback;
  return max !== undefined ? Math.min(i, max) : i;
}
