'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Shield } from 'lucide-react';
import {
  TrustEventRow,
  type TrustFeedItem,
  type FeedItem,
  STATUS_DOT,
  STATUS_COLOR,
  timeAgo,
  truncateId,
} from '../../_components/FeedEventRow';

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
  createdAt: string;
}

interface AgentRankData {
  score: number;
  grade: string;
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AgentDossierPage({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [agentRank, setAgentRank] = useState<AgentRankData | null>(null);
  const [trustEvents, setTrustEvents] = useState<TrustFeedItem[]>([]);
  const [recentJobs, setRecentJobs] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!agentId) return;

    async function load() {
      try {
        const [agentRes, rankRes, eventsRes, feedRes] = await Promise.allSettled([
          fetch(`/api/agents/${encodeURIComponent(agentId)}`),
          fetch(`/api/agentrank/${encodeURIComponent(agentId)}`),
          fetch(`/api/v1/trust/events?agentId=${encodeURIComponent(agentId)}&limit=20`),
          fetch('/api/agents/feed'),
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
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load dossier');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [agentId]);

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">

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
            <div className="h-32 bg-[#0a0a0a] rounded-xl" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 bg-[#0a0a0a] rounded-xl" />
              ))}
            </div>
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
        ) : (
          <>
            {/* ── Identity block — counterparty file ──────────────────────── */}
            <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
              {/* Header band */}
              <div className="px-5 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield size={13} className="text-emerald-500 flex-shrink-0" aria-hidden />
                  <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">
                    Operator File
                  </p>
                </div>
                <span className="text-xs text-neutral-700 font-mono">
                  since {new Date(agent.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                </span>
              </div>

              <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-start justify-between gap-5">
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl font-semibold tracking-tight text-neutral-100 mb-2">
                    {agent.displayName}
                  </h1>
                  {agent.service && (
                    <span className="inline-block text-xs font-medium text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 rounded mb-4">
                      {agent.service}
                    </span>
                  )}
                  <p className="text-xs text-neutral-700 font-mono select-all">{agent.id}</p>
                </div>
                <div className="flex flex-col items-start sm:items-end gap-1 flex-shrink-0">
                  <p className="section-label">Value Coordinated</p>
                  <p className="font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
                    ${agent.totalEarnings.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Stats ───────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl px-5 py-5">
                <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-2">AgentRank</p>
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

              <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl px-5 py-5">
                <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-2">Rating</p>
                {agent.tasksCompleted > 0 ? (
                  <p className="font-mono text-2xl font-semibold text-amber-400 tabular-nums">
                    {agent.rating.toFixed(1)}
                  </p>
                ) : (
                  <p className="font-mono text-2xl font-semibold text-neutral-700">—</p>
                )}
              </div>

              <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl px-5 py-5">
                <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-2">Jobs</p>
                <p className="font-mono text-2xl font-semibold text-neutral-100 tabular-nums">
                  {agent.tasksCompleted.toLocaleString()}
                </p>
              </div>

              <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl px-5 py-5">
                <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-2">Trust Events</p>
                <p className="font-mono text-2xl font-semibold text-neutral-100 tabular-nums">
                  {trustEvents.length}
                </p>
              </div>
            </div>

            {/* ── Recent Activity (Trust Event Timeline) ───────────────────── */}
            <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#1c1c1c] flex items-center justify-between">
                <div>
                  <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-0.5">
                    Trust Spine
                  </p>
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

            {/* ── Exchange History (settled jobs) ───────────────────────────── */}
            <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#1c1c1c] flex items-center justify-between">
                <div>
                  <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-0.5">
                    Exchange
                  </p>
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

            {/* ── Footer navigation ────────────────────────────────────────── */}
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
            </div>
          </>
        )}
      </main>
  );
}

