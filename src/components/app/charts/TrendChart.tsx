'use client';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '@/lib/format';
import type { TrendPoint } from '@/types';

export function TrendChart({ data, height = 180, showProfit = true }: { data: TrendPoint[]; height?: number; showProfit?: boolean }) {
  const fmtDay = (b: string) => new Date(b).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <div style={{ height }} role="img" aria-label="Line chart of sales and profit over time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="bucket" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: 'var(--ink-2)' }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tickFormatter={(v: number) => formatMoney(v, 'EGP', { compact: true })} tick={{ fontSize: 11, fill: 'var(--ink-2)' }} axisLine={false} tickLine={false} width={56} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, color: 'var(--ink)' }} labelFormatter={(l) => fmtDay(String(l))} formatter={(v, name) => [formatMoney(Number(v), 'EGP', { withCurrency: true }), name === 'revenue' ? 'Sales' : 'Profit']} />
          <Line type="monotone" dataKey="revenue" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          {showProfit && <Line type="monotone" dataKey="profit" stroke="var(--ink-3)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
