export interface FetchedPage {
  finalUrl: string;
  html: string;
  status: number;
  /** Milliseconds from request start to response body fully read. */
  elapsedMs: number;
  bytes: number;
  headers: Record<string, string>;
  /** True when the URL was reached over TLS after following redirects. */
  https: boolean;
}

export interface FetchFailure {
  error: string;
}

export type FetchOutcome = { ok: true; page: FetchedPage } | { ok: false; failure: FetchFailure };

const USER_AGENT = 'VanguardCRM-Auditor/1.0 (+https://vanguardtech.example/audit-bot)';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BYTES = 3 * 1024 * 1024;

export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.hostname.length === 0 || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function fetchPage(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchOutcome> {
  const normalized = normalizeUrl(url);
  if (!normalized) return { ok: false, failure: { error: `Not a usable URL: ${url}` } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(normalized, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    });

    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    const elapsedMs = Date.now() - started;

    if (!contentType.includes('html') && text.trim().length > 0 && !text.trimStart().startsWith('<')) {
      return {
        ok: false,
        failure: { error: `Response was not HTML (content-type: ${contentType || 'unknown'})` },
      };
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    return {
      ok: true,
      page: {
        finalUrl: res.url || normalized,
        html: text.slice(0, MAX_BYTES),
        status: res.status,
        elapsedMs,
        bytes: Buffer.byteLength(text, 'utf8'),
        headers,
        https: (res.url || normalized).startsWith('https://'),
      },
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `Timed out after ${timeoutMs}ms`
          : err.message
        : String(err);
    return { ok: false, failure: { error: message } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks whether the plain-http origin is reachable and whether it upgrades to
 * https. Used by the HTTPS check to tell "no TLS at all" from "TLS enforced".
 */
export async function probeHttp(url: string, timeoutMs = 10_000): Promise<{
  reachable: boolean;
  redirectsToHttps: boolean;
}> {
  const normalized = normalizeUrl(url);
  if (!normalized) return { reachable: false, redirectsToHttps: false };
  const httpUrl = normalized.replace(/^https:\/\//i, 'http://');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(httpUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    });
    return { reachable: true, redirectsToHttps: res.url.startsWith('https://') };
  } catch {
    return { reachable: false, redirectsToHttps: false };
  } finally {
    clearTimeout(timer);
  }
}
