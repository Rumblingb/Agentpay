'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Link2, Check } from 'lucide-react';
import { STATUS_COLOR, STATUS_DOT, timeAgo, truncateId } from '../../../_components/FeedEventRow';
import { formatPricing, formatPricingDetail } from '../../../_lib/formatPricing';

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
          href="/network"
          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition"
        >
          <ArrowLeft size={11} />
          Back to network
        </Link>
      </div>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const hasRank = agentRank !== null && agentRank.score > 0;
  const rankGrade = agentRank?.grade ?? 'U';
  const rankScore = agentRank?.score ?? 0;

  const pricingSummary = formatPricing(agent.pricing);
  const pricingDetail = formatPricingDetail(agent.pricing);
  const hasCapabilitySection = !!(agent.service || pricingSummary);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isConstitutional = agent.service === 'constitutional-agent';

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Breadcrumb */}
      <Link
        href="/network"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition"
      >
        <ArrowLeft size={11} />
        Network
      </Link>

      {/* ── Identity block ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm shadow-[0_10px_40px_rgba(0,0,0,0.4)] overflow-hidden">
        <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-start justify-between gap-5">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">
              Public operator dossier
            </p>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-100 mb-2">
              {agent.displayName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {agent.service && (
                <span className="text-xs font-medium text-emerald-400/90 bg-emerald-500/8 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">
                  {agent.service}
                </span>
              )}
              <span className="text-slate-700 text-xs font-mono">
                {agent.id.slice(0, 20)}…
              </span>
            </div>
            <p className="text-xs text-slate-600">
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
              <p className="font-mono text-3xl font-semibold text-emerald-400 tabular-nums">
                ${agent.totalEarnings.toFixed(2)}
              </p>
              <p className="text-xs text-slate-500 uppercase tracking-wide mt-0.5">total settled</p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/login"
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm transition-all duration-200"
              >
                Hire operator
              </a>
              <button
                type="button"
                onClick={handleCopyLink}
                className="border border-slate-800 hover:border-slate-600 text-slate-400 hover:text-slate-200 px-3 py-2 rounded-lg text-sm transition-all duration-200 flex items-center gap-1.5"
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
      </div>

      {/* ── Stats grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

        {/* AgentRank — live score from /api/agentrank/:id */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm px-5 py-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">AgentRank</p>
          {hasRank ? (
            <div className="flex items-baseline gap-1.5">
              <p className={`font-mono text-xl font-semibold ${gradeColor(rankGrade)}`}>{rankGrade}</p>
              <p className="text-xs text-slate-500 font-mono tabular-nums">{rankScore}</p>
            </div>
          ) : (
            <p className="font-mono text-xl font-semibold text-slate-600">—</p>
          )}
        </div>

        {/* Rating — honest: only shown when the operator has settled jobs */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm px-5 py-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Rating</p>
          {agent.tasksCompleted > 0 ? (
            <p className="font-mono text-xl font-semibold text-amber-400 tabular-nums">
              {agent.rating.toFixed(1)}
            </p>
          ) : (
            <p className="font-mono text-xl font-semibold text-slate-600">—</p>
          )}
        </div>

        {/* Jobs settled */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm px-5 py-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Jobs Completed</p>
          <p className="font-mono text-xl font-semibold text-slate-100 tabular-nums">
            {agent.tasksCompleted.toLocaleString()}
          </p>
        </div>

        {/* Network entry date */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm px-5 py-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Active Since</p>
          <p className="text-sm font-semibold text-slate-200">
            {new Date(agent.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            })}
          </p>
        </div>
      </div>

      {/* ── Capability / Service surface ──────────────────────────────── */}
      {hasCapabilitySection && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm shadow-[0_10px_40px_rgba(0,0,0,0.4)] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-0.5">
                Capability
              </p>
              <h2 className="font-medium text-sm text-slate-200">Offered Service</h2>
            </div>
            {agent.service && (
              <span className="text-xs font-medium text-emerald-400/90 bg-emerald-500/8 border border-emerald-500/20 px-3 py-1 rounded-full flex-shrink-0">
                {agent.service}
              </span>
            )}
          </div>
          <div className="px-5 py-4 space-y-3">
            {pricingSummary && (
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Price</span>
                <span className="text-sm font-semibold text-slate-200 font-mono tabular-nums">
                  {pricingSummary}
                </span>
              </div>
            )}

            {pricingDetail.length > 0 && (
              <dl className="space-y-0 border-t border-slate-800/50 pt-3">
                {pricingDetail.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-4 py-1.5"
                  >
                    <dt className="text-xs text-slate-500">{label}</dt>
                    <dd className="text-xs text-slate-300 text-right tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {!pricingSummary && pricingDetail.length === 0 && agent.service && (
              <p className="text-xs text-slate-600">
                Pricing not published — contact via the exchange to negotiate terms.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Exchange history ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm shadow-[0_10px_40px_rgba(0,0,0,0.4)] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-0.5">
              Exchange History
            </p>
            <h2 className="font-medium text-sm text-slate-200">Recent Activity</h2>
          </div>
          {recentJobs.length > 0 && (
            <span className="text-xs text-slate-600 font-mono tabular-nums">
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
                    <span className="text-emerald-400 font-mono font-semibold text-xs tabular-nums">
                      ${job.amount.toFixed(2)}
                    </span>
                    <span className={`text-xs font-medium hidden sm:inline ${statusCls}`}>
                      {job.status}
                    </span>
                    <span className="text-slate-600 text-xs font-mono tabular-nums hidden sm:inline">
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
          href="/market"
          className="text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
        >
          Market
          <ArrowRight size={11} />
        </Link>
        <Link
          href="/registry"
          className="text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
        >
          Registry
          <ArrowRight size={11} />
        </Link>
        <Link
          href="/trust"
          className="text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
        >
          Trust Order
          <ArrowRight size={11} />
        </Link>
        <Link
          href="/network/feed"
          className="text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
        >
          Live Feed
          <ArrowRight size={11} />
        </Link>
        <Link
          href="/build"
          className="text-emerald-500 hover:text-emerald-400 transition flex items-center gap-1 ml-auto"
        >
          Build on AgentPay
          <ArrowRight size={11} />
        </Link>
      </div>
    </div>
  );
}
