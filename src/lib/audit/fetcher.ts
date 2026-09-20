import { checkHostname } from './ssrf';

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
const MAX_REDIRECTS = 5;

export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A scheme that is already present must be http(s); file:, data: and
  // javascript: are never a customer's website. Only a bare host gets https
  // prepended — doing that unconditionally would turn "file:///etc/passwd"
  // into a URL whose protocol check then trivially passes.
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !/^https?$/i.test(scheme[1])) return null;

  const withScheme = scheme ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.hostname.length === 0) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Fetches a page, following redirects one hop at a time so every destination
 * is checked before it is requested. A redirect to an internal address is
 * refused just as a direct request to one would be.
 */
export async function fetchPage(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchOutcome> {
  const normalized = normalizeUrl(url);
  if (!normalized) return { ok: false, failure: { error: `Not a usable URL: ${url}` } };

  const started = Date.now();
  let current = normalized;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);

    const hostCheck = await checkHostname(parsed.hostname);
    if (!hostCheck.allowed) {
      return { ok: false, failure: { error: `Refused for safety: ${hostCheck.reason}` } };
    }

    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) {
      return { ok: false, failure: { error: `Timed out after ${timeoutMs}ms` } };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);

    try {
      const res = await fetch(current, {
        // Redirects are followed by hand so each hop can be validated.
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return { ok: false, failure: { error: `Redirect ${res.status} with no Location header` } };
        }
        const next = normalizeUrl(new URL(location, current).toString());
        if (!next) {
          return { ok: false, failure: { error: `Redirect to an unusable URL: ${location}` } };
        }
        current = next;
        continue;
      }

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
          finalUrl: current,
          html: text.slice(0, MAX_BYTES),
          status: res.status,
          elapsedMs,
          bytes: Buffer.byteLength(text, 'utf8'),
          headers,
          https: current.startsWith('https://'),
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

  return { ok: false, failure: { error: `More than ${MAX_REDIRECTS} redirects` } };
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
  const parsed = new URL(httpUrl);
  const hostCheck = await checkHostname(parsed.hostname);
  if (!hostCheck.allowed) return { reachable: false, redirectsToHttps: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(httpUrl, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      const target = location ? new URL(location, httpUrl).toString() : '';
      return { reachable: true, redirectsToHttps: target.startsWith('https://') };
    }
    return { reachable: true, redirectsToHttps: false };
  } catch {
    return { reachable: false, redirectsToHttps: false };
  } finally {
    clearTimeout(timer);
  }
}
