'use client';
import { useEffect, useState } from 'react';
import { dateRangeFor } from './format';
import type { DateRange, DateRangePreset } from '@/types';

/** Date range shared across report screens; remembered per device. */
export function useDateRange(defaultPreset: DateRangePreset = '30d'): [DateRange, (r: DateRange) => void] {
  const [range, setRange] = useState<DateRange>(() => dateRangeFor(defaultPreset));
  useEffect(() => {
    try {
      const raw = localStorage.getItem('avenue.range');
      if (raw) { const saved = JSON.parse(raw) as DateRange; setRange(saved.preset === 'custom' ? dateRangeFor('custom', new Date(), saved) : dateRangeFor(saved.preset)); }
    } catch { /* ignore */ }
  }, []);
  const set = (r: DateRange) => { setRange(r); try { localStorage.setItem('avenue.range', JSON.stringify(r)); } catch { /* ignore */ } };
  return [range, set];
}
