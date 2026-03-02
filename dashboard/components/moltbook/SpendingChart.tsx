'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Area,
  AreaChart,
} from 'recharts';

interface SpendingChartProps {
  data: { date: string; amount: number }[];
  dailyLimit?: number;
  loading?: boolean;
}

function getLineColor(percentUsed: number): string {
  if (percentUsed >= 90) return '#ef4444'; // red
  if (percentUsed >= 70) return '#eab308'; // yellow
  return '#34d399'; // green
}

export default function SpendingChart({ data, dailyLimit, loading = false }: SpendingChartProps) {
  if (loading) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <h2 className="font-semibold mb-5 text-slate-200">Spending — Last 7 Days</h2>
        <div className="h-56 flex items-center justify-center text-slate-500">Loading…</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <h2 className="font-semibold mb-5 text-slate-200">Spending — Last 7 Days</h2>
        <div className="h-56 flex items-center justify-center text-slate-500 text-sm">
          No spending data yet.
        </div>
      </div>
    );
  }

  const maxAmount = Math.max(...data.map((d) => d.amount));
  const latestPercent = dailyLimit && dailyLimit > 0 ? (maxAmount / dailyLimit) * 100 : 0;
  const strokeColor = getLineColor(latestPercent);

  return (
    <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
      <h2 className="font-semibold mb-5 text-slate-200">Spending — Last 7 Days</h2>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={strokeColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v: string) => {
              const d = new Date(v);
              return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }}
          />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
          <Tooltip
            contentStyle={{
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: 8,
            }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Spent']}
          />
          {dailyLimit && (
            <ReferenceLine
              y={dailyLimit}
              stroke="#ef4444"
              strokeDasharray="6 3"
              label={{ value: `Limit: $${dailyLimit}`, fill: '#ef4444', fontSize: 11 }}
            />
          )}
          <Area
            type="monotone"
            dataKey="amount"
            stroke={strokeColor}
            strokeWidth={2}
            fill="url(#spendGradient)"
            animationDuration={800}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
