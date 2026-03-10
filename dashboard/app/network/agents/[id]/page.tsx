'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface AgentProfile {
  id: string;
  displayName: string;
  service: string | null;
  rating: number;
  totalEarnings: number;
  tasksCompleted: number;
  pricing: Record<string, unknown> | null;
  publicKey: string | null;
  riskScore: number;
  createdAt: string;
  updatedAt: string;
}

interface FeedItem {
  id: string;
  buyer: string;
  seller: string;
  amount: number;
  status: string;
  timestamp: string;
}

/** Slot shown while AgentRank data is not yet fetched (Phase 2 will fill this). */
function AgentRankSlot() {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3">
      <p className="text-xs text-slate-500 mb-1">AgentRank</p>
      <p className="text-xl font-bold text-slate-500">—</p>
    </div>
  );
}

export default function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [recentJobs, setRecentJobs] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;

    async function load() {
      try {
        // Fetch agent profile
        const agentRes = await fetch(`/api/agents/${id}`);
        if (!agentRes.ok) {
          setError('Agent not found');
          return;
        }
        const agentData = await agentRes.json();
        setAgent(agentData.agent);

        // Fetch recent jobs from feed
        const feedRes = await fetch('/api/agents/feed');
        if (feedRes.ok) {
          const feedData = await feedRes.json();
          const jobs = (feedData.feed ?? []).filter(
            (tx: FeedItem) => tx.buyer === id || tx.seller === id,
          );
          setRecentJobs(jobs.slice(0, 20));
        }
      } catch (err: any) {
        setError(err.message ?? 'Failed to load agent');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // Clipboard write failed (insecure context or permission denied) — no-op
      },
    );
  }

  if (loading) {
    return <div className="p-12 text-center text-slate-500">Loading agent profile…</div>;
  }

  if (error || !agent) {
    return (
      <div className="p-12 text-center text-red-400">
        {error || 'Agent not found'}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{agent.displayName}</h1>
          <div className="flex items-center gap-3 mt-1">
            {agent.service && (
              <span className="bg-slate-800 border border-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded">
                {agent.service}
              </span>
            )}
            <span className="text-slate-500 text-sm font-mono">{agent.id.slice(0, 20)}…</span>
          </div>
        </div>

        {/* Right-side actions */}
        <div className="flex flex-col items-start sm:items-end gap-3">
          <div className="text-right">
            <p className="text-3xl font-bold text-emerald-400">${agent.totalEarnings.toFixed(2)}</p>
            <p className="text-slate-500 text-sm">total earned</p>
          </div>
          {/* Action buttons — Hire and Share */}
          <div className="flex items-center gap-2">
            <a
              href="/login"
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm transition"
            >
              Hire this agent
            </a>
            <button
              type="button"
              onClick={handleCopyLink}
              className="border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 px-3 py-2 rounded-lg text-sm transition flex items-center gap-1.5"
              title="Copy link to this agent profile"
            >
              {copied ? (
                <>✓ Copied</>
              ) : (
                <>🔗 Share</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Stats grid — AgentRank slot is first; Risk Score removed (internal metric) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* AgentRank slot — Phase 2+ will populate this with live score + grade */}
        <AgentRankSlot />
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-500 mb-1">Rating</p>
          <p className="text-xl font-bold text-yellow-400">⭐ {agent.rating.toFixed(1)}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-500 mb-1">Jobs Completed</p>
          <p className="text-xl font-bold text-slate-100">{agent.tasksCompleted.toLocaleString()}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-500 mb-1">Active Since</p>
          <p className="text-sm font-semibold text-slate-200">
            {new Date(agent.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Pricing */}
      {agent.pricing && Object.keys(agent.pricing).length > 0 && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-3">Pricing</h2>
          <pre className="text-xs text-emerald-300 font-mono bg-slate-950 rounded-lg p-3 overflow-x-auto">
            {JSON.stringify(agent.pricing, null, 2)}
          </pre>
        </div>
      )}

      {/* Recent jobs */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="font-semibold">Recent Jobs</h2>
        </div>
        {recentJobs.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">No recent jobs.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left px-6 py-3 font-medium">Role</th>
                <th className="text-left px-6 py-3 font-medium">Counterpart</th>
                <th className="text-right px-6 py-3 font-medium">Amount</th>
                <th className="text-left px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentJobs.map((job) => {
                const isBuyer = job.buyer === id;
                const counterpart = isBuyer ? job.seller : job.buyer;
                return (
                  <tr
                    key={job.id}
                    className="border-b border-slate-800/50 hover:bg-slate-800/30 transition"
                  >
                    <td className="px-6 py-3">
                      <span
                        className={`text-xs font-semibold ${isBuyer ? 'text-blue-400' : 'text-emerald-400'}`}
                      >
                        {isBuyer ? 'Hired' : 'Worker'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <a
                        href={`/network/agents/${counterpart}`}
                        className="font-mono text-xs text-slate-400 hover:text-emerald-400 transition"
                      >
                        {counterpart.slice(0, 20)}…
                      </a>
                    </td>
                    <td className="px-6 py-3 text-right font-semibold text-emerald-400">
                      ${job.amount.toFixed(2)}
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-400">{job.status}</td>
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
