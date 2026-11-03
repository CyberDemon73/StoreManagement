'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  /** True on the very first load (show skeletons); later refetches keep data visible. */
  initial: boolean;
  refetch: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T | undefined)) => void;
}

/**
 * Minimal data hook: runs `fn` when `deps` change, exposes loading / error / data and a
 * refetch. Cancels stale responses. Swap for TanStack Query later without touching screens.
 */
export function useApi<T>(fn: () => Promise<T>, deps: readonly unknown[], opts: { enabled?: boolean } = {}): ApiState<T> {
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(enabled);
  const [initial, setInitial] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(undefined);
    try {
      const result = await fnRef.current();
      if (id !== seq.current) return;
      setData(result);
      setInitial(false);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof ApiError ? e : new ApiError('INTERNAL', (e as Error).message, 500));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return { data, error, loading, initial: initial && loading, refetch: run, setData: (u) => setData((prev) => (typeof u === 'function' ? (u as (p: T | undefined) => T | undefined)(prev) : u)) };
}

/** Wraps a mutation: pending flag, error, and the result promise. */
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError>();
  const mutate = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true);
    setError(undefined);
    try {
      return await fn(...args);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('INTERNAL', (e as Error).message, 500);
      setError(err);
      throw err;
    } finally {
      setPending(false);
    }
  }, [fn]);
  return { mutate, pending, error, reset: () => setError(undefined) };
}

/** navigator.onLine with change events. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/** Tailwind-aligned breakpoint hook: 'mobile' <768, 'tablet' <1280, else 'desktop'. */
export function useBreakpoint(): 'mobile' | 'tablet' | 'desktop' {
  const [bp, setBp] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');
  useEffect(() => {
    const calc = () => setBp(window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1280 ? 'tablet' : 'desktop');
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  return bp;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useLocalStorage<T>(key: string, initialValue: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(initialValue);
  const loaded = useRef(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(key); if (raw !== null) setValue(JSON.parse(raw) as T); } catch { /* private mode */ }
    loaded.current = true;
  }, [key]);
  const set = useCallback((v: T | ((p: T) => T)) => {
    setValue((prev) => { const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v; try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ } return next; });
  }, [key]);
  return [value, set];
}
