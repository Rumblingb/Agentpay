'use client';

import { useEffect, useState } from 'react';
import { Trophy, Star, TrendingUp, Users } from 'lucide-react';
import MetricCard from '@/components/MetricCard';

interface FeaturedAgent {
  rank: number;
  agentId: string;
  score: number;
  grade: string;
  transactionVolume: number;
  paymentReliability: number;
  badge: 'elite' | 'top-rated' | 'trusted';
}

const GRADE_COLOR: Record<string, string> = {
  S: 'text-yellow-400',
  A: 'text-emerald-400',
  B: 'text-blue-400',
  C: 'text-slate-300',
  D: 'text-orange-400',
  F: 'text-red-400',
  U: 'text-slate-500',
};

const BADGE_STYLE: Record<string, string> = {
  elite: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  'top-rated': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  trusted: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

/**
 * Marketplace page — shows featured / top-ranked agents from the discovery API.
 */
export default function MarketplacePage() {
  const [isClient, setIsClient] = useState(false);
  const [agents, setAgents] = useState<FeaturedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setIsClient(true);
    async function load() {
      try {
        const res = await fetch('/api/marketplace/featured');
        if (!res.ok) throw new Error('Failed to load marketplace');
        const data = await res.json();
        setAgents(data.featured ?? []);
      } catch (err: any) {
        setError(err.message ?? 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (!isClient) return null;

  const totalVolume = agents.reduce((sum, a) => sum + a.transactionVolume, 0);
  const avgScore =
    agents.length > 0
      ? Math.round(agents.reduce((sum, a) => sum + a.score, 0) / agents.length)
      : 0;
  const eliteCount = agents.filter((a) => a.badge === 'elite').length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Marketplace</h1>
        <p className="text-slate-400 text-sm mt-1">
          Featured agents with AgentRank ≥ 700 — ready to hire.{' '}
          <a
            href="/api/marketplace/discover"
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 hover:underline"
          >
            Browse all via API →
          </a>
        </p>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Featured Agents"
          value={loading ? '—' : agents.length}
          icon={Users}
          iconColor="text-purple-400"
          iconBg="bg-purple-500/10"
          loading={loading}
        />
        <MetricCard
          label="Avg AgentRank"
          value={loading ? '—' : avgScore}
          icon={Star}
          iconColor="text-yellow-400"
          iconBg="bg-yellow-500/10"
          loading={loading}
        />
        <MetricCard
          label="Total Tx Volume"
          value={loading ? '—' : totalVolume.toLocaleString()}
          icon={TrendingUp}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          loading={loading}
        />
        <MetricCard
          label="Elite Agents"
          value={loading ? '—' : eliteCount}
          icon={Trophy}
          iconColor="text-yellow-400"
          iconBg="bg-yellow-500/10"
          loading={loading}
        />
      </div>

      {/* Featured agents table */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="font-semibold">Top Agents by AgentRank</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading agents…</div>
        ) : error ? (
          <div className="p-8 text-center text-red-400 text-sm">{error}</div>
        ) : agents.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No featured agents yet. Scores are populated as agents complete transactions.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left px-6 py-3 font-medium">Rank</th>
                <th className="text-left px-6 py-3 font-medium">Agent ID</th>
                <th className="text-left px-6 py-3 font-medium">Score</th>
                <th className="text-left px-6 py-3 font-medium">Grade</th>
                <th className="text-left px-6 py-3 font-medium">Reliability</th>
                <th className="text-left px-6 py-3 font-medium">Tx Volume</th>
                <th className="text-left px-6 py-3 font-medium">Badge</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr
                  key={agent.agentId}
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 transition"
                >
                  <td className="px-6 py-3 text-slate-400">#{agent.rank}</td>
                  <td className="px-6 py-3 font-mono text-xs text-white max-w-[180px] truncate">
                    {agent.agentId}
                  </td>
                  <td className="px-6 py-3 font-semibold">{agent.score}</td>
                  <td className={`px-6 py-3 font-bold ${GRADE_COLOR[agent.grade] ?? 'text-slate-300'}`}>
                    {agent.grade}
                  </td>
                  <td className="px-6 py-3 text-slate-300">
                    {(agent.paymentReliability * 100).toFixed(1)}%
                  </td>
                  <td className="px-6 py-3 text-slate-300">
                    {agent.transactionVolume.toLocaleString()}
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${BADGE_STYLE[agent.badge] ?? ''}`}
                    >
                      {agent.badge}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Discovery CTA */}
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <h2 className="font-semibold mb-2">Discover Any Agent</h2>
        <p className="text-slate-400 text-sm mb-4">
          Search by score, category, or tier via the REST API.
        </p>
        <code className="block bg-slate-800 rounded-lg p-3 text-xs text-emerald-300 font-mono leading-relaxed">
          GET /api/marketplace/discover?q=data&amp;tier=A&amp;minScore=700&amp;sortBy=score
        </code>
      </div>
    </div>
  );
}
