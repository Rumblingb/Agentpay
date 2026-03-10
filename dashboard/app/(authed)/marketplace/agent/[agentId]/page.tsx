'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Star,
  TrendingUp,
  CheckCircle,
  ShieldCheck,
  Loader2,
  Award,
  DollarSign,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';

interface AgentProfile {
  agentId: string;
  handle: string;
  bio: string | null;
  score: number;
  grade: string;
  transactionVolume: number;
  paymentReliability: number;
  serviceDelivery: number;
  walletAgeDays: number;
  updatedAt: string;
}

interface Transaction {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  task?: { description?: string };
}

const TRUST_INDICATORS = [
  { key: 'paymentReliability', label: 'Payment Reliability', color: 'bg-emerald-500' },
  { key: 'serviceDelivery', label: 'Service Delivery', color: 'bg-blue-500' },
] as const;
  S: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
  A: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
  B: 'bg-blue-500/20 text-blue-400 border border-blue-500/40',
  C: 'bg-slate-500/20 text-slate-300 border border-slate-500/40',
  D: 'bg-orange-500/20 text-orange-400 border border-orange-500/40',
  F: 'bg-red-500/20 text-red-400 border border-red-500/40',
};

export default function AgentProfilePage() {
  const params = useParams();
  const router = useRouter();
  const agentId = decodeURIComponent(params?.agentId as string ?? '');

  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Hire form
  const [amount, setAmount] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [hiring, setHiring] = useState(false);
  const [hireResult, setHireResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!agentId) return;
    async function load() {
      try {
        const [rankRes, agentRes] = await Promise.allSettled([
          fetch(`/api/agentrank/${encodeURIComponent(agentId)}`),
          fetch(`/api/agents/${encodeURIComponent(agentId)}`),
        ]);

        if (rankRes.status === 'fulfilled' && rankRes.value.ok) {
          const data = await rankRes.value.json();
          const r = data.agent ?? data;
          setProfile({
            agentId: r.agent_id ?? r.agentId ?? agentId,
            handle: r.handle ?? r.agent_id ?? agentId,
            bio: r.bio ?? null,
            score: r.score ?? 0,
            grade: r.grade ?? 'U',
            transactionVolume: r.transaction_volume ?? r.transactionVolume ?? 0,
            paymentReliability: Number(r.payment_reliability ?? r.paymentReliability ?? 0),
            serviceDelivery: Number(r.service_delivery ?? r.serviceDelivery ?? 0),
            walletAgeDays: r.wallet_age_days ?? r.walletAgeDays ?? 0,
            updatedAt: r.updated_at ?? r.updatedAt ?? '',
          });
        }

        if (agentRes.status === 'fulfilled' && agentRes.value.ok) {
          const data = await agentRes.value.json();
          setTransactions((data.recentTransactions ?? data.transactions ?? []).slice(0, 5));
        }
      } catch (err: any) {
        setError(err.message ?? 'Failed to load agent');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [agentId]);

  async function handleHire(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || !taskDesc) return;
    setHiring(true);
    setHireResult(null);
    try {
      const res = await fetch('/api/marketplace/hire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIdToHire: agentId,
          amountUsd: parseFloat(amount),
          taskDescription: taskDesc,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Hire failed');
      setHireResult({ success: true, message: `Hired! Escrow ID: ${data.escrowId}` });
      setAmount('');
      setTaskDesc('');
    } catch (err: any) {
      setHireResult({ success: false, message: err.message ?? 'Hire failed' });
    } finally {
      setHiring(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition"
      >
        <ArrowLeft size={14} /> Back to Marketplace
      </button>

      {loading ? (
        <div className="flex items-center gap-3 text-slate-400 py-12">
          <Loader2 size={18} className="animate-spin" /> Loading agent profile…
        </div>
      ) : error && !profile ? (
        <div className="p-8 text-center text-red-400 text-sm">{error}</div>
      ) : (
        <>
          {/* Agent header */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold">
                  {profile?.handle ?? agentId}
                </h1>
                {profile && (
                  <span
                    className={`text-sm font-bold px-2.5 py-0.5 rounded-lg ${GRADE_BADGE[profile.grade] ?? 'bg-slate-700 text-slate-300'}`}
                  >
                    Grade {profile.grade}
                  </span>
                )}
              </div>
              {profile?.bio && (
                <p className="text-slate-400 text-sm">{profile.bio}</p>
              )}
              <p className="text-xs text-slate-500 font-mono">{agentId}</p>
            </div>
            {profile && (
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold text-emerald-400">{profile.score}</div>
                <div className="text-xs text-slate-500">AgentRank score</div>
              </div>
            )}
          </div>

          {/* Key metrics */}
          {profile && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label="Score"
                value={profile.score}
                icon={Award}
                iconColor="text-yellow-400"
                iconBg="bg-yellow-500/10"
              />
              <MetricCard
                label="Tx Volume"
                value={profile.transactionVolume.toLocaleString()}
                icon={TrendingUp}
                iconColor="text-emerald-400"
                iconBg="bg-emerald-500/10"
              />
              <MetricCard
                label="Payment Reliability"
                value={`${(profile.paymentReliability * 100).toFixed(1)}%`}
                icon={CheckCircle}
                iconColor="text-blue-400"
                iconBg="bg-blue-500/10"
              />
              <MetricCard
                label="Service Delivery"
                value={`${(profile.serviceDelivery * 100).toFixed(1)}%`}
                icon={ShieldCheck}
                iconColor="text-purple-400"
                iconBg="bg-purple-500/10"
              />
            </div>
          )}

          {/* Trust indicators */}
          {profile && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <h2 className="font-semibold mb-4">Trust Indicators</h2>
              <div className="space-y-3">
                {TRUST_INDICATORS.map(({ key, label, color }) => {
                  const value = profile[key as keyof AgentProfile] as number;
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">{label}</span>
                        <span className="text-slate-300">{(value * 100).toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${color} rounded-full transition-all`}
                          style={{ width: `${Math.min(value * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
                  <Star size={11} className="text-yellow-400" />
                  Wallet age: {profile.walletAgeDays} days
                </div>
              </div>
            </div>
          )}

          {/* Hire form */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <DollarSign size={16} className="text-emerald-400" /> Hire This Agent
            </h2>
            <form onSubmit={handleHire} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">
                  Amount (USD)
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="10.00"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-600"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">
                  Task Description
                </label>
                <textarea
                  value={taskDesc}
                  onChange={(e) => setTaskDesc(e.target.value)}
                  placeholder="Describe the task you want this agent to complete…"
                  rows={4}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-600 resize-none"
                  required
                />
              </div>
              {hireResult && (
                <div
                  className={`text-sm px-3 py-2 rounded-lg ${
                    hireResult.success
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}
                >
                  {hireResult.message}
                </div>
              )}
              <button
                type="submit"
                disabled={hiring}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold rounded-lg text-sm transition flex items-center justify-center gap-2"
              >
                {hiring && <Loader2 size={14} className="animate-spin" />}
                {hiring ? 'Processing…' : 'Hire with Escrow'}
              </button>
            </form>
          </div>

          {/* Recent transactions */}
          {transactions.length > 0 && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800">
                <h2 className="font-semibold">Recent Transactions</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="text-left px-6 py-3 font-medium">Task</th>
                    <th className="text-left px-6 py-3 font-medium">Amount</th>
                    <th className="text-left px-6 py-3 font-medium">Status</th>
                    <th className="text-left px-6 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-slate-800/50 hover:bg-slate-800/20 transition"
                    >
                      <td className="px-6 py-3 text-slate-300 max-w-[200px] truncate text-xs">
                        {tx.task?.description ?? '—'}
                      </td>
                      <td className="px-6 py-3 text-emerald-400">${Number(tx.amount).toFixed(2)}</td>
                      <td className="px-6 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            tx.status === 'completed'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : tx.status === 'hired'
                              ? 'bg-blue-500/15 text-blue-400'
                              : 'bg-slate-700 text-slate-400'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-slate-500 text-xs">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
