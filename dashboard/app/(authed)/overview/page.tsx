'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, DollarSign, CheckCircle, Clock } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import OnboardingTour from '@/components/OnboardingTour';
// PRODUCTION FIX — NETWORK HEALTH CHART
import NetworkHealthChart from '@/components/NetworkHealthChart';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
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

async function fetchStats(): Promise<PaymentStats> {
  const res = await fetch('/api/me');
  if (!res.ok) throw new Error('Failed to fetch profile');
  // Use the payments endpoint for stats
  const statsRes = await fetch('/api/stats');
  if (!statsRes.ok) throw new Error('Failed to fetch stats');
  return statsRes.json();
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

/** Aggregate payments by day for the chart */
function buildChartData(payments: Payment[]) {
  const byDay: Record<string, number> = {};
  
  payments.forEach((p) => {
    const day = new Date(p.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    
    // Convert to number first to avoid .toFixed error
    const amount = Number(p.amountUsdc) || 0;
    
    // Aggregate confirmed payments and released escrows for the revenue chart
    const counted = p.status === 'confirmed' || p.status === 'released';
    byDay[day] = (byDay[day] ?? 0) + (counted ? amount : 0);
  });

  return Object.entries(byDay)
    .slice(-14)
    .map(([date, usdc]) => ({ 
      date, 
      usdc: Number(usdc.toFixed(2)) // This is now safe
    }));
}

export default function OverviewPage() {
  const [isClient, setIsClient] = useState(false);

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

  function handleTourComplete() {
    localStorage.setItem(TOUR_DISMISSED_KEY, '1');
    setShowTour(false);
  }

  if (!isClient) return null;

  const stats = data?.stats;

  // Combine payment + escrow transactions for the chart
  // Use updatedAt as the chart date for escrow releases (when funds were released)
  const escrowPayments: Payment[] = (escrowData?.recentReleased ?? []).map((e) => ({
    id: e.id,
    paymentId: e.id,
    amountUsdc: e.amountUsdc,
    status: e.status,
    createdAt: e.updatedAt,
  }));
  const allTransactions = [...(data?.transactions ?? []), ...escrowPayments];
  const chartData = buildChartData(allTransactions);

  // Combine stats: payment confirmed + escrow released
  const combinedTotal = (stats?.totalTransactions ?? 0) + (escrowData?.totalEscrows ?? 0);
  const combinedConfirmed = (stats?.confirmedCount ?? 0) + (escrowData?.releasedCount ?? 0);
  const combinedRevenue = (stats?.totalConfirmedUsdc ?? 0) + (escrowData?.totalReleasedUsdc ?? 0);

  const successRate =
    combinedTotal > 0
      ? ((combinedConfirmed / combinedTotal) * 100).toFixed(1) + '%'
      : '—';

  return (
    <div className="space-y-8">
      {showTour && (
        <OnboardingTour
          userName={profile?.name}
          onComplete={handleTourComplete}
        />
      )}

      <h1 className="text-xl font-bold">Overview</h1>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Intents"
          value={stats ? combinedTotal : '—'}
          icon={Activity}
          iconColor="text-purple-400"
          iconBg="bg-purple-500/10"
          loading={isLoading}
        />
        <MetricCard
          label="Total Revenue (USDC)"
          value={stats ? `$${combinedRevenue.toFixed(2)}` : '—'}
          icon={DollarSign}
          iconColor="text-blue-400"
          iconBg="bg-blue-500/10"
          loading={isLoading}
        />
        <MetricCard
          label="Confirmed"
          value={stats ? combinedConfirmed : '—'}
          icon={CheckCircle}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          loading={isLoading}
        />
        <MetricCard
          label="Success Rate"
          value={successRate}
          icon={Clock}
          iconColor="text-yellow-400"
          iconBg="bg-yellow-500/10"
          loading={isLoading}
        />
      </div>

      {/* Chart */}
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <h2 className="font-semibold mb-5">Revenue Over Time (USDC confirmed + released)</h2>
        {isLoading ? (
          <div className="h-48 flex items-center justify-center text-slate-500">Loading…</div>
        ) : chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
            No payment data yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#34d399' }}
              />
              <Line
                type="monotone"
                dataKey="usdc"
                stroke="#34d399"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* PRODUCTION FIX — NETWORK HEALTH CHART: TVS visualisation */}
      <NetworkHealthChart />
    </div>
  );
}

