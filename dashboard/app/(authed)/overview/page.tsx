'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  DollarSign,
  CheckCircle,
  TrendingUp,
  Play,
  Loader2,
  ArrowUpRight,
  Clock,
  Layers,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import OnboardingTour from '@/components/OnboardingTour';
import RecentActivity from '@/components/RecentActivity';
import NetworkHealthChart from '@/components/NetworkHealthChart';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  AreaChart,
} from 'recharts';

const TOUR_DISMISSED_KEY = 'agentpay_onboarding_complete';

interface PaymentStats {
  totalTransactions: number;
  confirmedCount: number;
  pendingCount: number;
  failedCount: number;
  totalConfirmedUsdc: number;
}

interface Payment {
  id: string;
  paymentId: string;
  amountUsdc: number;
  status: string;
  createdAt: string;
}

interface EscrowStats {
  totalEscrows: number;
  releasedCount: number;
  totalReleasedUsdc: number;
  recentReleased: Array<{
    id: string;
    amountUsdc: number;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

async function fetchPaymentsData(): Promise<{ transactions: Payment[]; stats: PaymentStats }> {
  const res = await fetch('/api/payments');
  if (!res.ok) throw new Error('Failed to load payments');
  return res.json();
}

async function fetchEscrowStats(): Promise<EscrowStats | null> {
  try {
    const res = await fetch('/api/escrow/stats');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchProfile(): Promise<{ name: string; email: string } | null> {
  const res = await fetch('/api/me');
  if (!res.ok) return null;
  return res.json();
}

function buildChartData(payments: Payment[]) {
  const byDay: Record<string, number> = {};
  payments.forEach((p) => {
    const day = new Date(p.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const amount = Number(p.amountUsdc) || 0;
    const counted = p.status === 'confirmed' || p.status === 'released';
    byDay[day] = (byDay[day] ?? 0) + (counted ? amount : 0);
  });
  return Object.entries(byDay)
    .slice(-14)
    .map(([date, usdc]) => ({ date, usdc: Number(usdc.toFixed(2)) }));
}

const customTooltipStyle = {
  contentStyle: {
    background: '#0d0d0d',
    border: '1px solid #1c1c1c',
    borderRadius: 8,
    fontSize: 12,
    color: '#d4d4d4',
  },
  labelStyle: { color: '#525252' },
  itemStyle: { color: '#34d399' },
};

export default function OverviewPage() {
  const [isClient, setIsClient] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoSuccess, setDemoSuccess] = useState(false);
  const queryClient = useQueryClient();

  const runDemo = useCallback(async () => {
    setDemoRunning(true);
    setDemoSuccess(false);
    try {
      const res = await fetch('/api/demo', { method: 'POST' });
      if (res.ok) {
        setDemoSuccess(true);
        queryClient.invalidateQueries({ queryKey: ['overview'] });
        queryClient.invalidateQueries({ queryKey: ['escrowStats'] });
        setTimeout(() => setDemoSuccess(false), 4000);
      }
    } catch {
      // silent
    } finally {
      setDemoRunning(false);
    }
  }, [queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: ['overview'],
    queryFn: fetchPaymentsData,
  });

  const { data: escrowData } = useQuery({
    queryKey: ['escrowStats'],
    queryFn: fetchEscrowStats,
  });

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
  });

  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    setIsClient(true);
    const dismissed = localStorage.getItem(TOUR_DISMISSED_KEY);
    if (!dismissed) setShowTour(true);
  }, []);

  if (!isClient) return null;

  const stats = data?.stats;
  const escrowPayments: Payment[] = (escrowData?.recentReleased ?? []).map((e) => ({
    id: e.id,
    paymentId: e.id,
    amountUsdc: e.amountUsdc,
    status: e.status,
    createdAt: e.updatedAt,
  }));
  const allTransactions = [...(data?.transactions ?? []), ...escrowPayments];
  const chartData = buildChartData(allTransactions);

  const combinedTotal = (stats?.totalTransactions ?? 0) + (escrowData?.totalEscrows ?? 0);
  const combinedConfirmed = (stats?.confirmedCount ?? 0) + (escrowData?.releasedCount ?? 0);
  const combinedRevenue = (stats?.totalConfirmedUsdc ?? 0) + (escrowData?.totalReleasedUsdc ?? 0);
  const pendingCount = stats?.pendingCount ?? 0;

  const successRate =
    combinedTotal > 0
      ? ((combinedConfirmed / combinedTotal) * 100).toFixed(1) + '%'
      : '—';

  return (
    <div className="space-y-6">
      {showTour && (
        <OnboardingTour
          userName={profile?.name}
          onComplete={() => {
            localStorage.setItem(TOUR_DISMISSED_KEY, '1');
            setShowTour(false);
          }}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-white tracking-[-0.02em]">Overview</h1>
          <p className="text-[12px] text-[#525252] mt-0.5">
            {profile?.name ? `Welcome back, ${profile.name}` : 'Payment infrastructure dashboard'}
          </p>
        </div>

        {/* Quick demo button */}
        <button
          onClick={runDemo}
          disabled={demoRunning}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-200 ${
            demoSuccess
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'text-[#737373] hover:text-white border border-[#1c1c1c] hover:border-[#303030]'
          }`}
          style={{ background: demoSuccess ? undefined : '#0d0d0d' }}
        >
          {demoRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {demoRunning ? 'Running…' : demoSuccess ? '✓ Confirmed' : 'Run Demo'}
        </button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Total Intents"
          value={stats ? combinedTotal : '—'}
          icon={Activity}
          iconColor="text-emerald-400"
          trend={combinedTotal > 0 ? `${combinedTotal}` : undefined}
          trendDir="positive"
          loading={isLoading}
        />
        <MetricCard
          label="Revenue (USDC)"
          value={stats ? `$${combinedRevenue.toFixed(2)}` : '—'}
          icon={DollarSign}
          iconColor="text-blue-400"
          sub="Platform-settled"
          loading={isLoading}
        />
        <MetricCard
          label="Confirmed"
          value={stats ? combinedConfirmed : '—'}
          icon={CheckCircle}
          iconColor="text-emerald-400"
          trend={successRate !== '—' ? successRate : undefined}
          trendDir="positive"
          loading={isLoading}
        />
        <MetricCard
          label="Pending"
          value={stats ? pendingCount : '—'}
          icon={Clock}
          iconColor="text-amber-400"
          trendDir="neutral"
          loading={isLoading}
        />
      </div>

      {/* Revenue chart */}
      <div
        className="rounded-xl p-5"
        style={{ background: '#0d0d0d', border: '1px solid #1c1c1c' }}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[13px] font-semibold text-white">Revenue over time</h2>
            <p className="text-[11px] text-[#404040] mt-0.5">USDC confirmed + escrow released</p>
          </div>
          {combinedRevenue > 0 && (
            <div className="flex items-center gap-1 text-[12px] text-emerald-400 font-medium">
              <TrendingUp size={13} />
              ${combinedRevenue.toFixed(2)} total
            </div>
          )}
        </div>
        {isLoading ? (
          <div className="h-48 flex items-center justify-center text-[#303030] text-sm">
            Loading…
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center gap-2">
            <Layers size={24} className="text-[#2a2a2a]" />
            <p className="text-[12px] text-[#404040]">No payment data yet. Run the demo or make your first payment.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="usdcGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#404040' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#404040' }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip {...customTooltipStyle} />
              <Area
                type="monotone"
                dataKey="usdc"
                stroke="#10b981"
                strokeWidth={1.5}
                fill="url(#usdcGrad)"
                dot={false}
                activeDot={{ r: 3, fill: '#10b981' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Network health + recent activity — two-column on large screens */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div
          className="rounded-xl p-5"
          style={{ background: '#0d0d0d', border: '1px solid #1c1c1c' }}
        >
          <h2 className="text-[13px] font-semibold text-white mb-4">Network health</h2>
          <NetworkHealthChart />
        </div>

        <div
          className="rounded-xl p-5"
          style={{ background: '#0d0d0d', border: '1px solid #1c1c1c' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-semibold text-white">Recent activity</h2>
            <a
              href="/intents"
              className="flex items-center gap-1 text-[11px] text-[#525252] hover:text-emerald-400 transition-colors"
            >
              All intents <ArrowUpRight size={11} />
            </a>
          </div>
          <RecentActivity />
        </div>
      </div>
    </div>
  );
}
