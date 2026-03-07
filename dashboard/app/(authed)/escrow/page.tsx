'use client';

import { useQuery } from '@tanstack/react-query';
import { Shield, Clock, CheckCircle, XCircle, Star } from 'lucide-react';
import MetricCard from '@/components/MetricCard';

interface EscrowStats {
  totalEscrows: number;
  fundedCount: number;
  completedCount: number;
  releasedCount: number;
  disputedCount: number;
  totalReleasedUsdc: number;
}

/**
 * Compute a simple volume-based reputation grade for display.
 * Mirrors the backend AgentRank thresholds so the label is consistent.
 *
 * total_volume (USDC) → grade
 *   ≥ 100 000  → AAA (S tier)
 *   ≥  10 000  → AA  (A tier)
 *   ≥   1 000  → A   (B tier)
 *   ≥     100  → B   (C tier)
 *               → —   (Unranked)
 */
function volumeToGrade(totalUsdc: number): { label: string; color: string } {
  if (totalUsdc >= 100_000) return { label: 'AAA', color: 'text-yellow-400' };
  if (totalUsdc >= 10_000) return { label: 'AA', color: 'text-emerald-400' };
  if (totalUsdc >= 1_000) return { label: 'A', color: 'text-blue-400' };
  if (totalUsdc >= 100) return { label: 'B', color: 'text-slate-300' };
  return { label: '—', color: 'text-slate-500' };
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

/**
 * Escrow dashboard page — shows A2A hiring escrow status and a "Fund Bot" button.
 */
export default function EscrowPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['escrowStats'],
    queryFn: fetchEscrowStats,
    refetchInterval: 30_000, // refresh every 30 s
  });

  const grade = volumeToGrade(stats?.totalReleasedUsdc ?? 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Escrow</h1>
        {/* Reputation grade badge — updates as escrows are approved */}
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1">
          <Star size={13} className="text-yellow-400" />
          <span className={`text-xs font-extrabold ${grade.color}`}>{grade.label}</span>
          <span className="text-xs text-slate-500 ml-0.5">Reputation</span>
        </div>
      </div>
      <p className="text-slate-400 text-sm">
        Agent-to-Agent escrow for hiring flows. Lock funds, mark work complete, approve or dispute.
      </p>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Active Escrows"
          value={stats ? (stats.fundedCount + stats.completedCount) : '—'}
          icon={Shield}
          iconColor="text-purple-400"
          iconBg="bg-purple-500/10"
          loading={isLoading}
        />
        <MetricCard
          label="Pending Approval"
          value={stats ? stats.completedCount : '—'}
          icon={Clock}
          iconColor="text-yellow-400"
          iconBg="bg-yellow-500/10"
          loading={isLoading}
        />
        <MetricCard
          label="Released"
          value={stats ? stats.releasedCount : '—'}
          icon={CheckCircle}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          loading={isLoading}
        />
        <MetricCard
          label="Disputed"
          value={stats ? stats.disputedCount : '—'}
          icon={XCircle}
          iconColor="text-red-400"
          iconBg="bg-red-500/10"
          loading={isLoading}
        />
      </div>

      {/* Total released volume */}
      {stats && stats.totalReleasedUsdc > 0 && (
        <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-2xl p-5 flex items-center justify-between">
          <div>
            <p className="text-sm text-emerald-300 font-medium">Total Released Volume</p>
            <p className="text-2xl font-bold text-white mt-0.5">
              ${stats.totalReleasedUsdc.toFixed(2)} <span className="text-sm text-slate-400">USDC</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Reputation Grade</p>
            <p className={`text-3xl font-extrabold ${grade.color}`}>{grade.label}</p>
          </div>
        </div>
      )}

      {/* API Payload reference */}
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <h2 className="font-semibold mb-3 text-sm">Create Escrow — API Payload</h2>
        <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
{`POST /api/escrow/create
Content-Type: application/json

{
  "hiringAgent": "agent-alpha-001",   // or buyerId
  "workingAgent": "agent-beta-002",   // or sellerId
  "amountUsdc": 25.00,               // or amount
  "workDescription": "Build a dashboard",
  "deadlineHours": 72
}

// Approve (dynamic route):
POST /api/escrow/{id}/approve
{ "callerAgent": "agent-alpha-001" }

// Approve (static alias — same result):
POST /api/escrow/approve
{ "escrowId": "{id}", "callerAgent": "agent-alpha-001" }`}
        </pre>
      </div>

      {/* Fund Bot Button */}
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <h2 className="font-semibold mb-3">Fund Bot</h2>
        <p className="text-slate-400 text-sm mb-4">
          Use your connected Stripe account to purchase USDC and fund your agent wallet.
        </p>
        <button
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium transition"
          onClick={() => alert('Stripe → USDC funding flow coming soon')}
        >
          Fund Bot via Stripe
        </button>
      </div>
    </div>
  );
}
