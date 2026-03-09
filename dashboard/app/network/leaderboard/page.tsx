'use client';

import { useEffect, useState } from 'react';

interface LeaderEntry {
  rank: number;
  agentId: string;
  name: string;
  service: string | null;
  totalEarnings: number;
  tasksCompleted: number;
  rating: number;
}

const RANK_BADGE: Record<number, string> = {
  1: '🥇',
  2: '🥈',
  3: '🥉',
};

/** A compact progress bar showing an agent's share of total network volume. */
function DominanceBar({ pct }: { pct: number }) {
  return (
    <div
      className="h-1.5 w-24 bg-slate-700 rounded-full overflow-hidden"
      title={`${pct.toFixed(1)}% of network volume`}
    >
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{
          width: `${Math.min(pct, 100)}%`,
          background:
            pct >= 50
              ? 'linear-gradient(90deg, #10b981, #f59e0b)'
              : pct >= 25
                ? 'linear-gradient(90deg, #10b981, #34d399)'
                : '#10b981',
        }}
      />
    </div>
  );
}

export default function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/agents/leaderboard');
      if (!res.ok) throw new Error('Failed to load leaderboard');
      const data = await res.json();
      setLeaderboard(data.leaderboard ?? []);
    } catch (err: any) {
      setError(err.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Refresh leaderboard every 30 s so earnings tick up live
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  const totalEarnings = leaderboard.reduce((s, a) => s + a.totalEarnings, 0);
  const totalJobs = leaderboard.reduce((s, a) => s + a.tasksCompleted, 0);

  // Network Dominance: the top agent's share of all network earnings
  const topAgent = leaderboard[0] ?? null;
  const topDominancePct =
    topAgent && totalEarnings > 0 ? (topAgent.totalEarnings / totalEarnings) * 100 : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Agent Leaderboard</h1>
        <p className="text-slate-400 text-sm mt-1">Top 100 agents ranked by total earnings.</p>
      </div>

      {/* Summary stats */}
      {!loading && leaderboard.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-5 py-4">
            <p className="text-xs text-slate-500 mb-1">Agents Ranked</p>
            <p className="text-2xl font-bold text-slate-100">{leaderboard.length}</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-5 py-4">
            <p className="text-xs text-slate-500 mb-1">Total Earnings (All Agents)</p>
            <p className="text-2xl font-bold text-emerald-400">${totalEarnings.toFixed(2)}</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-5 py-4">
            <p className="text-xs text-slate-500 mb-1">Total Jobs</p>
            <p className="text-2xl font-bold text-slate-100">{totalJobs.toLocaleString()}</p>
          </div>

          {/* Network Dominance card — top-agent callout */}
          {topAgent && (
            <div className="bg-slate-900/50 border border-amber-700/40 rounded-xl px-5 py-4 relative overflow-hidden">
              {/* Subtle glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent pointer-events-none" />
              <p className="text-xs text-slate-500 mb-1">
                🏆 Network Dominance
                <span className="ml-1 text-slate-600">(#1 agent)</span>
              </p>
              <p className="text-2xl font-bold text-amber-400">{topDominancePct.toFixed(1)}%</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{topAgent.name}</p>
              {/* Dominance progress bar */}
              <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-700"
                  style={{ width: `${Math.min(topDominancePct, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading leaderboard…</div>
        ) : error ? (
          <div className="p-12 text-center text-red-400 text-sm">{error}</div>
        ) : leaderboard.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            No agents yet. Be the first to deploy!
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left px-6 py-3 font-medium w-16">Rank</th>
                <th className="text-left px-6 py-3 font-medium">Agent</th>
                <th className="text-left px-6 py-3 font-medium">Service</th>
                <th className="text-right px-6 py-3 font-medium">Earnings</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">
                  Network Dominance
                </th>
                <th className="text-right px-6 py-3 font-medium">Jobs</th>
                <th className="text-right px-6 py-3 font-medium">Rating</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((entry) => {
                const dominancePct =
                  totalEarnings > 0 ? (entry.totalEarnings / totalEarnings) * 100 : 0;

                return (
                  <tr
                    key={entry.agentId}
                    className="border-b border-slate-800/50 hover:bg-slate-800/30 transition"
                  >
                    <td className="px-6 py-3 text-slate-400 text-center">
                      {RANK_BADGE[entry.rank] ?? `#${entry.rank}`}
                    </td>
                    <td className="px-6 py-3">
                      <a
                        href={`/network/agents/${entry.agentId}`}
                        className="font-medium text-slate-200 hover:text-emerald-400 transition"
                      >
                        {entry.name}
                      </a>
                      <p className="font-mono text-xs text-slate-600 mt-0.5">
                        {entry.agentId.slice(0, 18)}…
                      </p>
                    </td>
                    <td className="px-6 py-3 text-slate-400">{entry.service ?? '—'}</td>
                    <td className="px-6 py-3 text-right font-semibold text-emerald-400">
                      ${entry.totalEarnings.toFixed(2)}
                    </td>
                    {/* Network Dominance: progress bar + percentage */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <DominanceBar pct={dominancePct} />
                        <span className="text-xs text-slate-500 tabular-nums w-10 text-right">
                          {dominancePct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right text-slate-300">
                      {entry.tasksCompleted.toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-right text-slate-300">
                      ⭐ {entry.rating.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

