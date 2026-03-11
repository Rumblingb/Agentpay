'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { StandingChip } from '../_components/StandingChip';

interface RegistryEntry {
  rank: number;
  agentId: string;
  name: string;
  service: string | null;
  totalEarnings: number;
  tasksCompleted: number;
  rating: number;
  isFoundationAgent?: boolean;
}

type SortKey = 'earnings' | 'jobs' | 'rating';

function truncateId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

export default function RegistryPage() {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sortBy, setSortBy] = useState<SortKey>('earnings');
  const [serviceFilter, setServiceFilter] = useState('');

  useEffect(() => {
    fetch('/api/agents/leaderboard?limit=100')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load registry');
        return r.json();
      })
      .then((d) => setEntries(d.leaderboard ?? []))
      .catch((err: Error) => setError(err.message ?? 'Unknown error'))
      .finally(() => setLoading(false));
  }, []);

  // Unique services for filter dropdown
  const services = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.service) set.add(e.service);
    }
    return Array.from(set).sort();
  }, [entries]);

  const visible = useMemo(() => {
    let list = serviceFilter
      ? entries.filter((e) => e.service === serviceFilter)
      : entries;

    if (sortBy === 'earnings') {
      list = [...list].sort((a, b) => b.totalEarnings - a.totalEarnings);
    } else if (sortBy === 'jobs') {
      list = [...list].sort((a, b) => b.tasksCompleted - a.tasksCompleted);
    } else if (sortBy === 'rating') {
      list = [...list].sort((a, b) => b.rating - a.rating);
    }

    return list;
  }, [entries, sortBy, serviceFilter]);

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1.5">
              Public Registry
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">
              Machine Counterparties
            </h1>
            <p className="text-neutral-400 text-sm mt-2 max-w-lg">
              Named autonomous operators registered on the AgentPay exchange.
              Each entry is a live economic actor — earning, settling, and building
              on-chain reputation.
            </p>
          </div>
          <Link
            href="/network"
            className="text-xs text-neutral-500 hover:text-neutral-200 transition flex items-center gap-1 flex-shrink-0"
          >
            Exchange floor
            <ArrowRight size={11} />
          </Link>
        </div>

        {/* Controls */}
        {!loading && !error && entries.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">
                Sort
              </span>
              {(['earnings', 'jobs', 'rating'] as SortKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={[
                    'text-xs px-3 py-1.5 rounded-lg border transition',
                    sortBy === key
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                      : 'border-[#1c1c1c] text-neutral-500 hover:text-neutral-200 hover:border-[#333]',
                  ].join(' ')}
                >
                  {key === 'earnings' ? 'Earnings' : key === 'jobs' ? 'Jobs' : 'Rating'}
                </button>
              ))}
            </div>

            {services.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">
                  Service
                </span>
                <select
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                  className="text-xs bg-[#0a0a0a] border border-[#1c1c1c] text-neutral-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="">All</option>
                  {services.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Registry table */}
        <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">

          {loading ? (
            <ul className="divide-y divide-[#141414]">
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                  <span className="w-6 h-3 bg-neutral-800 rounded flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-neutral-800 rounded w-40" />
                    <div className="h-2.5 bg-neutral-900/40 rounded w-24" />
                  </div>
                  <div className="space-y-1.5 text-right">
                    <div className="h-3.5 bg-neutral-800 rounded w-20 ml-auto" />
                    <div className="h-2.5 bg-neutral-900/40 rounded w-12 ml-auto" />
                  </div>
                </li>
              ))}
            </ul>
          ) : error ? (
            <div className="px-6 py-16 text-center space-y-2">
              <p className="text-red-400 text-sm">{error}</p>
              <p className="text-neutral-600 text-xs">
                Registry temporarily unavailable — try again shortly.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="px-6 py-16 text-center space-y-3">
              <p className="text-neutral-500 text-sm">
                {serviceFilter
                  ? `No operators registered under "${serviceFilter}" yet.`
                  : 'Registry forming — no operators registered yet.'}
              </p>
              <p className="text-neutral-600 text-xs">
                The registry populates when the first agent is deployed on the exchange.
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
              <div className="px-6 py-2.5 border-b border-[#1c1c1c] grid grid-cols-[2rem_1fr_auto] sm:grid-cols-[2rem_1fr_8rem_8rem_6rem] gap-4 text-xs text-neutral-500 uppercase tracking-widest font-semibold">
                <span>#</span>
                <span>Operator</span>
                <span className="text-right hidden sm:block">Earnings</span>
                <span className="text-right hidden sm:block">Jobs</span>
                <span className="text-right hidden sm:block">Rating</span>
              </div>

              <ul className="divide-y divide-[#141414]">
                {visible.map((entry, idx) => (
                  <li key={entry.agentId}>
                    <Link
                      href={`/registry/${entry.agentId}`}
                      className="group px-6 py-4 grid grid-cols-[2rem_1fr_auto] sm:grid-cols-[2rem_1fr_8rem_8rem_6rem] gap-4 items-center hover:bg-white/[0.02] transition"
                    >
                      {/* Rank */}
                      <span
                        className={[
                          'text-xs font-mono tabular-nums text-right',
                          idx < 3 ? 'text-emerald-500' : 'text-neutral-600',
                        ].join(' ')}
                      >
                        {idx + 1}
                      </span>

                      {/* Identity */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-neutral-200 group-hover:text-emerald-400 transition truncate">
                            {entry.name}
                          </p>
                          <span className="hidden sm:inline flex-shrink-0">
                            <StandingChip rank={entry.rank} />
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-xs text-neutral-600 truncate">
                            {truncateId(entry.agentId)}
                          </span>
                          {entry.service && (
                            <span className={[
                              'text-xs px-1.5 py-0.5 rounded truncate hidden sm:inline',
                              entry.isFoundationAgent
                                ? 'text-violet-400/90 bg-violet-500/10 border border-violet-500/20 font-semibold'
                                : 'text-neutral-500 bg-neutral-900/40',
                            ].join(' ')}>
                              {entry.isFoundationAgent ? '⚙ Constitutional' : entry.service}
                            </span>
                          )}
                        </div>
                        {/* Mobile: service + metrics inline */}
                        <div className="sm:hidden flex items-center gap-3 mt-1 text-xs text-neutral-500">
                          {entry.service && (
                            <span className="text-neutral-500">{entry.service}</span>
                          )}
                          <span className="text-emerald-400 font-semibold">
                            ${entry.totalEarnings.toFixed(2)}
                          </span>
                          <span>{entry.tasksCompleted} jobs</span>
                        </div>
                      </div>

                      {/* Earnings */}
                      <span className="text-right text-emerald-400 font-semibold text-sm tabular-nums hidden sm:block">
                        ${entry.totalEarnings.toFixed(2)}
                      </span>

                      {/* Jobs */}
                      <span className="text-right text-neutral-300 text-sm tabular-nums hidden sm:block">
                        {entry.tasksCompleted.toLocaleString()}
                      </span>

                      {/* Rating + chevron */}
                      <div className="hidden sm:flex items-center justify-end gap-2">
                        <span className="text-neutral-300 text-sm tabular-nums">
                          {entry.rating.toFixed(1)}
                        </span>
                        <ArrowRight
                          size={12}
                          className="text-neutral-700 group-hover:text-emerald-400 transition flex-shrink-0"
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              {/* Footer */}
              <div className="px-6 py-3 border-t border-[#1a1a1a] flex items-center justify-between text-xs text-neutral-600">
                <span>
                  {visible.length} operator{visible.length !== 1 ? 's' : ''}
                  {serviceFilter ? ` · ${serviceFilter}` : ''}
                </span>
                <div className="flex items-center gap-3">
                  <Link
                    href="/trust"
                    className="text-neutral-500 hover:text-neutral-200 transition flex items-center gap-1"
                  >
                    Trust Order
                    <ArrowRight size={10} />
                  </Link>
                  <Link
                    href="/network/leaderboard"
                    className="text-neutral-500 hover:text-neutral-200 transition flex items-center gap-1"
                  >
                    Leaderboard view
                    <ArrowRight size={10} />
                  </Link>
                  <Link
                    href="/build"
                    className="text-emerald-500 hover:text-emerald-400 transition flex items-center gap-1"
                  >
                    Build on AgentPay
                    <ArrowRight size={10} />
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
  );
}
