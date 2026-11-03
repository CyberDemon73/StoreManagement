'use client';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '@/lib/format';
import { CHART_COLORS } from '../Charts';

export function BarsChart({ data, xKey, series, height = 200, money, layout = 'horizontal' }: { data: Record<string, string | number>[]; xKey: string; series: { key: string; label: string; color?: string }[]; height?: number; money?: boolean; layout?: 'horizontal' | 'vertical' }) {
  const fmt = (v: number) => (money ? formatMoney(v, 'EGP', { compact: true }) : v.toLocaleString());
  const tick = { fontSize: 11, fill: 'var(--ink-2)' };
  return (
    <div style={{ height }} role="img" aria-label={`Bar chart of ${series.map((s) => s.label).join(' and ')} by ${xKey}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={layout === 'vertical' ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barGap={3}>
          <CartesianGrid vertical={layout === 'vertical'} horizontal={layout !== 'vertical'} stroke="var(--line)" />
          {layout === 'vertical' ? (
            <>
              <XAxis type="number" tickFormatter={fmt} tick={tick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey={xKey} tick={tick} axisLine={false} tickLine={false} width={110} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={tick} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmt} tick={tick} axisLine={false} tickLine={false} width={48} />
            </>
          )}
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, color: 'var(--ink)' }} formatter={(v, name) => [money ? formatMoney(Number(v), 'EGP', { withCurrency: true }) : Number(v).toLocaleString(), series.find((s) => s.key === name)?.label ?? String(name)]} />
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} fill={s.color ?? CHART_COLORS[(i * 2) % CHART_COLORS.length]} radius={3} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
