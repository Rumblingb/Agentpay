'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Trophy,
  Star,
  TrendingUp,
  Users,
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Activity,
  Award,
  Zap,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';

interface DiscoveredAgent {
  rank: number;
  agentId: string;
  handle: string;
  bio: string | null;
  score: number;
  grade: string;
  transactionVolume: number;
  paymentReliability: number;
  serviceDelivery: number;
  category: string | null;
}

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  name: string | null;
  service: string | null;
  rating: number | null;
  totalEarnings: number;
  tasksCompleted: number;
}

interface FeedEvent {
  id: string;
  type: 'job.created' | 'agent.hired' | 'escrow.released' | 'ranking.updated';
  data: Record<string, unknown>;
  ts: number;
}

interface Category {
  id: string;
  name: string;
}

const GRADE_COLOR: Record<string, string> = {
  S: 'text-yellow-400',
  A: 'text-emerald-400',
  B: 'text-blue-400',
  C: 'text-slate-300',
  D: 'text-orange-400',
  F: 'text-red-400',
  U: 'text-slate-500',
};

const BADGE_STYLE: Record<string, string> = {
  elite: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  'top-rated': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  trusted: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

const GRADE_BADGE: Record<string, string> = {
  S: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
  A: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
  B: 'bg-blue-500/20 text-blue-400 border border-blue-500/40',
  C: 'bg-slate-500/20 text-slate-300 border border-slate-500/40',
  D: 'bg-orange-500/20 text-orange-400 border border-orange-500/40',
  F: 'bg-red-500/20 text-red-400 border border-red-500/40',
};

const FEED_BADGE: Record<FeedEvent['type'], string> = {
  'job.created': 'bg-emerald-500/20 text-emerald-400',
  'agent.hired': 'bg-blue-500/20 text-blue-400',
  'escrow.released': 'bg-purple-500/20 text-purple-400',
  'ranking.updated': 'bg-yellow-500/20 text-yellow-400',
};

const PAGE_SIZE = 12;

// ─── Live Feed Panel ──────────────────────────────────────────────────────────

function LiveFeedPanel() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/feed/stream');
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const handleEvent = (type: FeedEvent['type']) => (e: MessageEvent) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(e.data);
      } catch {
        data = { raw: e.data };
      }
      setEvents((prev) => [
        { id: `${Date.now()}-${Math.random()}`, type, data, ts: Date.now() },
        ...prev.slice(0, 9),
      ]);
    };

    es.addEventListener('job.created', handleEvent('job.created'));
    es.addEventListener('agent.hired', handleEvent('agent.hired'));
    es.addEventListener('escrow.released', handleEvent('escrow.released'));
    es.addEventListener('ranking.updated', handleEvent('ranking.updated'));

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-full min-h-[400px]">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-emerald-400" />
          <span className="text-sm font-semibold">Live Feed</span>
        </div>
        <span
          className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}
        />
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50">
        {events.length === 0 ? (
          <div className="p-4 text-xs text-slate-500 text-center">Waiting for events…</div>
        ) : (
          events.map((ev) => (
            <div
              key={ev.id}
              className="px-4 py-2.5 space-y-1 animate-in fade-in duration-300"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${FEED_BADGE[ev.type]}`}
                >
                  {ev.type}
                </span>
                <span className="text-[10px] text-slate-500">
                  {new Date(ev.ts).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                {Object.entries(ev.data)
                  .slice(0, 2)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: DiscoveredAgent }) {
  const gradeBadgeClass = GRADE_BADGE[agent.grade] ?? 'bg-slate-700 text-slate-300';
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col gap-3 hover:border-slate-700 transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{agent.handle}</p>
          {agent.bio && (
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{agent.bio}</p>
          )}
        </div>
        <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded ${gradeBadgeClass}`}>
          {agent.grade}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-800/60 rounded-lg p-2">
          <div className="text-slate-500">Score</div>
          <div className="font-semibold text-white">{agent.score}</div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2">
          <div className="text-slate-500">Volume</div>
          <div className="font-semibold text-white">{agent.transactionVolume.toLocaleString()}</div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2">
          <div className="text-slate-500">Reliability</div>
          <div className="font-semibold text-white">
            {(agent.paymentReliability * 100).toFixed(1)}%
          </div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2">
          <div className="text-slate-500">Delivery</div>
          <div className="font-semibold text-white">
            {(agent.serviceDelivery * 100).toFixed(1)}%
          </div>
        </div>
      </div>
      <a
        href={`/marketplace/hire/${encodeURIComponent(agent.agentId)}`}
        className="mt-auto block text-center text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg transition"
      >
        Hire Agent
      </a>
    </div>
  );
}

// ─── Skeleton Card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 animate-pulse space-y-3">
      <div className="h-4 bg-slate-800 rounded w-3/4" />
      <div className="h-3 bg-slate-800 rounded w-1/2" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-slate-800 rounded-lg" />
        ))}
      </div>
      <div className="h-8 bg-slate-800 rounded-lg" />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

/**
 * Marketplace page — discover, search, and hire agents with live feed.
 */
export default function MarketplacePage() {
  const [isClient, setIsClient] = useState(false);
  const [activeTab, setActiveTab] = useState<'discover' | 'leaderboard'>('discover');

  // Discover state
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState('score');
  const [minScore, setMinScore] = useState(0);
  const [page, setPage] = useState(1);
  const [agents, setAgents] = useState<DiscoveredAgent[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);

  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState('');

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setPage(1);
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCategory(e.target.value);
    setPage(1);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSortBy(e.target.value);
    setPage(1);
  };

  const handleMinScoreChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMinScore(Number(e.target.value));
    setPage(1);
  };

  // Bootstrap
  useEffect(() => {
    setIsClient(true);
    fetch('/api/marketplace/categories')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
      .catch(() => {});
  }, []);

  // Discover fetch
  useEffect(() => {
    if (!isClient) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      setDiscoverLoading(true);
      setDiscoverError('');
      try {
        const params = new URLSearchParams({
          sortBy,
          limit: String(PAGE_SIZE),
          page: String(page),
        });
        if (query) params.set('q', query);
        if (category) params.set('category', category);
        if (minScore > 0) params.set('minScore', String(minScore));
        const res = await fetch(`/api/marketplace/discover?${params}`);
        if (!res.ok) throw new Error('Failed to load agents');
        const data = await res.json();
        setAgents(data.agents ?? []);
        setTotalPages(data.pagination?.totalPages ?? 1);
      } catch (err: any) {
        setDiscoverError(err.message ?? 'Failed to load');
      } finally {
        setDiscoverLoading(false);
      }
    }, 300);
  }, [isClient, query, category, sortBy, minScore, page]);

  // Leaderboard fetch
  useEffect(() => {
    if (!isClient || activeTab !== 'leaderboard') return;
    setLbLoading(true);
    setLbError('');
    fetch('/api/agents/leaderboard')
      .then((r) => r.json())
      .then((d) => setLeaderboard(d.leaderboard ?? []))
      .catch((err) => setLbError(err.message ?? 'Failed to load'))
      .finally(() => setLbLoading(false));
  }, [isClient, activeTab]);

  if (!isClient) return null;

  const avgScore =
    agents.length > 0
      ? Math.round(agents.reduce((s, a) => s + a.score, 0) / agents.length)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Marketplace</h1>
        <p className="text-slate-400 text-sm mt-1">
          Discover, evaluate, and hire AI agents on the AgentPay network.
        </p>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Results"
          value={discoverLoading ? '—' : agents.length}
          icon={Users}
          iconColor="text-purple-400"
          iconBg="bg-purple-500/10"
          loading={discoverLoading}
        />
        <MetricCard
          label="Avg Score"
          value={discoverLoading ? '—' : avgScore}
          icon={Star}
          iconColor="text-yellow-400"
          iconBg="bg-yellow-500/10"
          loading={discoverLoading}
        />
        <MetricCard
          label="Page"
          value={`${page} / ${totalPages}`}
          icon={TrendingUp}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
        />
        <MetricCard
          label="Leaderboard"
          value={lbLoading ? '—' : leaderboard.length}
          icon={Trophy}
          iconColor="text-yellow-400"
          iconBg="bg-yellow-500/10"
          loading={lbLoading}
        />
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 bg-slate-900/50 border border-slate-800 rounded-xl p-1 w-fit">
        {(['discover', 'leaderboard'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-sm rounded-lg font-medium transition capitalize ${
              activeTab === tab
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab === 'discover' ? (
              <span className="flex items-center gap-1.5">
                <Search size={13} /> Discover
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Award size={13} /> Leaderboard
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── DISCOVER TAB ── */}
      {activeTab === 'discover' && (
        <>
          {/* Search + filter bar */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap gap-3">
              {/* Text search */}
              <div className="relative flex-1 min-w-[180px]">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  type="text"
                  value={query}
                  onChange={handleSearchChange}
                  placeholder="Search agents…"
                  className="w-full pl-8 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-600"
                />
              </div>

              {/* Category dropdown */}
              <div className="relative">
                <SlidersHorizontal
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <select
                  value={category}
                  onChange={handleCategoryChange}
                  className="pl-8 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-emerald-600 appearance-none"
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sort dropdown */}
              <select
                value={sortBy}
                onChange={handleSortChange}
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-emerald-600"
              >
                <option value="score">Sort: Score</option>
                <option value="volume">Sort: Volume</option>
                <option value="recent">Sort: Recent</option>
                <option value="cheapest">Sort: Cheapest</option>
              </select>
            </div>

            {/* Min score slider */}
            <div className="flex items-center gap-3">
              <Zap size={13} className="text-yellow-400 shrink-0" />
              <span className="text-xs text-slate-500 whitespace-nowrap">Min score:</span>
              <input
                type="range"
                min={0}
                max={1000}
                step={50}
                value={minScore}
                onChange={handleMinScoreChange}
                className="flex-1 accent-emerald-500"
              />
              <span className="text-xs text-slate-300 w-10 text-right font-mono">{minScore}</span>
            </div>
          </div>

          {/* Main content: grid + live feed */}
          <div className="flex gap-6">
            {/* Agent grid */}
            <div className="flex-1 min-w-0 space-y-4">
              {discoverError ? (
                <div className="p-8 text-center text-red-400 text-sm">{discoverError}</div>
              ) : discoverLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <SkeletonCard key={i} />
                  ))}
                </div>
              ) : agents.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-sm">
                  No agents found. Try adjusting your filters.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {agents.map((agent) => (
                    <AgentCard key={agent.agentId} agent={agent} />
                  ))}
                </div>
              )}

              {/* Pagination */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft size={13} /> Prev
                </button>
                <span className="text-xs text-slate-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>

            {/* Live feed sidebar */}
            <div className="hidden lg:block w-64 shrink-0">
              <LiveFeedPanel />
            </div>
          </div>
        </>
      )}

      {/* ── LEADERBOARD TAB ── */}
      {activeTab === 'leaderboard' && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="font-semibold">Top Agents by Earnings</h2>
          </div>
          {lbLoading ? (
            <div className="p-8 text-center text-slate-500">Loading leaderboard…</div>
          ) : lbError ? (
            <div className="p-8 text-center text-red-400 text-sm">{lbError}</div>
          ) : leaderboard.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No agents on the leaderboard yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left px-6 py-3 font-medium">Rank</th>
                  <th className="text-left px-6 py-3 font-medium">Name</th>
                  <th className="text-left px-6 py-3 font-medium">Service</th>
                  <th className="text-left px-6 py-3 font-medium">Rating</th>
                  <th className="text-left px-6 py-3 font-medium">Earnings</th>
                  <th className="text-left px-6 py-3 font-medium">Tasks</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry) => (
                  <tr
                    key={entry.agentId}
                    className="border-b border-slate-800/50 hover:bg-slate-800/30 transition"
                  >
                    <td className="px-6 py-3 text-slate-400 font-mono">#{entry.rank}</td>
                    <td className="px-6 py-3 text-white">{entry.name ?? entry.agentId}</td>
                    <td className="px-6 py-3 text-slate-400 text-xs">{entry.service ?? '—'}</td>
                    <td className="px-6 py-3 text-slate-300">
                      {entry.rating != null ? (
                        <span className="flex items-center gap-1">
                          <Star size={11} className="text-yellow-400" />
                          {Number(entry.rating).toFixed(1)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-6 py-3 font-semibold text-emerald-400">
                      ${Number(entry.totalEarnings).toFixed(2)}
                    </td>
                    <td className="px-6 py-3 text-slate-300">{entry.tasksCompleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
