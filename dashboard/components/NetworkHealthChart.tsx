// PRODUCTION FIX — NETWORK HEALTH CHART
// Visualises "Total Value Secured" (TVS) — the aggregate USDC held in
// active escrows + confirmed payments. Data is mocked with the current
// 40 txs / $454 baseline; in production this will be fetched from /api/stats.

'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ---------------------------------------------------------------------------
// Default TVS data (shared with backend tests via src/data)
// Re-exported here for convenience in dashboard-only contexts.
// ---------------------------------------------------------------------------

export const DEFAULT_TVS_DATA = [
  { name: 'Feb 20', tvs: 120 },
  { name: 'Feb 25', tvs: 280 },
  { name: 'Mar 01', tvs: 410 },
  { name: 'Mar 04', tvs: 454 },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NetworkHealthChartProps {
  /** Override default mock data with live TVS time-series. */
  data?: { name: string; tvs: number }[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NetworkHealthChart({
  data = DEFAULT_TVS_DATA,
}: NetworkHealthChartProps) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
      <h2 className="font-semibold mb-5">Network Health — Total Value Secured (USDC)</h2>

      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
          No TVS data available.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="tvsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
            <Tooltip
              contentStyle={{
                background: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: 8,
              }}
              labelStyle={{ color: '#94a3b8' }}
              itemStyle={{ color: '#818cf8' }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, 'TVS']}
            />
            <Area
              type="monotone"
              dataKey="tvs"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#tvsFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
