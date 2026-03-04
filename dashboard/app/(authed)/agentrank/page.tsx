'use client';

import { useState } from 'react';
import { Shield, TrendingUp, AlertTriangle, Star } from 'lucide-react';
import MetricCard from '@/components/MetricCard';

/**
 * AgentRank dashboard page — shows scores, history, alerts, and escrow status.
 */
export default function AgentRankPage() {
  const [agentId, setAgentId] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLookup() {
    if (!agentId.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/agentrank/${encodeURIComponent(agentId)}`);
      if (!res.ok) throw new Error('Agent not found');
      const data = await res.json();
      setResult(data.agentRank);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch AgentRank');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">AgentRank</h1>
      <p className="text-slate-400 text-sm">
        Look up any agent&apos;s trust score. Scores range from 0–1000 with grades S / A / B / C / D / F.
      </p>

      {/* Lookup */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Enter handle, agent ID, or wallet address"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          onClick={handleLookup}
          disabled={loading}
          className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium transition disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Lookup'}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {/* Score Cards */}
      {result && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="AgentRank Score"
              value={result.score}
              icon={Star}
              iconColor="text-yellow-400"
              iconBg="bg-yellow-500/10"
            />
            <MetricCard
              label="Grade"
              value={result.grade}
              icon={Shield}
              iconColor="text-emerald-400"
              iconBg="bg-emerald-500/10"
            />
            <MetricCard
              label="Payment Reliability"
              value={`${(result.factors.paymentReliability * 100).toFixed(0)}%`}
              icon={TrendingUp}
              iconColor="text-blue-400"
              iconBg="bg-blue-500/10"
            />
            <MetricCard
              label="Sybil Flags"
              value={result.sybilFlags.length}
              icon={AlertTriangle}
              iconColor={result.sybilFlags.length > 0 ? 'text-red-400' : 'text-slate-400'}
              iconBg={result.sybilFlags.length > 0 ? 'bg-red-500/10' : 'bg-slate-500/10'}
            />
          </div>

          {/* Factor Breakdown */}
          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
            <h2 className="font-semibold mb-4">Scoring Factors</h2>
            <div className="space-y-3">
              {[
                { label: 'Payment Reliability (40%)', value: result.factors.paymentReliability },
                { label: 'Service Delivery (30%)', value: result.factors.serviceDelivery },
                { label: 'Transaction Volume (15%)', value: result.factors.transactionVolume, isCount: true },
                { label: 'Wallet Age (10%)', value: result.factors.walletAgeDays, suffix: ' days' },
                { label: 'Dispute Rate (5%)', value: result.factors.disputeRate },
              ].map((factor) => (
                <div key={factor.label} className="flex justify-between text-sm">
                  <span className="text-slate-400">{factor.label}</span>
                  <span className="text-white font-mono">
                    {factor.isCount || factor.suffix
                      ? `${factor.value}${factor.suffix || ''}`
                      : `${(factor.value * 100).toFixed(1)}%`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Sybil Flags */}
          {result.sybilFlags.length > 0 && (
            <div className="bg-red-900/20 border border-red-800 p-6 rounded-2xl">
              <h2 className="font-semibold mb-3 text-red-300">⚠ Sybil Resistance Flags</h2>
              <ul className="space-y-1">
                {result.sybilFlags.map((flag: string) => (
                  <li key={flag} className="text-sm text-red-400 font-mono">• {flag}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* AgentRank Methodology */}
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <h2 className="font-semibold mb-3">AgentRank Methodology</h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          AgentRank is a composite trust score (0–1000) computed from five weighted factors:
          Payment Reliability (40%), Service Delivery (30%), Transaction Volume (15%),
          Wallet Age (10%), and Dispute Rate (5%). Sybil resistance is enforced via wallet age
          weighting, minimum stake requirements ($100 USDC), unique counterparty checks, and
          circular trading detection. Each flag reduces the score by up to 10%.
        </p>
      </div>
    </div>
  );
}
