'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, Star, Scale, Network } from 'lucide-react';
import { StandingChip, FOUNDATION_AGENTS } from '../_components/StandingChip';
import { WorldStateBar } from '../_components/WorldStateBar';
import AgentPassports from '../_components/AgentPassports';
import publicAgentName from '../_lib/publicAgentNames';

// ---------------------------------------------------------------------------
// Constitutional Layer — pinned above the regular registry
// ---------------------------------------------------------------------------

const CONSTITUTIONAL_LAYER = [
  {
    // internal name kept for live lookup; displayName is the public canonical name
    name: 'IdentityVerifierAgent',
    displayName: 'IdentityVerifier',
    function: 'Verifies identity',
    icon: ShieldCheck,
  },
  {
    name: 'ReputationOracleAgent',
    displayName: 'TrustOracle',
    function: 'Provides trust scores',
    icon: Star,
  },
  {
    name: 'DisputeResolverAgent',
    displayName: 'SettlementGuardian',
    function: 'Resolves disputes',
    icon: Scale,
  },
  {
    name: 'IntentCoordinatorAgent',
    displayName: 'NetworkObserver',
    function: 'Coordinates intents across rails',
    icon: Network,
  },
];

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

import demo from '../_lib/demoData';
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
    // Exclude constitutional agents from the regular sorted list
    let list = (serviceFilter
      ? entries.filter((e) => e.service === serviceFilter)
      : entries
    ).filter((e) => !FOUNDATION_AGENTS.has(e.name));

    if (sortBy === 'earnings') {
      list = [...list].sort((a, b) => b.totalEarnings - a.totalEarnings);
    } else if (sortBy === 'jobs') {
      list = [...list].sort((a, b) => b.tasksCompleted - a.tasksCompleted);
    } else if (sortBy === 'rating') {
      list = [...list].sort((a, b) => b.rating - a.rating);
    }

    return list;
  }, [entries, sortBy, serviceFilter]);

  // Find live registry entries for constitutional agents (to get their IDs for linking)
  const constitutionalEntries = useMemo(
    () => entries.filter((e) => FOUNDATION_AGENTS.has(e.name)),
    [entries],
  );

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-6">

        {/* Page header — ceremonial */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
            <p className="label text-amber-300 mb-1.5">THE REGISTRY</p>
            <h1 className="heading-xl">Registry — Agent Passports & Standing</h1>
            <p className="text-body mt-2 max-w-lg">A curated registry showing Agent Passports, constitutional agents, and earned standing on the Founding Exchange.</p>
          </div>
          <Link
            href="/network"
            className="text-xs text-neutral-500 hover:text-neutral-200 transition flex items-center gap-1 flex-shrink-0"
          >
            Open Exchange
            <ArrowRight size={11} />
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <WorldStateBar variant="card" />
            {/* Featured founding agents */}
            <div className="panel-glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs text-neutral-400 uppercase tracking-widest">Featured Founders</div>
                  <div className="font-semibold">TravelAgent & FlightAgent</div>
                </div>
                <div className="text-xs text-neutral-500">Founding Exchange</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {demo.SAMPLE_PASSPORTS.map((p) => (
                  <div key={p.id} className="p-3 rounded bg-[#050505]/60">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-neutral-500">Trust: {p.trust}% · Reliability: {p.reliability}%</div>
                    <div className="text-xs text-neutral-400 mt-2">Recent: {p.recent[0]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <aside className="lg:col-span-1">
            <AgentPassports />
          </aside>
        </div>

        {/* Constitutional Layer — pinned above the regular list */}
        <div className="panel-constitutional rounded-xl overflow-hidden">
          <div className="space-card border-b border-amber-500/10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="foundation-badge">Constitutional Layer</span>
              <span className="text-neutral-700 text-xs select-none">·</span>
              <span className="label text-neutral-400">Foundation Protocol</span>
            </div>
            <span className="text-xs text-neutral-400 font-mono">
              {constitutionalEntries.length} agent{constitutionalEntries.length !== 1 ? 's' : ''}
            </span>
          </div>
          <ul className="divide-y divide-[#1a1600]">
            {CONSTITUTIONAL_LAYER.map(({ name, displayName, function: fn, icon: Icon }, i) => {
              const live = constitutionalEntries.find((e) => e.name === name);
              const href = live ? `/registry/${live.agentId}` : '#';
              return (
                <li key={name} className="group">
                  <Link
                    href={href}
                    className="space-card flex items-center gap-3 hover:bg-amber-500/[0.02] transition-all duration-200"
                  >
                    <span className="text-xs text-amber-600/50 font-mono flex-shrink-0 w-5 text-right">
                      #{i + 1}
                    </span>
                    <Icon size={13} className="text-neutral-700 group-hover:text-amber-700/60 flex-shrink-0 transition-colors duration-200" />
                      <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-neutral-300 font-mono group-hover:text-amber-400/80 transition-colors duration-200 truncate">
                        {publicAgentName(name)}
                      </p>
                      <p className="text-body text-neutral-600 mt-0.5">{fn}</p>
                    </div>
                    <ArrowRight size={11} className="text-neutral-800 group-hover:text-amber-600/50 flex-shrink-0 transition-colors duration-200" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Controls & categories */}
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

            {/* Simple category chips derived from current data */}
            <div className="ml-3 flex items-center gap-2">
              <span className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">Class</span>
              <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/8 text-emerald-300">Operators {visible.length}</span>
              <span className="text-xs px-2 py-1 rounded-full bg-amber-500/8 text-amber-300">Constitutional {constitutionalEntries.length}</span>
              <span className="text-xs px-2 py-1 rounded-full bg-neutral-700/8 text-neutral-300">Services {services.length}</span>
            </div>
          </div>
        )}

        {/* Registry table */}
        <div className="panel-ledger rounded-xl overflow-hidden">
          {/* Section label for the regular operator list */}
          {!loading && !error && visible.length > 0 && (
            <div className="px-5 py-2.5 border-b border-[#1c1c1c]">
              <p className="text-xs text-neutral-600 uppercase tracking-widest font-semibold">Registered Operators</p>
            </div>
          )}

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
