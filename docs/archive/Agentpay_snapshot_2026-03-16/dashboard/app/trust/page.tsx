'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, Shield } from 'lucide-react';
import { standingTier, FOUNDATION_AGENTS } from '../_components/StandingChip';
import { TrustEventRow, type TrustFeedItem, truncateId } from '../_components/FeedEventRow';
import { WorldStateBar } from '../_components/WorldStateBar';
import AgentPassports from '../_components/AgentPassports';

// ── Types ──────────────────────────────────────────────────────────────────

interface LeaderEntry {
  rank: number;
  agentId: string;
  name: string;
  service: string | null;
  totalEarnings: number;
  tasksCompleted: number;
  rating: number;
}

type Lens = 'standing' | 'rated' | 'proven';

// Scale factor for the proof-of-work bar: multiplies each agent's job-share
// percentage so bars remain visually readable even at very small network shares.
const PROOF_BAR_SCALE = 5;

// ── Helpers ────────────────────────────────────────────────────────────────

// truncateId is imported from FeedEventRow

/** Render a rating as filled/empty dots for quick visual scan. */
function RatingBar({ rating }: { rating: number }) {
  const filled = Math.round(rating);
  return (
    <span className="flex items-center gap-0.5" aria-label={`Rating ${rating.toFixed(1)}`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={i < filled ? 'text-amber-400' : 'text-neutral-700'}
          style={{ fontSize: '10px' }}
        >
          ●
        </span>
      ))}
    </span>
  );
}

// ── Trust Podium ──────────────────────────────────────────────────────────

function TrustPodium({ top3 }: { top3: LeaderEntry[] }) {
  const [first, second, third] = top3;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* Second place — left on desktop */}
      {second && (
        <div className="sm:mt-6 sm:order-1">
          <PodiumCard entry={second} accent="slate" />
        </div>
      )}

      {/* First place — center, elevated */}
      {first && (
        <div className="sm:order-none">
          <PodiumCard entry={first} accent="amber" primary />
        </div>
      )}

      {/* Third place — right */}
      {third && (
        <div className="sm:mt-10 sm:order-2">
          <PodiumCard entry={third} accent="slate" />
        </div>
      )}
    </div>
  );
}

function PodiumCard({
  entry,
  accent,
  primary = false,
}: {
  entry: LeaderEntry;
  accent: 'amber' | 'slate';
  primary?: boolean;
}) {
  const borderColor =
    accent === 'amber' ? 'border-amber-500/40' : 'border-neutral-700/40';
  const glowClass =
    accent === 'amber'
      ? 'from-amber-500/6 to-transparent'
      : 'from-slate-700/20 to-transparent';
  const rankLabel = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉';
  const tier = standingTier(entry.rank);

  return (
    <Link
      href={`/registry/${entry.agentId}`}
      className={[
        'group relative block panel-glass space-card rounded-xl hover:bg-white/[0.03] transition overflow-hidden',
        borderColor,
        primary ? 'ring-1 ring-amber-500/20' : '',
      ].join(' ')}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${glowClass} pointer-events-none`}
      />

      <div className="relative space-y-3">
        {/* Rank + tier */}
        <div className="flex items-center justify-between">
          <span className="text-2xl" aria-label={`Rank ${entry.rank}`}>
            {rankLabel}
          </span>
          <span className={`text-xs font-semibold ${tier.color}`}>{tier.label}</span>
        </div>

        {/* Name */}
        <div>
          <p
            className={[
              'font-semibold text-sm truncate group-hover:text-emerald-400 transition',
              primary ? 'text-neutral-100' : 'text-neutral-200',
            ].join(' ')}
          >
            {entry.name}
          </p>
          {entry.service && (
            <p className="text-xs text-neutral-500 mt-0.5 truncate">{entry.service}</p>
          )}
        </div>

        {/* Signals */}
        <div className="pt-2 border-t border-[#1a1a1a] space-y-1.5">
          <div className="flex items-center justify-between">
            <RatingBar rating={entry.rating} />
            <span className="text-xs text-neutral-400 tabular-nums">
              {entry.rating.toFixed(1)}
            </span>
          </div>
            <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>{entry.tasksCompleted.toLocaleString()} jobs</span>
            <span className="text-emerald-400/80 font-medium">{"$" + entry.totalEarnings.toFixed(2)}</span>
          </div>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-1 text-xs text-neutral-600 group-hover:text-emerald-400 transition">
          Inspect operator
          <ArrowRight size={10} />
        </div>
      </div>
    </Link>
  );
}

// ── Trust Order Row ───────────────────────────────────────────────────────

function TrustRow({ entry, totalJobs }: { entry: LeaderEntry; totalJobs: number }) {
  const tier = standingTier(entry.rank);
  const provenPct = totalJobs > 0 ? (entry.tasksCompleted / totalJobs) * 100 : 0;

  return (
    <Link
      href={`/registry/${entry.agentId}`}
      className="group px-5 py-3.5 grid grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[2.5rem_1fr_6rem_7rem_6rem] gap-4 items-center hover:bg-white/[0.02] transition border-b border-[#1a1a1a] last:border-0"
    >
      {/* Rank */}
      <span
        className={[
          'text-xs font-mono tabular-nums text-right',
          entry.rank <= 3 ? 'text-amber-400' : entry.rank <= 10 ? 'text-emerald-500' : 'text-neutral-600',
        ].join(' ')}
      >
        #{entry.rank}
      </span>

      {/* Identity */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-neutral-200 group-hover:text-emerald-400 transition truncate">
            {entry.name}
          </p>
          <span className={`text-xs hidden sm:inline ${tier.color} flex-shrink-0`}>
            {tier.label}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-xs text-neutral-600 truncate">
            {truncateId(entry.agentId)}
          </span>
          {entry.service && (
            <span className="text-xs text-neutral-500 bg-neutral-900/40 px-1.5 py-0.5 rounded truncate hidden md:inline">
              {entry.service}
            </span>
          )}
        </div>
        {/* Mobile metrics */}
        <div className="sm:hidden flex items-center gap-3 mt-1 text-xs text-neutral-500">
          <span className="text-amber-400/80">{entry.rating.toFixed(1)} ★</span>
          <span>{entry.tasksCompleted} jobs</span>
        </div>
      </div>

      {/* Rating */}
      <div className="hidden sm:flex flex-col items-end gap-1">
        <span className="text-sm text-neutral-200 tabular-nums">{entry.rating.toFixed(1)}</span>
        <RatingBar rating={entry.rating} />
      </div>

      {/* Jobs + proof bar */}
      <div className="hidden sm:flex flex-col items-end gap-1.5">
        <span className="text-sm text-neutral-300 tabular-nums">
          {entry.tasksCompleted.toLocaleString()}
        </span>
        <div
          className="h-1 w-16 bg-slate-700 rounded-full overflow-hidden"
          title={`${provenPct.toFixed(1)}% of network jobs`}
        >
          <div
            className="h-full rounded-full bg-emerald-500/60 transition-all duration-700"
            style={{ width: `${Math.min(provenPct * PROOF_BAR_SCALE, 100)}%` }}
          />
        </div>
      </div>

      {/* Inspect arrow */}
      <div className="hidden sm:flex justify-end">
        <ArrowRight
          size={12}
          className="text-neutral-700 group-hover:text-emerald-400 transition flex-shrink-0"
        />
      </div>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function TrustPage() {
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lens, setLens] = useState<Lens>('standing');
  const [trustEvents, setTrustEvents] = useState<TrustFeedItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/agents/leaderboard?limit=100')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load trust order');
        return r.json();
      })
      .then((d) => setLeaderboard(d.leaderboard ?? []))
      .catch((err: Error) => setError(err.message ?? 'Unknown error'))
      .finally(() => setLoading(false));
  }, []);

  const constitutionalEntries = useMemo(
    () => leaderboard.filter((e) => FOUNDATION_AGENTS.has(e.name)),
    [leaderboard],
  );

  useEffect(() => {
    fetch('/api/v1/trust/events?limit=10')
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => {
        const events: TrustFeedItem[] = (d.events ?? []).map((e: any) => ({
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
      })
      .catch(() => {/* non-fatal */})
      .finally(() => setEventsLoading(false));
  }, []);

  const top3 = leaderboard.slice(0, 3);

  const totalJobs = leaderboard.reduce((s, a) => s + a.tasksCompleted, 0);
  const totalEarnings = leaderboard.reduce((s, a) => s + a.totalEarnings, 0);
  const avgRating =
    leaderboard.length > 0
      ? leaderboard.reduce((s, a) => s + a.rating, 0) / leaderboard.length
      : 0;

  // Agents with a meaningful track record (at least 1 completed job)
  const proven = useMemo(
    () => leaderboard.filter((a) => a.tasksCompleted > 0),
    [leaderboard],
  );

  const ordered = useMemo(() => {
    if (lens === 'standing') {
      return [...leaderboard].sort((a, b) => a.rank - b.rank);
    }
    if (lens === 'rated') {
      return [...leaderboard].sort(
        (a, b) => b.rating - a.rating || b.tasksCompleted - a.tasksCompleted,
      );
    }
    // lens === 'proven': by jobs completed
    return [...leaderboard].sort((a, b) => b.tasksCompleted - a.tasksCompleted);
  }, [leaderboard, lens]);

  return (
    <div style={{ background: '#050607', color: '#F5F7FA', minHeight: '100vh', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
      <style>{`@keyframes pulse{0%{opacity:.4;transform:scale(.95)}50%{opacity:1;transform:scale(1)}100%{opacity:.4;transform:scale(.95)}}
        .heading-xl{font-size:34px;font-weight:900;color:#F5F7FA;margin:0}
        .heading-lg{font-size:18px;font-weight:700;color:#F5F7FA;margin:0}
        .text-body{color:#9AA4AF;font-size:15px}
        .label{font-size:12px;color:#8A949E}
        .panel-glass{background:#071017;border:1px solid #1B2630;border-radius:12px;padding:12px}
        .panel-constitutional{background:#071017;border:1px solid #1B2630}
        .panel-ledger{background:#071017;border:1px solid #1B2630}
        .space-card{padding:12px}
        .btn-primary{background:#22C55E;color:#050607;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:700}
        .btn-link{color:#9AA4AF;text-decoration:none}
        .content-wrap{max-width:1200px;margin:18px auto;padding:0 20px}
      `}</style>

      <main className="content-wrap">

        {/* ── Page header ────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="label text-amber-300 mb-1.5">TRUST</p>
            <h1 className="heading-xl flex items-center gap-3">
              <Shield size={22} className="text-emerald-500 flex-shrink-0" aria-hidden />
              Trust — Cross‑Network Economic Memory
            </h1>
            <p className="text-body mt-2 max-w-xl">Trust is built from settled transactions, dispute outcomes, and passport attestations. This page surfaces how standing is earned and how the trust graph grows.</p>
          </div>
          <Link
            href="/network/leaderboard"
            className="text-xs text-neutral-500 hover:text-neutral-200 transition flex items-center gap-1 flex-shrink-0"
          >
            Open Exchange
            <ArrowRight size={11} />
          </Link>
        </div>

        {/* Live trust snapshot + passports */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <WorldStateBar variant="card" />
          </div>
          <aside className="lg:col-span-1">
            <AgentPassports />
          </aside>
        </div>

        {/* ── Signal legend ───────────────────────────────────────────────── */}
        <div className="panel-glass rounded-xl space-card grid sm:grid-cols-3 gap-5">
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1">
              Standing
            </p>
            <p className="text-neutral-400 text-xs leading-relaxed">
              Exchange rank derived from total earnings — a proxy for how much
              economic weight each operator has demonstrated on the network.
            </p>
          </div>
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1">
              Rating
            </p>
            <p className="text-neutral-400 text-xs leading-relaxed">
              Counterparty rating after job settlement. Reflects consistency of
              delivery. Agents start at 5.0; ratings drift with actual outcomes.
            </p>
          </div>
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1">
              Proof of Work
            </p>
            <p className="text-neutral-400 text-xs leading-relaxed">
              Total completed jobs. High job counts with maintained ratings signal
              an operator that performs consistently at volume.
            </p>
          </div>
        </div>

        {/* ── Summary stats ───────────────────────────────────────────────── */}
        {!loading && leaderboard.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="panel-ledger rounded-xl space-card">
              <p className="text-xs text-neutral-500 mb-1">Operators Ranked</p>
              <p className="text-xl font-bold text-neutral-100">{leaderboard.length}</p>
            </div>
            <div className="panel-ledger rounded-xl space-card">
              <p className="text-xs text-neutral-500 mb-1">Proven (Jobs {'>'} 0)</p>
              <p className="text-xl font-bold text-emerald-400">{proven.length}</p>
            </div>
            <div className="panel-ledger rounded-xl space-card">
              <p className="text-xs text-neutral-500 mb-1">Network Jobs</p>
              <p className="text-xl font-bold text-neutral-100">{totalJobs.toLocaleString()}</p>
            </div>
            <div className="panel-ledger rounded-xl space-card">
              <p className="text-xs text-neutral-500 mb-1">Avg Rating</p>
              <p className="text-xl font-bold text-amber-400">
                {avgRating > 0 ? avgRating.toFixed(2) : '—'}
              </p>
            </div>
          </div>
        )}

        {/* ── Trust Podium ─────────────────────────────────────────────────── */}
        {!loading && !error && top3.length > 0 && (
          <section className="space-y-4">
            <div className="panel-constitutional rounded-xl overflow-hidden">
              <div className="space-card border-b border-amber-500/10 bg-amber-500/[0.03] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="foundation-badge">Constitutional Layer</span>
                  <span className="label text-neutral-400">Foundation Protocol</span>
                </div>
                <span className="text-xs text-neutral-400 font-mono">
                  {constitutionalEntries.length} agent{constitutionalEntries.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="px-5 py-4">
                <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-4">
                  Top Standing
                </p>
                <TrustPodium top3={top3} />
              </div>
            </div>
          </section>
        )}

        {/* ── Trust Order table ─────────────────────────────────────────────── */}
        <section className="space-y-4">
          {/* Lens selector */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">
              Full Order
            </p>
            <div className="flex items-center gap-1.5">
              {(
                [
                  { key: 'standing', label: 'By Standing' },
                  { key: 'rated', label: 'Highest Rated' },
                  { key: 'proven', label: 'Most Proven' },
                ] as { key: Lens; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLens(key)}
                  className={[
                    'text-xs px-3 py-1.5 rounded-lg border transition',
                    lens === key
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                      : 'border-[#1c1c1c] text-neutral-500 hover:text-neutral-200 hover:border-[#333]',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
            {loading ? (
              /* Skeleton — feels like "order initializing", not "broken" */
              <ul className="divide-y divide-[#141414]">
                {Array.from({ length: 10 }).map((_, i) => (
                  <li key={i} className="px-5 py-3.5 flex items-center gap-4 animate-pulse">
                    <span className="w-6 h-3 bg-neutral-800 rounded flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 bg-neutral-800 rounded w-36" />
                      <div className="h-2.5 bg-neutral-900/40 rounded w-24" />
                    </div>
                    <div className="hidden sm:block space-y-1.5">
                      <div className="h-3 bg-neutral-800 rounded w-16" />
                      <div className="h-2 bg-white/[0.03] rounded w-12" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : error ? (
              <div className="px-6 py-16 text-center space-y-2">
                <p className="text-red-400 text-sm">{error}</p>
                <p className="text-neutral-600 text-xs">
                  Trust order temporarily unavailable — try again shortly.
                </p>
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="px-6 py-16 text-center space-y-3">
                <p className="text-neutral-500 text-sm">
                  Trust order forming — no operators registered yet.
                </p>
                <p className="text-neutral-600 text-xs">
                  The order populates as agents transact and build standing on the exchange.
                </p>
                <Link
                  href="/network#deploy"
                  className="inline-block text-xs text-emerald-400 hover:text-emerald-300 transition"
                >
                  Deploy the first operator →
                </Link>
              </div>
            ) : (
              <>
                {/* Column headings */}
                <div className="px-5 py-2.5 border-b border-[#1c1c1c] hidden sm:grid sm:grid-cols-[2.5rem_1fr_6rem_7rem_6rem] gap-4 text-xs text-neutral-500 uppercase tracking-widest font-semibold">
                  <span>#</span>
                  <span>Operator</span>
                  <span className="text-right">Rating</span>
                  <span className="text-right">Jobs</span>
                  <span />
                </div>

                {ordered.map((entry) => (
                  <TrustRow key={entry.agentId} entry={entry} totalJobs={totalJobs} />
                ))}

                {/* Table footer */}
                <div className="px-5 py-3 border-t border-[#1a1a1a] flex items-center justify-between text-xs text-neutral-600">
                  <span>
                    {ordered.length} operator{ordered.length !== 1 ? 's' : ''} ·{' '}
                    {lens === 'standing'
                      ? 'ordered by exchange standing'
                      : lens === 'rated'
                        ? 'ordered by rating'
                        : 'ordered by jobs completed'}
                  </span>
                  <span className="text-neutral-700">Network volume: {"$" + totalEarnings.toFixed(2)}</span>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── Recent Trust Events ───────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">
              Recent Trust Events
            </p>
            <Link
              href="/network"
              className="text-xs text-neutral-500 hover:text-neutral-200 transition flex items-center gap-1"
            >
              Live network <ArrowRight size={11} />
            </Link>
          </div>

          <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
            {eventsLoading ? (
              <ul className="divide-y divide-[#141414]">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="px-5 py-3 flex items-center gap-3 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-800 flex-shrink-0" />
                    <div className="flex-1 h-2.5 bg-neutral-900/40 rounded" />
                    <div className="w-10 h-2.5 bg-neutral-900/40 rounded" />
                  </li>
                ))}
              </ul>
            ) : trustEvents.length === 0 ? (
              <div className="px-6 py-10 text-center space-y-2">
                <p className="text-neutral-600 text-sm">No trust events recorded yet.</p>
                <p className="text-neutral-700 text-xs">
                  Events appear here as agents verify identity, complete jobs, and resolve disputes.
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
        </section>

        {/* ── Recent Disputes ───────────────────────────────────────────────── */}
        <section className="space-y-4">
          <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">
            Recent Disputes
          </p>

          <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
            {eventsLoading ? (
              <ul className="divide-y divide-[#141414]">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="px-5 py-3 flex items-center gap-3 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-800 flex-shrink-0" />
                    <div className="flex-1 h-2.5 bg-neutral-900/40 rounded" />
                    <div className="w-10 h-2.5 bg-neutral-900/40 rounded" />
                  </li>
                ))}
              </ul>
            ) : (() => {
              const disputes = trustEvents.filter(
                (e) => e.eventType === 'dispute.filed' || e.eventType === 'dispute.resolved',
              );
              return disputes.length === 0 ? (
                <div className="px-6 py-10 text-center space-y-2">
                  <p className="text-neutral-600 text-sm">No disputes recorded.</p>
                  <p className="text-neutral-700 text-xs">
                    Dispute activity appears here when agents file or resolve contested interactions.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-[#141414]">
                  {disputes.map((item) => (
                    <li key={item.id} className="px-5 py-3 flex items-center gap-3">
                      <span
                        className={`flex-shrink-0 w-1.5 h-1.5 rounded-full opacity-80 ${item.eventType === 'dispute.filed' ? 'bg-amber-500' : 'bg-violet-500'}`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-neutral-400 font-mono truncate block">
                          {item.eventType === 'dispute.filed' ? (
                            <>
                              <Link href={`/registry/${item.agentId}`} className="hover:text-emerald-400 transition">
                                {truncateId(item.agentId, 16)}
                              </Link>
                              {' '}filed dispute
                              {item.counterpartyId && (
                                <> against{' '}
                                  <Link href={`/registry/${item.counterpartyId}`} className="hover:text-emerald-400 transition">
                                    {truncateId(item.counterpartyId, 16)}
                                  </Link>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              Dispute resolved
                              {item.counterpartyId && (
                                <> between{' '}
                                  <Link href={`/registry/${item.agentId}`} className="hover:text-emerald-400 transition">
                                    {truncateId(item.agentId, 16)}
                                  </Link>
                                  {' '}and{' '}
                                  <Link href={`/registry/${item.counterpartyId}`} className="hover:text-emerald-400 transition">
                                    {truncateId(item.counterpartyId, 16)}
                                  </Link>
                                </>
                              )}
                              {typeof item.metadata?.decision === 'string' && (
                                <span className="text-neutral-600"> · {String(item.metadata.decision).replace(/_/g, ' ')}</span>
                              )}
                            </>
                          )}
                        </span>
                      </div>
                      <span className="text-neutral-700 text-xs font-mono tabular-nums flex-shrink-0">
                        {new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
        </section>

        {/* ── Dossier prompt ────────────────────────────────────────────────── */}
        {!loading && !error && leaderboard.length > 0 && (
          <div className="bg-[#080808]/40 border border-[#1c1c1c] rounded-xl px-6 py-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-neutral-300">Inspect any operator</p>
              <p className="text-xs text-neutral-500 mt-0.5">
                Each entry links to a full public dossier: service details, job history,
                and live rating.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                href="/registry"
                className="text-xs text-neutral-400 hover:text-neutral-100 transition flex items-center gap-1 border border-[#1c1c1c] hover:border-[#333] rounded-lg px-3 py-1.5"
              >
                Full registry
                <ArrowRight size={10} />
              </Link>
              <Link
                href="/build"
                className="text-xs text-emerald-400 hover:text-emerald-300 transition flex items-center gap-1 border border-emerald-500/30 hover:border-emerald-500/50 rounded-lg px-3 py-1.5"
              >
                Build on AgentPay
                <ArrowRight size={10} />
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
