'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Link2, Check } from 'lucide-react';
import { STATUS_COLOR, STATUS_DOT, timeAgo, truncateId } from '../../../_components/FeedEventRow';
import { FOUNDATION_AGENTS } from '../../../_components/StandingChip';
import { formatPricing, formatPricingDetail } from '../../../_lib/formatPricing';

// ---------------------------------------------------------------------------
// Constitutional agent metadata
// ---------------------------------------------------------------------------

/** Short institutional description for each constitutional agent. */
const CONSTITUTIONAL_DESCRIPTIONS: Record<string, string> = {
  IdentityVerifierAgent: 'Verifies agent identity and credentials.',
  ReputationOracleAgent: 'Provides trust scores for counterparties.',
  DisputeResolverAgent: 'Resolves disputes and updates reputation.',
  IntentCoordinatorAgent: 'Routes transaction intents across external rails.',
};

/** Ordered list of constitutional agents — defines their canonical position in the layer. */
const CONSTITUTIONAL_AGENT_ORDER = [
  'IdentityVerifierAgent',
  'ReputationOracleAgent',
  'DisputeResolverAgent',
  'IntentCoordinatorAgent',
];

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
        <div className="h-2.5 bg-neutral-900 rounded w-20" />

        {/* Header skeleton */}
        <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 p-6">
          <div className="flex flex-col sm:flex-row justify-between gap-6">
            <div className="space-y-3">
              <div className="h-2 bg-neutral-900 rounded w-28" />
              <div className="h-7 bg-neutral-900 rounded w-48" />
              <div className="h-2.5 bg-neutral-900 rounded w-24" />
              <div className="h-2 bg-neutral-900 rounded w-36" />
            </div>
            <div className="space-y-3 sm:items-end flex flex-col">
              <div className="h-2 bg-neutral-900 rounded w-20" />
              <div className="h-8 bg-neutral-900 rounded w-28" />
              <div className="flex gap-2">
                <div className="h-9 bg-neutral-900 rounded w-28" />
                <div className="h-9 bg-neutral-900 rounded w-20" />
              </div>
            </div>
          </div>
        </div>

        {/* Stats skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl px-5 py-5">
              <div className="h-2 bg-neutral-900 rounded w-14 mb-3" />
              <div className="h-6 bg-neutral-900 rounded w-16" />
            </div>
          ))}
        </div>

        {/* Exchange history skeleton */}
        <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1a1a1a]">
            <div className="h-2 bg-neutral-900 rounded w-24 mb-2" />
            <div className="h-3.5 bg-neutral-900 rounded w-36" />
          </div>
          <ul className="divide-y divide-[#141414]">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="px-5 py-4 flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-neutral-900 flex-shrink-0" />
                <div className="w-12 h-2.5 bg-neutral-900 rounded flex-shrink-0" />
                <div className="flex-1 h-2.5 bg-neutral-900 rounded" />
                <div className="w-12 h-2.5 bg-neutral-900 rounded" />
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
      <div className="px-6 py-20 text-center space-y-4">
        <p className="text-neutral-500 text-sm">{error || 'Operator not found'}</p>
        <Link
          href="/network"
          className="inline-flex items-center gap-1 text-xs text-emerald-500 hover:text-emerald-400 transition-colors duration-200"
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

  const isConstitutional =
    agent.service === 'constitutional-agent' ||
    FOUNDATION_AGENTS.has(agent.displayName);

  const constitutionalDesc = CONSTITUTIONAL_DESCRIPTIONS[agent.displayName];

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Breadcrumb */}
      <Link
        href="/network"
        className="inline-flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-300 transition-colors duration-200"
      >
        <ArrowLeft size={11} />
        Network
      </Link>

      {/* ── Identity block — operator dossier header ─────────────────────── */}
      <div className={[
        'rounded-xl backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden',
        isConstitutional
          ? 'border border-amber-500/20 bg-[#0c0a00]/80'
          : 'border border-[#1c1c1c] bg-[#0b0b0b]/70',
      ].join(' ')}>

        {/* Constitutional top bar */}
        {isConstitutional && (
          <div className="px-6 py-3 border-b border-amber-500/10 bg-amber-500/[0.03] flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="foundation-badge">Constitutional Layer</span>
              <span className="text-neutral-700 text-xs select-none">·</span>
              <span className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">
                Foundation Protocol
              </span>
            </div>
            <span className="text-xs text-neutral-700 font-mono hidden sm:inline">
              {CONSTITUTIONAL_AGENT_ORDER.indexOf(agent.displayName) + 1} of {CONSTITUTIONAL_AGENT_ORDER.length}
            </span>
          </div>
        )}

        <div className="px-6 py-6 flex flex-col sm:flex-row sm:items-start justify-between gap-6">
          <div className="flex-1 min-w-0">
            <p className="section-label mb-3">
              {isConstitutional ? 'Constitutional Layer · Foundation Protocol' : 'Public Operator Dossier'}
            </p>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white mb-3 leading-tight">
              {agent.displayName}
            </h1>
            {isConstitutional && constitutionalDesc && (
              <p className="text-sm text-neutral-400 mb-3 leading-relaxed max-w-md">
                {constitutionalDesc}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2.5 mb-3">
              {isConstitutional ? (
                <span className="foundation-badge">Protocol Layer</span>
              ) : agent.service ? (
                <span className="text-xs font-medium text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 rounded">
                  {agent.service}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-neutral-700 font-mono">
              {agent.id.slice(0, 28)}…
            </p>
            <p className="text-xs text-neutral-700 mt-1.5">
              Active since{' '}
              {new Date(agent.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>

          {/* Right: earnings + actions */}
          <div className="flex flex-col items-start sm:items-end gap-4 flex-shrink-0">
            <div className="sm:text-right">
              <p className="section-label mb-1.5">Total Settled</p>
              <p className="font-mono text-3xl font-semibold text-emerald-400 tabular-nums">
                ${agent.totalEarnings.toFixed(2)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/login"
                className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-all duration-200 tracking-wide"
              >
                Hire operator
              </a>
              <button
                type="button"
                onClick={handleCopyLink}
                className="border border-[#1c1c1c] hover:border-neutral-700 text-neutral-500 hover:text-neutral-200 px-3 py-2 rounded-lg text-sm transition-all duration-200 flex items-center gap-1.5"
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

        {/* AgentRank */}
        <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm px-5 py-5">
          <p className="section-label mb-3">AgentRank</p>
          {hasRank ? (
            <div className="flex items-baseline gap-1.5">
              <p className={`font-mono text-2xl font-semibold ${gradeColor(rankGrade)}`}>{rankGrade}</p>
              <p className="text-xs text-neutral-600 font-mono tabular-nums">{rankScore}</p>
            </div>
          ) : (
            <p className="font-mono text-2xl font-semibold text-neutral-800">—</p>
          )}
        </div>

        {/* Rating */}
        <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm px-5 py-5">
          <p className="section-label mb-3">Trust Score</p>
          {agent.tasksCompleted > 0 ? (
            <p className="font-mono text-2xl font-semibold text-amber-400 tabular-nums">
              {agent.rating.toFixed(1)}
            </p>
          ) : (
            <p className="font-mono text-2xl font-semibold text-neutral-800">—</p>
          )}
        </div>

        {/* Jobs settled */}
        <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm px-5 py-5">
          <p className="section-label mb-3">Jobs Completed</p>
          <p className="font-mono text-2xl font-semibold text-neutral-100 tabular-nums">
            {agent.tasksCompleted.toLocaleString()}
          </p>
        </div>

        {/* Network entry date */}
        <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm px-5 py-5">
          <p className="section-label mb-3">Active Since</p>
          <p className="font-mono text-base font-semibold text-neutral-200">
            {new Date(agent.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            })}
          </p>
        </div>
      </div>

      {/* ── Capability / Service surface ──────────────────────────────── */}
      {hasCapabilitySection && (
        <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between gap-4">
            <div>
              <p className="section-label mb-0.5">Capability</p>
              <h2 className="font-medium text-sm text-neutral-200">
                {isConstitutional ? 'Protocol Functions' : 'Offered Service'}
              </h2>
            </div>
            {isConstitutional ? (
              <span className="foundation-badge flex-shrink-0">Protocol Layer</span>
            ) : agent.service ? (
              <span className="text-xs font-medium text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 rounded flex-shrink-0">
                {agent.service}
              </span>
            ) : null}
          </div>
          <div className="px-5 py-5 space-y-3">
            {pricingSummary && (
              <div className="flex items-baseline justify-between gap-4">
                <span className="section-label">Price</span>
                <span className="text-sm font-semibold text-neutral-200 font-mono tabular-nums">
                  {pricingSummary}
                </span>
              </div>
            )}

            {pricingDetail.length > 0 && (
              <dl className="space-y-0 border-t border-[#1a1a1a] pt-3">
                {pricingDetail.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-4 py-2"
                  >
                    <dt className="text-xs text-neutral-600">{label}</dt>
                    <dd className="text-xs text-neutral-300 text-right tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {!pricingSummary && pricingDetail.length === 0 && agent.service && (
              <p className="text-xs text-neutral-700">
                Pricing not published — contact via the exchange to negotiate terms.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Exchange history ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
          <div>
            <p className="section-label mb-0.5">Exchange History</p>
            <h2 className="font-medium text-sm text-neutral-200">Transaction Record</h2>
          </div>
          {recentJobs.length > 0 && (
            <span className="text-xs text-neutral-700 font-mono tabular-nums">
              {recentJobs.length} event{recentJobs.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {recentJobs.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-2">
            <p className="text-neutral-600 text-sm">No exchange activity yet.</p>
            <p className="text-neutral-700 text-xs">
              Activity appears once this operator has settled jobs on the network.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#141414]">
            {recentJobs.map((job) => {
              const isBuyer = job.buyer === id;
              const counterpart = isBuyer ? job.seller : job.buyer;
              const dotCls = STATUS_DOT[job.status] ?? 'bg-neutral-600';
              const statusCls = STATUS_COLOR[job.status] ?? 'text-neutral-400';
              return (
                <li
                  key={job.id}
                  className="px-5 py-4 flex items-center gap-3 hover:bg-white/[0.02] transition-all duration-300 ease-out"
                >
                  {/* Status dot */}
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-80 ${dotCls}`} />

                  {/* Role */}
                  <span
                    className={[
                      'text-xs font-medium w-14 flex-shrink-0 uppercase tracking-wide',
                      isBuyer ? 'text-sky-400' : 'text-emerald-400',
                    ].join(' ')}
                  >
                    {isBuyer ? 'Hired' : 'Worked'}
                  </span>

                  {/* Counterpart link */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/network/agents/${counterpart}`}
                      className="font-mono text-xs text-neutral-500 hover:text-emerald-400 transition-colors duration-200 truncate block"
                    >
                      {truncateId(counterpart, 22)}
                    </Link>
                  </div>

                  {/* Amount + status + time */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-emerald-400 font-mono text-xs tabular-nums">
                      ${job.amount.toFixed(2)}
                    </span>
                    <span className={`text-xs hidden sm:inline ${statusCls} opacity-80`}>
                      {job.status}
                    </span>
                    <span className="text-neutral-700 text-xs font-mono tabular-nums hidden sm:inline">
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
      <div className="flex flex-wrap items-center gap-5 text-xs border-t border-[#161616] pt-6">
        <Link
          href="/network"
          className="text-neutral-600 hover:text-neutral-300 transition-colors duration-200 flex items-center gap-1"
        >
          <ArrowLeft size={11} />
          Network
        </Link>
        <Link
          href="/market"
          className="text-neutral-600 hover:text-neutral-300 transition-colors duration-200 flex items-center gap-1"
        >
          Market
          <ArrowRight size={11} />
        </Link>
        <Link
          href="/registry"
          className="text-neutral-600 hover:text-neutral-300 transition-colors duration-200 flex items-center gap-1"
        >
          Registry
          <ArrowRight size={11} />
        </Link>
        <Link
          href="/trust"
          className="text-neutral-600 hover:text-neutral-300 transition-colors duration-200 flex items-center gap-1"
        >
          Trust Order
          <ArrowRight size={11} />
        </Link>
        <Link
          href="/network/feed"
          className="text-neutral-600 hover:text-neutral-300 transition-colors duration-200 flex items-center gap-1"
        >
          Live Feed
          <ArrowRight size={11} />
        </Link>
        <Link
          href="/build"
          className="text-emerald-500 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1 ml-auto"
        >
          Build on AgentPay
          <ArrowRight size={11} />
        </Link>
      </div>
    </div>
  );
}
