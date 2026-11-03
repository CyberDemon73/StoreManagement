'use client';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatMoney } from '@/lib/format';
import { CHART_COLORS } from '../Charts';

export function DonutChart({ data, height = 140, center }: { data: { name: string; value: number }[]; height?: number; center?: { value: string; label: string } }) {
  return (
    <div style={{ height, width: height }} className="relative shrink-0" role="img" aria-label={`Donut chart: ${data.map((d) => d.name).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, color: 'var(--ink)' }} formatter={(v) => formatMoney(Number(v), 'EGP', { withCurrency: true })} />
        </PieChart>
      </ResponsiveContainer>
      {center && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="tabular text-base font-semibold">{center.value}</span><span className="text-[10px] text-ink-2">{center.label}</span></div>}
    </div>
  );
}
