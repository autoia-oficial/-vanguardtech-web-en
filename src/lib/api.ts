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
      return fail(500, 'Could not verify the session.', String(err));
    }
    if (!user) return unauthorized();

    try {
      return await handler(req, user, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(500, message);
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
      const message = err instanceof Error ? err.message : String(err);
      return fail(500, message);
    }
  };
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
