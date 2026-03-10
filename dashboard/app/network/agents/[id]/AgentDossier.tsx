'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Link2, Check } from 'lucide-react';
import { STATUS_COLOR, STATUS_DOT, timeAgo, truncateId } from '../../../_components/FeedEventRow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentProfile {
  id: string;
  displayName: string;
  service: string | null;
  rating: number;
  totalEarnings: number;
  tasksCompleted: number;
  pricing: Record<string, unknown> | null;
  publicKey: string | null;
  createdAt: string;
}

interface FeedItem {
  id: string;
  buyer: string;
  seller: string;
  amount: number;
  status: string;
  timestamp: string;
}

interface AgentRank {
  score: number;
  grade: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps AgentRank grade to a Tailwind text-color class. */
function gradeColor(grade: string): string {
  switch (grade) {
    case 'S': return 'text-amber-300';
    case 'A': return 'text-emerald-400';
    case 'B': return 'text-emerald-500';
    case 'C': return 'text-yellow-400';
    case 'D': return 'text-orange-400';
    case 'F': return 'text-red-400';
    default:  return 'text-slate-600';
  }
}

/** Prettifies a camelCase key into a readable label. */
function prettifyKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AgentDossier({ id }: { id: string }) {
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [recentJobs, setRecentJobs] = useState<FeedItem[]>([]);
  const [agentRank, setAgentRank] = useState<AgentRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;

    async function load() {
      try {
        const [agentRes, feedRes, rankRes] = await Promise.all([
          fetch(`/api/agents/${id}`),
          fetch('/api/agents/feed'),
          fetch(`/api/agentrank/${encodeURIComponent(id)}`),
        ]);

        if (!agentRes.ok) {
          setError('Operator not found');
          return;
        }

        const agentData = await agentRes.json();
        setAgent(agentData.agent);

        if (feedRes.ok) {
          const feedData = await feedRes.json();
          const jobs = (feedData.feed ?? []).filter(
            (tx: FeedItem) => tx.buyer === id || tx.seller === id,
          );
          setRecentJobs(jobs.slice(0, 20));
        }

        if (rankRes.ok) {
          const rankData = await rankRes.json();
          if (rankData.agentRank) {
            setAgentRank(rankData.agentRank);
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load operator dossier');
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
        // Clipboard write failed — silently ignore
      },
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse max-w-4xl">
        {/* Breadcrumb skeleton */}
        <div className="h-3 bg-slate-800 rounded w-28" />

        {/* Header skeleton */}
        <div className="flex flex-col sm:flex-row justify-between gap-6">
          <div className="space-y-2">
            <div className="h-2.5 bg-slate-800 rounded w-36" />
            <div className="h-7 bg-slate-800 rounded w-48" />
            <div className="h-3 bg-slate-800 rounded w-24" />
            <div className="h-2.5 bg-slate-800 rounded w-32" />
          </div>
          <div className="space-y-2 sm:items-end flex flex-col">
            <div className="h-8 bg-slate-800 rounded w-28" />
            <div className="h-2.5 bg-slate-800 rounded w-16" />
            <div className="flex gap-2">
              <div className="h-9 bg-slate-800 rounded w-28" />
              <div className="h-9 bg-slate-800 rounded w-20" />
            </div>
          </div>
        </div>

        {/* Stats skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3">
              <div className="h-2.5 bg-slate-800 rounded w-16 mb-2" />
              <div className="h-6 bg-slate-800 rounded w-20" />
            </div>
          ))}
        </div>

        {/* Exchange history skeleton */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800">
            <div className="h-2.5 bg-slate-800 rounded w-28 mb-1.5" />
            <div className="h-4 bg-slate-800 rounded w-36" />
          </div>
          <ul className="divide-y divide-slate-800/50">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="px-5 py-3.5 flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-800 flex-shrink-0" />
                <div className="w-12 h-3 bg-slate-800 rounded flex-shrink-0" />
                <div className="flex-1 h-3 bg-slate-800 rounded" />
                <div className="w-14 h-3 bg-slate-800 rounded" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // ── Error / not found ──────────────────────────────────────────────────────

  if (error || !agent) {
    return (
      <div className="px-6 py-16 text-center space-y-4">
        <p className="text-slate-400 text-sm">{error || 'Operator not found'}</p>
        <Link
          href="/network/leaderboard"
          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition"
        >
          <ArrowLeft size={11} />
          Back to operator registry
        </Link>
      </div>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const hasRank = agentRank !== null && agentRank.score > 0;
  const rankGrade = agentRank?.grade ?? 'U';
  const rankScore = agentRank?.score ?? 0;
  const hasPricing =
    agent.pricing !== null &&
    agent.pricing !== undefined &&
    Object.keys(agent.pricing).length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 max-w-4xl">

      {/* Breadcrumb */}
      <Link
        href="/network/leaderboard"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition"
      >
        <ArrowLeft size={11} />
        Operator Registry
      </Link>

      {/* ── Identity block ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-1.5">
            Public operator dossier
          </p>
          <h1 className="text-2xl font-bold text-slate-100">{agent.displayName}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {agent.service && (
              <span className="bg-slate-800 border border-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded">
                {agent.service}
              </span>
            )}
            <span className="text-slate-600 text-xs font-mono">
              {agent.id.slice(0, 24)}…
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            Active since{' '}
            {new Date(agent.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>

        {/* Right: earnings + actions */}
        <div className="flex flex-col items-start sm:items-end gap-3 flex-shrink-0">
          <div className="sm:text-right">
            <p className="text-3xl font-bold text-emerald-400 tabular-nums">
              ${agent.totalEarnings.toFixed(2)}
            </p>
            <p className="text-xs text-slate-500">total settled</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/login"
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm transition"
            >
              Hire operator
            </a>
            <button
              type="button"
              onClick={handleCopyLink}
              className="border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 px-3 py-2 rounded-lg text-sm transition flex items-center gap-1.5"
              title="Copy link to this operator dossier"
            >
              {copied ? (
                <><Check size={13} /> Copied</>
              ) : (
                <><Link2 size={13} /> Share</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Standing / stats grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">

        {/* AgentRank — live score from /api/agentrank/:id */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-500 mb-1">AgentRank</p>
          {hasRank ? (
            <div className="flex items-baseline gap-1.5">
              <p className={`text-xl font-bold ${gradeColor(rankGrade)}`}>{rankGrade}</p>
              <p className="text-xs text-slate-500 tabular-nums">{rankScore}</p>
            </div>
          ) : (
            <p className="text-xl font-bold text-slate-600">—</p>
          )}
        </div>

        {/* Rating — honest: only shown when the operator has settled jobs */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-500 mb-1">Rating</p>
          {agent.tasksCompleted > 0 ? (
            <p className="text-xl font-bold text-amber-400">⭐ {agent.rating.toFixed(1)}</p>
          ) : (
            <p className="text-xl font-bold text-slate-600">—</p>
          )}
        </div>

        {/* Jobs settled */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-500 mb-1">Jobs Settled</p>
          <p className="text-xl font-bold text-slate-100">
            {agent.tasksCompleted.toLocaleString()}
          </p>
        </div>

        {/* Network entry date */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-500 mb-1">On Network Since</p>
          <p className="text-sm font-semibold text-slate-200">
            {new Date(agent.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            })}
          </p>
        </div>
      </div>

      {/* ── Service model / pricing ──────────────────────────────────────── */}
      {hasPricing && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-0.5">
              Service Model
            </p>
            <h2 className="font-semibold text-sm text-slate-200">Pricing</h2>
          </div>
          <div className="px-6 py-4">
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-0">
              {Object.entries(agent.pricing!).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-baseline justify-between gap-4 py-2 border-b border-slate-800/50 last:border-0"
                >
                  <dt className="text-xs text-slate-500">{prettifyKey(key)}</dt>
                  <dd className="text-sm font-semibold text-slate-200 text-right tabular-nums">
                    {typeof value === 'number'
                      ? value
                      : typeof value === 'string'
                        ? value
                        : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* ── Exchange history ─────────────────────────────────────────────── */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-0.5">
              Exchange History
            </p>
            <h2 className="font-semibold text-sm text-slate-200">Recent Activity</h2>
          </div>
          {recentJobs.length > 0 && (
            <span className="text-xs text-slate-600">
              {recentJobs.length} event{recentJobs.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {recentJobs.length === 0 ? (
          <div className="px-6 py-10 text-center space-y-2">
            <p className="text-slate-500 text-sm">No exchange activity yet.</p>
            <p className="text-slate-600 text-xs">
              Activity appears once this operator has settled jobs on the network.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/50">
            {recentJobs.map((job) => {
              const isBuyer = job.buyer === id;
              const counterpart = isBuyer ? job.seller : job.buyer;
              const dotCls = STATUS_DOT[job.status] ?? 'bg-slate-500';
              const statusCls = STATUS_COLOR[job.status] ?? 'text-slate-400';
              return (
                <li
                  key={job.id}
                  className="px-5 py-3.5 flex items-center gap-3 hover:bg-slate-800/20 transition"
                >
                  {/* Status dot */}
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotCls}`} />

                  {/* Role */}
                  <span
                    className={[
                      'text-xs font-semibold w-14 flex-shrink-0',
                      isBuyer ? 'text-blue-400' : 'text-emerald-400',
                    ].join(' ')}
                  >
                    {isBuyer ? 'Hired' : 'Worked'}
                  </span>

                  {/* Counterpart link */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/network/agents/${counterpart}`}
                      className="font-mono text-xs text-slate-400 hover:text-emerald-400 transition truncate block"
                    >
                      {truncateId(counterpart, 22)}
                    </Link>
                  </div>

                  {/* Amount + status + time */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-emerald-400 font-semibold text-xs tabular-nums">
                      ${job.amount.toFixed(2)}
                    </span>
                    <span className={`text-xs font-medium hidden sm:inline ${statusCls}`}>
                      {job.status}
                    </span>
                    <span className="text-slate-600 text-xs tabular-nums hidden sm:inline">
                      {timeAgo(job.timestamp)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Footer navigation ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-5 text-xs border-t border-slate-800 pt-6">
        <Link
          href="/network"
          className="text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
        >
          <ArrowLeft size={11} />
          Network
        </Link>
        <Link
          href="/network/leaderboard"
          className="text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
        >
          Operator Registry
          <ArrowRight size={11} />
        </Link>
        <Link
          href="/network/feed"
          className="text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
        >
          Transaction Stream
          <ArrowRight size={11} />
        </Link>
      </div>
    </div>
  );
}
