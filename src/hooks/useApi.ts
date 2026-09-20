'use client';

import { useCallback, useEffect, useState } from 'react';

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Minimal fetch hook: load on mount, expose a reload for after mutations. */
export function useApi<T>(url: string | null): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setState({ data: null, error: body?.error ?? `Request failed (${res.status})`, loading: false });
          return;
        }
        setState({ data: body as T, error: null, loading: false });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ data: null, error: err instanceof Error ? err.message : 'Network error', loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  return { ...state, reload };
}

export async function mutate(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<{ ok: boolean; data: unknown; error: string | null }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, data, error: res.ok ? null : ((data as { error?: string })?.error ?? `Failed (${res.status})`) };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : 'Network error' };
  }
}
