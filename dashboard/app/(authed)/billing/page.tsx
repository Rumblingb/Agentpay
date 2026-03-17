'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Receipt, Percent, TrendingUp, CheckCircle, Clock, XCircle } from 'lucide-react';

interface Stats {
  totalTransactions: number;
  confirmedCount: number;
  pendingCount: number;
  failedCount: number;
  totalConfirmedUsdc: number;
}

const FEE_BPS = 50; // 0.5%

export default function BillingPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const feesEarned = stats ? (stats.totalConfirmedUsdc * FEE_BPS) / 10000 : 0;
  const volumeProcessed = stats?.totalConfirmedUsdc ?? 0;

  const Skeleton = () => (
    <div className="h-6 w-20 rounded bg-slate-800 animate-pulse" />
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold">Billing</h1>

      {/* Fee structure */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl divide-y divide-slate-800">
        {[
          {
            label: 'Platform Fee',
            value: '0.5%',
            description: 'Applied to each confirmed USDC settlement',
            icon: Percent,
            iconColor: 'text-purple-400',
            iconBg: 'bg-purple-500/10',
          },
          {
            label: 'Settlement',
            value: 'On-chain · Instant',
            description: 'Funds transferred directly to your Solana wallet on confirmation',
            icon: CreditCard,
            iconColor: 'text-blue-400',
            iconBg: 'bg-blue-500/10',
          },
          {
            label: 'Network Fee',
            value: '~$0.0001',
            description: 'Solana transaction cost — covered by the payer',
            icon: Receipt,
            iconColor: 'text-emerald-400',
            iconBg: 'bg-emerald-500/10',
          },
        ].map(({ label, value, description, icon: Icon, iconColor, iconBg }) => (
          <div key={label} className="flex items-start gap-4 p-5">
            <div className={`${iconBg} p-2.5 rounded-lg shrink-0`}>
              <Icon className={iconColor} size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-4">
                <span className="font-semibold text-sm">{label}</span>
                <span className="text-sm font-bold text-white shrink-0">{value}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">{description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Live summary from real stats */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-emerald-400" />
          <h2 className="font-semibold text-sm">Your Account Summary</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            {
              label: 'Volume Processed',
              value: loading ? null : `${volumeProcessed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`,
              icon: TrendingUp,
              color: 'text-emerald-400',
            },
            {
              label: 'Platform Fees',
              value: loading ? null : `${feesEarned.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} USDC`,
              icon: Percent,
              color: 'text-purple-400',
            },
            {
              label: 'Confirmed',
              value: loading ? null : String(stats?.confirmedCount ?? 0),
              icon: CheckCircle,
              color: 'text-emerald-400',
            },
            {
              label: 'Pending',
              value: loading ? null : String(stats?.pendingCount ?? 0),
              icon: Clock,
              color: 'text-amber-400',
            },
            {
              label: 'Failed',
              value: loading ? null : String(stats?.failedCount ?? 0),
              icon: XCircle,
              color: 'text-red-400',
            },
            {
              label: 'Total Intents',
              value: loading ? null : String(stats?.totalTransactions ?? 0),
              icon: Receipt,
              color: 'text-slate-400',
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-slate-800/50 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-1.5">
                <Icon size={12} className={color} />
                <span className="text-xs text-slate-400">{label}</span>
              </div>
              {value === null ? (
                <Skeleton />
              ) : (
                <p className="text-base font-bold text-white">{value}</p>
              )}
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500 pt-2 border-t border-slate-800">
          Fees are collected on settlement. Historical invoices and per-intent breakdowns are available in the Intents ledger.
        </p>
      </div>
    </div>
  );
}
