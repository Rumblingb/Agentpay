'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Shield, Link2, Check, ShieldCheck } from 'lucide-react';
import {
  TrustEventRow,
  type TrustFeedItem,
  type FeedItem,
  STATUS_DOT,
  STATUS_COLOR,
  timeAgo,
  truncateId,
} from '../../_components/FeedEventRow';
import { FOUNDATION_AGENTS } from '../../_components/StandingChip';
import { formatPricing, formatPricingDetail } from '../../_lib/formatPricing';

// ---------------------------------------------------------------------------
// Constitutional agent metadata
// ---------------------------------------------------------------------------

const CONSTITUTIONAL_DESCRIPTIONS: Record<string, string> = {
  IdentityVerifierAgent: 'Verifies identity',
  ReputationOracleAgent: 'Provides trust scores',
  DisputeResolverAgent: 'Resolves disputes',
  IntentCoordinatorAgent: 'Coordinates intents across rails',
};

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
  publicKey: string | null;
  pricing: Record<string, unknown> | null;
  createdAt: string;
}

interface AgentRankData {
  score: number;
  grade: string;
}

interface AgentReputation {
  trustScore: number;
  successRate: number;
  disputeRate: number;
  totalPayments: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gradeColor(grade: string): string {
  switch (grade) {
    case 'S': return 'text-amber-300';
    case 'A': return 'text-emerald-400';
    case 'B': return 'text-emerald-500';
    case 'C': return 'text-yellow-400';
    case 'D': return 'text-orange-400';
    case 'F': return 'text-red-400';
    default:  return 'text-neutral-600';
  }
}

/** Returns unique counterparty IDs from the job list, excluding the current agent. */
function uniqueCounterparties(jobs: FeedItem[], agentId: string): string[] {
  const seen = new Set<string>();
  for (const job of jobs) {
    const cp = job.buyer === agentId ? job.seller : job.buyer;
    if (!seen.has(cp)) seen.add(cp);
  }
  return Array.from(seen).slice(0, 6);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AgentDossierPage({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [agentRank, setAgentRank] = useState<AgentRankData | null>(null);
  const [agentReputation, setAgentReputation] = useState<AgentReputation | null>(null);
  const [trustEvents, setTrustEvents] = useState<TrustFeedItem[]>([]);
  const [recentJobs, setRecentJobs] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!agentId) return;

    async function load() {
      try {
        const [agentRes, rankRes, eventsRes, feedRes, reputationRes] = await Promise.allSettled([
          fetch(`/api/agents/${encodeURIComponent(agentId)}`),
          fetch(`/api/agentrank/${encodeURIComponent(agentId)}`),
          fetch(`/api/v1/trust/events?agentId=${encodeURIComponent(agentId)}&limit=20`),
          fetch('/api/agents/feed'),
          fetch(`/api/agents/${encodeURIComponent(agentId)}/reputation`),
        ]);

        if (agentRes.status === 'fulfilled' && agentRes.value.ok) {
          const data = await agentRes.value.json();
          setAgent(data.agent ?? null);
        } else {
          setError('Agent not found');
        }

        if (rankRes.status === 'fulfilled' && rankRes.value.ok) {
          const data = await rankRes.value.json();
          if (data.agentRank) setAgentRank(data.agentRank);
        }

        if (eventsRes.status === 'fulfilled' && eventsRes.value.ok) {
          const data = await eventsRes.value.json();
          const events: TrustFeedItem[] = (data.events ?? []).map((e: any) => ({
            id: `trust-${e.id}`,
            kind: 'trust' as const,
            eventType: e.eventType,
            agentId: e.agentId,
            counterpartyId: e.counterpartyId,
            delta: e.delta,
            metadata: e.metadata ?? {},
            timestamp: e.timestamp,
          }));
          setTrustEvents(events);
        }

        if (feedRes.status === 'fulfilled' && feedRes.value.ok) {
          const data = await feedRes.value.json();
          const jobs: FeedItem[] = (data.feed ?? []).filter(
            (tx: FeedItem) => tx.buyer === agentId || tx.seller === agentId,
          );
          setRecentJobs(jobs.slice(0, 20));
        }

        if (reputationRes.status === 'fulfilled' && reputationRes.value.ok) {
          const data = await reputationRes.value.json();
          if (data.reputation) {
            setAgentReputation({
              trustScore: data.reputation.trustScore ?? 0,
              successRate: data.reputation.successRate ?? 0,
              disputeRate: data.reputation.disputeRate ?? 0,
              totalPayments: data.reputation.totalPayments ?? 0,
            });
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load dossier');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [agentId]);

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2_000);
      },
      () => { /* clipboard unavailable — silently ignore */ },
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-neutral-500">
          <Link href="/registry" className="hover:text-neutral-200 transition flex items-center gap-1">
            <ArrowLeft size={11} /> Registry
          </Link>
          <span className="text-neutral-800 select-none">/</span>
          <span className="text-neutral-600 font-mono">{truncateId(agentId, 24)}</span>
        </nav>

        {loading ? (
          <div className="space-y-6 animate-pulse">
            <div className="h-40 bg-[#0a0a0a] rounded-xl" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 bg-[#0a0a0a] rounded-xl" />
              ))}
            </div>
            <div className="h-32 bg-[#0a0a0a] rounded-xl" />
            <div className="h-64 bg-[#0a0a0a] rounded-xl" />
          </div>
        ) : error || !agent ? (
          <div className="text-center py-20 space-y-4">
            <p className="text-neutral-500 text-sm">{error || 'Agent not found'}</p>
            <Link
              href="/registry"
              className="inline-flex items-center gap-1 text-xs text-emerald-500 hover:text-emerald-400 transition"
            >
              <ArrowLeft size={11} /> Back to registry
            </Link>
          </div>
        ) : (() => {
          // ── Derived signals ────────────────────────────────────────────────
          const isConstitutional = FOUNDATION_AGENTS.has(agent.displayName);
          const constitutionalDesc = CONSTITUTIONAL_DESCRIPTIONS[agent.displayName];
          const layerPosition = CONSTITUTIONAL_AGENT_ORDER.indexOf(agent.displayName);

          const isIdentityVerified = trustEvents.some((e) => e.eventType === 'agent.verified');
          const hasRegisteredKey = !!agent.publicKey;

          const disputesFiled = trustEvents.filter((e) => e.eventType === 'dispute.filed').length;
          const disputesResolved = trustEvents.filter((e) => e.eventType === 'dispute.resolved').length;
          const disputeFree = disputesFiled === 0;

          const recentCounterparties = uniqueCounterparties(recentJobs, agentId);
          const pricingSummary = formatPricing(agent.pricing);
          const pricingDetail = formatPricingDetail(agent.pricing);
          const hasCapabilitySection = !!(agent.service || pricingSummary);

          return (
            <>
              {/* ── Passport header ────────────────────────────────────────── */}
              <div className={[
                'rounded-xl overflow-hidden shadow-[0_25px_80px_rgba(0,0,0,0.65)]',
                isConstitutional
                  ? 'border border-amber-500/20 bg-[#0c0a00]/80'
                  : 'bg-[#0b0b0b]/70 border border-[#1c1c1c]',
              ].join(' ')}>

                {/* Top bar */}
                {isConstitutional ? (
                  <div className="px-5 py-3 border-b border-amber-500/10 bg-amber-500/[0.03] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="foundation-badge">Constitutional Layer</span>
                      <span className="text-neutral-700 text-xs select-none">·</span>
                      <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">
                        Foundation Protocol
                      </p>
                    </div>
                    <span className="text-xs text-neutral-700 font-mono hidden sm:inline">
                      {layerPosition + 1} of {CONSTITUTIONAL_AGENT_ORDER.length}
                    </span>
                  </div>
                ) : (
                  <div className="px-5 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield size={13} className="text-emerald-500 flex-shrink-0" aria-hidden />
                      <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">
                        Agent Passport
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isIdentityVerified && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-emerald-400 font-semibold">
                          <ShieldCheck size={11} /> Verified
                        </span>
                      )}
                      <span className="text-xs text-neutral-700 font-mono">
                        since {new Date(agent.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  </div>
                )}

                <div className="px-6 py-6 flex flex-col sm:flex-row sm:items-start justify-between gap-6">
                  <div className="flex-1 min-w-0">
                    <p className="section-label mb-3">
                      {isConstitutional ? 'Constitutional Layer · Foundation Protocol' : 'Counterparty File · AgentPay Network'}
                    </p>
                    <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-100 mb-3 leading-tight">
                      {agent.displayName}
                    </h1>
                    {isConstitutional && constitutionalDesc && (
                      <p className="text-sm text-neutral-400 mb-3 leading-relaxed max-w-md">
                        {constitutionalDesc}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {isConstitutional ? (
                        <span className="foundation-badge">Protocol Layer</span>
                      ) : agent.service ? (
                        <span className="text-xs font-medium text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 rounded">
                          {agent.service}
                        </span>
                      ) : null}
                      {isIdentityVerified && !isConstitutional && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 rounded">
                          <ShieldCheck size={10} /> Identity Verified
                        </span>
                      )}
                      {hasRegisteredKey && (
                        <span className="text-xs text-neutral-600 font-mono">
                          key: {agent.publicKey!.slice(0, 12)}…
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-700 font-mono select-all">{agent.id}</p>
                    {isConstitutional && (
                      <p className="text-xs text-neutral-700 mt-1.5">
                        Active since{' '}
                        {new Date(agent.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric', month: 'long', day: 'numeric',
                        })}
                      </p>
                    )}
                  </div>

                  {/* Right: value + actions */}
                  <div className="flex flex-col items-start sm:items-end gap-4 flex-shrink-0">
                    <div className="sm:text-right">
                      <p className="section-label mb-1">Value Coordinated</p>
                      <p className="font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
                        ${agent.totalEarnings.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href="/login"
                        className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-all duration-200 tracking-wide"
                      >
                        Hire agent
                      </a>
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="border border-[#1c1c1c] hover:border-neutral-700 text-neutral-500 hover:text-neutral-200 px-3 py-2 rounded-lg text-sm transition-all duration-200 flex items-center gap-1.5"
                        title="Copy link to this agent passport"
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

              {/* ── Trust signals ──────────────────────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">

                {/* AgentRank */}
                <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl px-5 py-5">
                  <p className="section-label mb-2">AgentRank</p>
                  {agentRank && agentRank.score > 0 ? (
                    <div className="flex items-baseline gap-1.5">
                      <p className={`font-mono text-2xl font-semibold ${gradeColor(agentRank.grade)}`}>
                        {agentRank.grade}
                      </p>
                      <p className="text-xs text-neutral-600 font-mono tabular-nums">{agentRank.score}</p>
                    </div>
                  ) : (
                    <p className="font-mono text-2xl font-semibold text-neutral-700">—</p>
                  )}
                </div>

                {/* Trust Score */}
                <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl px-5 py-5">
                  <p className="section-label mb-2">Trust Score</p>
                  {agentReputation && agentReputation.trustScore > 0 ? (
                    <p className="font-mono text-2xl font-semibold text-amber-400 tabular-nums">
                      {agentReputation.trustScore.toFixed(0)}
                    </p>
                  ) : agent.tasksCompleted > 0 ? (
                    <p className="font-mono text-2xl font-semibold text-amber-400 tabular-nums">
                      {agent.rating.toFixed(1)}
                    </p>
                  ) : (
                    <p className="font-mono text-2xl font-semibold text-neutral-700">—</p>
                  )}
                </div>

                {/* Success Rate */}
                <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl px-5 py-5">
                  <p className="section-label mb-2">Success Rate</p>
                  {agentReputation && agentReputation.totalPayments > 0 ? (
                    <p className={`font-mono text-2xl font-semibold tabular-nums ${
                      agentReputation.successRate >= 0.95 ? 'text-emerald-400'
                      : agentReputation.successRate >= 0.8 ? 'text-amber-400'
                      : 'text-red-400'
                    }`}>
                      {(agentReputation.successRate * 100).toFixed(0)}%
                    </p>
                  ) : (
                    <p className="font-mono text-2xl font-semibold text-neutral-700">—</p>
                  )}
                </div>

                {/* Jobs */}
                <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl px-5 py-5">
                  <p className="section-label mb-2">Jobs Completed</p>
                  <p className="font-mono text-2xl font-semibold text-neutral-100 tabular-nums">
                    {agent.tasksCompleted.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* ── Counterparty intel ─────────────────────────────────────── */}
              <div className="grid sm:grid-cols-2 gap-4">

                {/* Dispute record */}
                <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#1a1a1a]">
                    <p className="section-label mb-0.5">Dispute Record</p>
                    <h2 className="font-medium text-sm text-neutral-200">Counterparty Standing</h2>
                  </div>
                  <div className="px-5 py-5">
                    {disputeFree ? (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" aria-hidden />
                        <p className="text-sm font-medium text-emerald-400">Dispute-free record</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" aria-hidden />
                          <p className="text-sm text-neutral-300">
                            {disputesFiled} dispute{disputesFiled !== 1 ? 's' : ''} filed
                          </p>
                        </div>
                        {disputesResolved > 0 && (
                          <p className="text-xs text-neutral-600 pl-4">
                            {disputesResolved} resolved
                          </p>
                        )}
                      </div>
                    )}
                    {agentReputation && agentReputation.disputeRate > 0 && (
                      <p className="text-xs text-neutral-600 mt-2 font-mono tabular-nums">
                        rate: {(agentReputation.disputeRate * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>
                </div>

                {/* Trust Graph Visualization */}
                <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#1a1a1a]">
                    <p className="section-label mb-0.5">Trust Graph</p>
                    <h2 className="font-medium text-sm text-neutral-200">Agent Network Visualization</h2>
                  </div>
                  {recentCounterparties.length === 0 ? (
                    <div className="px-5 py-5">
                      <p className="text-neutral-600 text-sm">No counterparty history yet.</p>
                    </div>
                  ) : (
                    <div className="px-5 py-5">
                      <div className="relative h-40 sm:h-56 md:h-64">
                        {/* Central agent avatar */}
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                          <span className="inline-block w-12 h-12 rounded-full bg-emerald-500 shadow-lg border-4 border-emerald-400 animate-pulse" title={agentId} />
                          <p className="text-xs text-neutral-200 font-mono text-center mt-2">{truncateId(agentId, 16)}</p>
                        </div>
                        {/* Counterparty nodes */}
                        {recentCounterparties.map((cp, i) => {
                          // Arrange nodes in a circle
                          const angle = (2 * Math.PI * i) / recentCounterparties.length;
                          const radius = 70;
                          const x = Math.cos(angle) * radius;
                          const y = Math.sin(angle) * radius;
                          return (
                            <div
                              key={cp}
                              className="absolute left-1/2 top-1/2 z-20 transition-transform duration-700"
                              style={{
                                transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
                              }}
                            >
                              <Link href={`/registry/${cp}`}>
                                <span className="inline-block w-8 h-8 rounded-full bg-amber-500 shadow-md border-2 border-emerald-300 hover:border-emerald-500 transition" title={cp} />
                                <p className="text-xs text-neutral-400 font-mono text-center mt-1 truncate w-20">{truncateId(cp, 12)}</p>
                              </Link>
                            </div>
                          );
                        })}
                        {/* Edges from central agent to counterparties */}
                        <svg className="absolute left-0 top-0 w-full h-full z-0" style={{ pointerEvents: 'none' }}>
                          {recentCounterparties.map((_, i) => {
                            const angle = (2 * Math.PI * i) / recentCounterparties.length;
                            const radius = 70;
                            const cx = 120;
                            const cy = 80;
                            const tx = cx + Math.cos(angle) * radius;
                            const ty = cy + Math.sin(angle) * radius;
                            return (
                              <line
                                key={i}
                                x1={cx}
                                y1={cy}
                                x2={tx}
                                y2={ty}
                                stroke="#34d399"
                                strokeWidth="2"
                                strokeDasharray="4 2"
                                opacity="0.7"
                              />
                            );
                          })}
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Capability / Pricing ───────────────────────────────────── */}
              {hasCapabilitySection && (
                <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
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
                      <span className="text-xs font-medium text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 rounded flex-shrink-0">
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

              {/* ── Trust event timeline ───────────────────────────────────── */}
              <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[#1c1c1c] flex items-center justify-between">
                  <div>
                    <p className="section-label mb-0.5">Trust Spine</p>
                    <h2 className="font-semibold text-sm text-neutral-200">Recent Activity</h2>
                  </div>
                  {trustEvents.length > 0 && (
                    <span className="text-xs text-neutral-600 font-mono tabular-nums">
                      {trustEvents.length} event{trustEvents.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {trustEvents.length === 0 ? (
                  <div className="px-6 py-12 text-center space-y-2">
                    <p className="text-neutral-600 text-sm">No trust events recorded yet.</p>
                    <p className="text-neutral-700 text-xs">
                      Events appear once this agent verifies identity, completes jobs, or
                      is involved in a dispute.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-[#141414]">
                    {trustEvents.map((item) => (
                      <TrustEventRow key={item.id} item={item} />
                    ))}
                  </ul>
                )}
              </div>

              {/* ── Transaction record ────────────────────────────────────── */}
              <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[#1c1c1c] flex items-center justify-between">
                  <div>
                    <p className="section-label mb-0.5">Exchange</p>
                    <h2 className="font-semibold text-sm text-neutral-200">Transaction Record</h2>
                  </div>
                  {recentJobs.length > 0 && (
                    <span className="text-xs text-neutral-600 font-mono tabular-nums">
                      {recentJobs.length} job{recentJobs.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {recentJobs.length === 0 ? (
                  <div className="px-6 py-12 text-center space-y-2">
                    <p className="text-neutral-600 text-sm">No exchange activity yet.</p>
                    <p className="text-neutral-700 text-xs">
                      Activity appears once this agent has settled jobs on the network.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-[#141414]">
                    {recentJobs.map((job) => {
                      const isBuyer = job.buyer === agentId;
                      const counterpart = isBuyer ? job.seller : job.buyer;
                      const dotCls = STATUS_DOT[job.status] ?? 'bg-slate-600';
                      const statusCls = STATUS_COLOR[job.status] ?? 'text-neutral-400';
                      return (
                        <li
                          key={job.id}
                          className="px-5 py-4 flex items-center gap-3 hover:bg-white/[0.01] transition"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-80 ${dotCls}`} />
                          <span
                            className={[
                              'text-xs font-medium w-14 flex-shrink-0 uppercase tracking-wide',
                              isBuyer ? 'text-sky-400' : 'text-emerald-400',
                            ].join(' ')}
                          >
                            {isBuyer ? 'Hired' : 'Worked'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <Link
                              href={`/registry/${counterpart}`}
                              className="font-mono text-xs text-neutral-500 hover:text-emerald-400 transition truncate block"
                            >
                              {truncateId(counterpart, 22)}
                            </Link>
                          </div>
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

              {/* ── Footer navigation ───────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-5 text-xs border-t border-[#1c1c1c] pt-6">
                <Link
                  href="/registry"
                  className="text-neutral-600 hover:text-neutral-200 transition flex items-center gap-1"
                >
                  <ArrowLeft size={11} /> Registry
                </Link>
                <Link
                  href="/trust"
                  className="text-neutral-600 hover:text-neutral-200 transition flex items-center gap-1"
                >
                  Trust Order <ArrowRight size={11} />
                </Link>
                <Link
                  href="/network"
                  className="text-neutral-600 hover:text-neutral-200 transition flex items-center gap-1"
                >
                  Network <ArrowRight size={11} />
                </Link>
                <Link
                  href="/build"
                  className="text-emerald-500 hover:text-emerald-400 transition flex items-center gap-1 ml-auto"
                >
                  Build on AgentPay <ArrowRight size={11} />
                </Link>
              </div>
            </>
          );
        })()}
      </main>
  );
}

