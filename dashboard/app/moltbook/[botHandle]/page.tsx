'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Activity, DollarSign, AlertTriangle, Shield, Pause, Play } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import SpendingChart from '@/components/moltbook/SpendingChart';
import ReputationBadge from '@/components/moltbook/ReputationBadge';
import {
  SpendingCardSkeleton,
  MetricCardSkeleton,
  SpendingChartSkeleton,
  TopMerchantsSkeleton,
  PolicySettingsSkeleton,
  TransactionTableSkeleton,
} from '@/components/moltbook/LoadingSkeleton';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface SpendingData {
  today: { spent: number; limit: number; percentUsed: number; transactions: number };
  last7Days: { date: string; amount: number }[];
  topMerchants: { name: string; totalSpent: number; transactionCount: number }[];
  policy: { dailyLimit: number; perTxLimit: number; autoApproveUnder: number };
  recentTransactions: {
    id: string;
    merchant_name: string;
    amount: number;
    status: string;
    created_at: string;
    tx_type: string;
  }[];
  alerts: { type: 'warning' | 'error' | 'info'; message: string; timestamp: string }[];
}

interface AnalyticsData {
  lifetimeSpending: number;
  averageTransactionSize: number;
  totalTransactions: number;
  successRate: number;
  merchantDiversity: number;
  spendingVelocity: { date: string; amount: number }[];
  mostActiveHours: { hour: number; count: number }[];
  costPerAction: number;
}

async function fetchSpending(handle: string): Promise<SpendingData> {
  const res = await fetch(`${API_BASE}/api/moltbook/bots/${handle}/spending`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('apiKey') || ''}` },
  });
  if (!res.ok) throw new Error('Failed to fetch spending data');
  const json = await res.json();
  return json.data;
}

async function fetchAnalytics(handle: string): Promise<AnalyticsData> {
  const res = await fetch(`${API_BASE}/api/moltbook/bots/${handle}/analytics`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('apiKey') || ''}` },
  });
  if (!res.ok) throw new Error('Failed to fetch analytics');
  const json = await res.json();
  return json.data;
}

export default function MoltbookBotDashboard() {
  const params = useParams();
  const botHandle = params?.botHandle as string;
  const [isPaused, setIsPaused] = useState(false);

  const { data: spending, isLoading: spendingLoading } = useQuery({
    queryKey: ['moltbook-spending', botHandle],
    queryFn: () => fetchSpending(botHandle),
    refetchInterval: 5000,
    enabled: !!botHandle,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['moltbook-analytics', botHandle],
    queryFn: () => fetchAnalytics(botHandle),
    enabled: !!botHandle,
  });

  const handlePauseResume = async () => {
    const action = isPaused ? 'resume' : 'pause';
    try {
      const res = await fetch(`${API_BASE}/api/moltbook/bots/${botHandle}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('apiKey') || ''}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        setIsPaused(!isPaused);
        toast.success(action === 'resume' ? 'Payments resumed' : 'Payments paused');
      } else {
        toast.error(`Failed to ${action} payments`);
      }
    } catch {
      toast.error('Network error — please try again');
    }
  };

  const percentColor =
    (spending?.today.percentUsed ?? 0) >= 90
      ? 'text-red-400'
      : (spending?.today.percentUsed ?? 0) >= 70
        ? 'text-yellow-400'
        : 'text-emerald-400';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-6 lg:p-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            🤖 {botHandle}
            {analytics && (
              <ReputationBadge
                score={Math.round(analytics.successRate)}
                totalTransactions={analytics.totalTransactions}
                successRate={analytics.successRate}
                merchantDiversity={analytics.merchantDiversity}
              />
            )}
          </h1>
          <p className="text-slate-400 text-sm mt-1">Bot Financial Dashboard — Powered by AgentPay</p>
        </div>
        <button
          onClick={handlePauseResume}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            isPaused
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/30'
          }`}
        >
          {isPaused ? <Play size={16} /> : <Pause size={16} />}
          {isPaused ? 'Resume Payments' : 'Pause Payments'}
        </button>
      </div>

      {/* Alerts */}
      {spending?.alerts && spending.alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {spending.alerts.map((alert, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                alert.type === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : alert.type === 'warning'
                    ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                    : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
              }`}
            >
              <AlertTriangle size={16} />
              <span className="text-sm">{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Spending Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-8">
        {spendingLoading ? (
          <SpendingCardSkeleton />
        ) : (
        <div className="lg:col-span-1 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
          <div className="text-xs text-slate-400 mb-2">Today&apos;s Spending</div>
          <div className="text-3xl font-bold">
            <span className={percentColor}>${spending?.today.spent.toFixed(2) ?? '—'}</span>
            <span className="text-slate-500 text-lg"> / ${spending?.today.limit.toFixed(2) ?? '—'}</span>
          </div>
          <div className="mt-3 w-full bg-slate-800 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${
                (spending?.today.percentUsed ?? 0) >= 90
                  ? 'bg-red-500'
                  : (spending?.today.percentUsed ?? 0) >= 70
                    ? 'bg-yellow-500'
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(spending?.today.percentUsed ?? 0, 100)}%` }}
            />
          </div>
          <div className="text-xs text-slate-500 mt-2">
            {spending?.today.transactions ?? 0} transactions today
          </div>
        </div>
        )}

        {analyticsLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
        <MetricCard
          label="Lifetime Spending"
          value={analytics ? `$${analytics.lifetimeSpending.toFixed(2)}` : '—'}
          icon={DollarSign}
          iconColor="text-blue-400"
          iconBg="bg-blue-500/10"
          loading={analyticsLoading}
        />
        <MetricCard
          label="Avg Transaction"
          value={analytics ? `$${analytics.averageTransactionSize.toFixed(2)}` : '—'}
          icon={Activity}
          iconColor="text-purple-400"
          iconBg="bg-purple-500/10"
          loading={analyticsLoading}
        />
        <MetricCard
          label="Success Rate"
          value={analytics ? `${analytics.successRate.toFixed(1)}%` : '—'}
          icon={Shield}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          loading={analyticsLoading}
        />
          </>
        )}
      </div>

      {/* Chart + Top Merchants */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          {spendingLoading ? (
            <SpendingChartSkeleton />
          ) : (
          <SpendingChart
            data={spending?.last7Days ?? []}
            dailyLimit={spending?.policy.dailyLimit}
            loading={spendingLoading}
          />
          )}
        </div>

        {/* Top Merchants */}
        {spendingLoading ? (
          <TopMerchantsSkeleton />
        ) : (
        <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
          <h2 className="font-semibold mb-4 text-slate-200">Top Merchants</h2>
          {spending?.topMerchants.length === 0 ? (
            <div className="text-slate-500 text-sm">No merchant data yet.</div>
          ) : (
            <div className="space-y-3">
              {spending?.topMerchants.map((m, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-200">{m.name}</div>
                    <div className="text-xs text-slate-500">{m.transactionCount} transactions</div>
                  </div>
                  <div className="text-sm font-semibold text-slate-200">${m.totalSpent.toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>

      {/* Policy Settings + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Policy Settings */}
        {spendingLoading ? (
          <PolicySettingsSkeleton />
        ) : (
        <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
          <h2 className="font-semibold mb-4 text-slate-200">Policy Settings</h2>
          {spending ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Daily Limit</span>
                <span className="text-slate-200 font-medium">${spending.policy.dailyLimit.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Per-Tx Limit</span>
                <span className="text-slate-200 font-medium">${spending.policy.perTxLimit.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Auto-Approve Under</span>
                <span className="text-slate-200 font-medium">${spending.policy.autoApproveUnder.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="text-slate-500 text-sm">Unable to load policy data.</div>
          )}
        </div>
        )}

        {/* Recent Transactions */}
        {spendingLoading ? (
          <TransactionTableSkeleton />
        ) : (
        <div className="lg:col-span-2 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
          <h2 className="font-semibold mb-4 text-slate-200">Recent Transactions</h2>
          {spending?.recentTransactions.length === 0 ? (
            <div className="text-slate-500 text-sm">No transactions yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-800">
                    <th className="text-left pb-2">Time</th>
                    <th className="text-left pb-2">Merchant</th>
                    <th className="text-right pb-2">Amount</th>
                    <th className="text-right pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {spending?.recentTransactions.slice(0, 10).map((tx) => (
                    <tr key={tx.id} className="border-b border-slate-800/50">
                      <td className="py-2 text-slate-400">
                        {new Date(tx.created_at).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-2 text-slate-200">{tx.merchant_name}</td>
                      <td className="py-2 text-right text-slate-200">${Number(tx.amount).toFixed(2)}</td>
                      <td className="py-2 text-right">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            tx.status === 'completed'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : tx.status === 'failed'
                                ? 'bg-red-500/10 text-red-400'
                                : 'bg-yellow-500/10 text-yellow-400'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
