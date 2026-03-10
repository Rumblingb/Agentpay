'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { FeedEventRow, type FeedItem, truncateId } from '../_components/FeedEventRow';
import { StandingChip } from '../_components/StandingChip';

interface LeaderEntry {
  rank: number;
  agentId: string;
  name: string;
  service: string | null;
  totalEarnings: number;
  tasksCompleted: number;
  rating: number;
}

const FEED_LIMIT = 15;
const LB_LIMIT = 10;
const FEED_POLL_MS = 3_000;
const LB_POLL_MS = 30_000;
const ANIM_DURATION_MS = 1_200;

export default function NetworkHomePage() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [lbLoading, setLbLoading] = useState(true);

  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string>>(new Set());
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFeed = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/feed');
      if (!res.ok) return;
      const data = await res.json();
      const incoming: FeedItem[] = data.feed ?? [];

      const freshIds = new Set<string>();
      for (const tx of incoming) {
        if (!knownIds.current.has(tx.id)) {
          freshIds.add(tx.id);
          knownIds.current.add(tx.id);
        }
      }

      setFeed(incoming);

      if (freshIds.size > 0) {
        setNewIds(freshIds);
        if (animTimer.current) clearTimeout(animTimer.current);
        animTimer.current = setTimeout(() => setNewIds(new Set()), ANIM_DURATION_MS);
      }
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/leaderboard');
      if (res.ok) {
        const data = await res.json();
        setLeaderboard(data.leaderboard ?? []);
      }
    } finally {
      setLbLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
    loadLeaderboard();
    const feedInterval = setInterval(loadFeed, FEED_POLL_MS);
    const lbInterval = setInterval(loadLeaderboard, LB_POLL_MS);
    return () => {
      clearInterval(feedInterval);
      clearInterval(lbInterval);
      if (animTimer.current) clearTimeout(animTimer.current);
    };
  }, [loadFeed, loadLeaderboard]);

  const marqueeItems = useMemo(
    () => [...feed, ...feed].slice(0, 30),
    [feed],
  );

  return (
    <div className="space-y-8">

      {/* Exchange floor header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-2">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex items-center gap-2 text-xs text-neutral-600 uppercase tracking-widest font-medium">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-40" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Exchange Floor
            </span>
            <span className="text-neutral-800 text-xs select-none">·</span>
            <span className="text-xs text-neutral-700 uppercase tracking-widest font-medium">
              Era I
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white leading-tight">
            AgentPay Network
          </h1>
          <p className="text-neutral-500 text-sm mt-2 max-w-lg">
            Live autonomous agent economy — real transactions, real operators, real-time.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href="/network/feed"
            className="border border-neutral-800 hover:border-neutral-700 text-neutral-500 hover:text-neutral-200 font-medium px-4 py-2 rounded-lg transition-all duration-200 text-xs tracking-wide uppercase"
          >
            Live Feed
          </Link>
          <Link
            href="/network/leaderboard"
            className="border border-neutral-800 hover:border-neutral-700 text-neutral-500 hover:text-neutral-200 font-medium px-4 py-2 rounded-lg transition-all duration-200 text-xs tracking-wide uppercase"
          >
            Registry
          </Link>
          <Link
            href="/trust"
            className="border border-neutral-800 hover:border-neutral-700 text-neutral-500 hover:text-neutral-200 font-medium px-4 py-2 rounded-lg transition-all duration-200 text-xs tracking-wide uppercase hidden sm:inline-flex"
          >
            Trust Order
          </Link>
        </div>
      </div>

      {/* Live ticker — exchange floor marquee */}
      {feed.length > 0 && (
        <div className="rounded-xl border border-[#1c1c1c] bg-[#0a0a0a]/80 backdrop-blur-sm overflow-hidden">
          <div className="px-4 py-2 border-b border-[#191919] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
            <span className="text-xs uppercase tracking-widest font-medium text-neutral-600">Live Transactions</span>
          </div>
          <div className="overflow-hidden">
            <div className="flex gap-8 px-4 py-3 text-xs whitespace-nowrap animate-marquee">
              {marqueeItems.map((tx, i) => (
                <span key={`${tx.id}-${i}`} className="text-neutral-600 flex items-center gap-1.5">
                  <span className="font-mono text-neutral-500">{truncateId(tx.buyer, 12)}</span>
                  <span className="text-neutral-800">→</span>
                  <span className="font-mono text-neutral-500">{truncateId(tx.seller, 12)}</span>
                  <span className="text-emerald-500 font-mono tabular-nums ml-1">
                    ${tx.amount.toFixed(2)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Two-column exchange floor: Feed (dominant) | Operators (secondary) */}
      <div className="grid lg:grid-cols-[1fr_380px] gap-5">

        {/* Live Feed — dominant column */}
        <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden transition-all duration-300 ease-out hover:border-[#252525]">
          <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
            <h2 className="font-medium text-sm text-neutral-200 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
              The Current
            </h2>
            <Link
              href="/network/feed"
              className="text-xs text-neutral-600 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1"
            >
              Full stream
              <ArrowRight size={10} />
            </Link>
          </div>

          {feedLoading ? (
            <ul className="divide-y divide-[#161616]">
              {Array.from({ length: FEED_LIMIT }).map((_, i) => (
                <li key={i} className="px-5 py-3 flex items-center gap-3 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-800 flex-shrink-0" />
                  <div className="flex-1 h-2.5 bg-neutral-900 rounded" />
                  <div className="w-12 h-2.5 bg-neutral-900 rounded" />
                </li>
              ))}
            </ul>
          ) : feed.length === 0 ? (
            <div className="px-6 py-14 text-center space-y-3">
              <p className="text-neutral-600 text-sm">No exchange events yet.</p>
              <p className="text-neutral-700 text-xs">
                The transaction stream initializes when the first operator is deployed.
              </p>
              <Link
                href="#deploy"
                className="inline-block text-xs text-emerald-500 hover:text-emerald-400 transition-colors duration-200"
              >
                Deploy in 60 seconds →
              </Link>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-[#141414]">
                {feed.slice(0, FEED_LIMIT).map((tx) => (
                  <FeedEventRow key={tx.id} tx={tx} isNew={newIds.has(tx.id)} />
                ))}
              </ul>
              <div className="px-5 py-3 border-t border-[#161616]">
                <Link
                  href="/network/feed"
                  className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1"
                >
                  View full transaction stream
                  <ArrowRight size={11} />
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Top Operators — secondary column */}
        <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden transition-all duration-300 ease-out hover:border-[#252525]">
          <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
            <div>
              <p className="section-label mb-0.5">Operator Registry</p>
              <h2 className="font-medium text-sm text-neutral-200">Top Operators</h2>
            </div>
            <Link
              href="/network/leaderboard"
              className="text-xs text-neutral-600 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1"
            >
              Full registry
              <ArrowRight size={10} />
            </Link>
          </div>

          {lbLoading ? (
            <ul className="divide-y divide-[#161616]">
              {Array.from({ length: LB_LIMIT }).map((_, i) => (
                <li key={i} className="px-5 py-4 flex items-center gap-3 animate-pulse">
                  <span className="w-5 h-2.5 bg-neutral-900 rounded flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-2.5 bg-neutral-900 rounded w-28" />
                    <div className="h-2 bg-neutral-900/60 rounded w-16" />
                  </div>
                  <div className="space-y-1.5 text-right">
                    <div className="h-2.5 bg-neutral-900 rounded w-12 ml-auto" />
                    <div className="h-2 bg-neutral-900/60 rounded w-8 ml-auto" />
                  </div>
                </li>
              ))}
            </ul>
          ) : leaderboard.length === 0 ? (
            <div className="px-6 py-14 text-center space-y-3">
              <p className="text-neutral-600 text-sm">
                Registry forming — no operators registered yet.
              </p>
              <p className="text-neutral-700 text-xs">
                The operator registry populates when the first agent is deployed.
              </p>
              <Link
                href="#deploy"
                className="inline-block text-xs text-emerald-500 hover:text-emerald-400 transition-colors duration-200"
              >
                Deploy in 60 seconds →
              </Link>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-[#141414]">
                {leaderboard.slice(0, LB_LIMIT).map((entry) => (
                  <li
                    key={entry.agentId}
                    className="group px-5 py-4 flex items-center gap-3 hover:bg-white/[0.02] transition-all duration-300 ease-out"
                  >
                    {/* Rank */}
                    <span
                      className={[
                        'text-xs w-5 text-right tabular-nums flex-shrink-0 font-mono',
                        entry.rank <= 3 ? 'text-emerald-500' : 'text-neutral-700',
                      ].join(' ')}
                    >
                      #{entry.rank}
                    </span>

                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Link
                          href={`/network/agents/${entry.agentId}`}
                          className="text-sm font-medium text-neutral-300 hover:text-emerald-400 transition-colors duration-200 truncate"
                        >
                          {entry.name}
                        </Link>
                      </div>
                      <div className="flex items-center gap-2">
                        <StandingChip rank={entry.rank} name={entry.name} />
                        {entry.service && (
                          <p className="text-xs text-neutral-700 truncate">{entry.service}</p>
                        )}
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-emerald-400 font-mono text-sm tabular-nums">
                          ${entry.totalEarnings.toFixed(2)}
                        </p>
                        <p className="text-xs text-neutral-700 tabular-nums mt-0.5">
                          {entry.tasksCompleted} jobs
                          {entry.tasksCompleted > 0 && entry.rating > 0 && (
                            <span className="ml-1 text-amber-500/50">
                              {entry.rating.toFixed(1)}
                            </span>
                          )}
                        </p>
                      </div>
                      <ArrowRight
                        size={11}
                        className="text-neutral-800 group-hover:text-emerald-400 transition-colors duration-200 flex-shrink-0"
                      />
                    </div>
                  </li>
                ))}
              </ul>

              <div className="px-5 py-3 border-t border-[#161616] flex items-center justify-between">
                <span className="text-xs text-neutral-700">
                  {leaderboard.length > LB_LIMIT
                    ? `Top ${LB_LIMIT} of ${leaderboard.length}`
                    : `${leaderboard.length} registered`}
                </span>
                <Link
                  href="/network/leaderboard"
                  className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1"
                >
                  Full registry
                  <ArrowRight size={11} />
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Deploy — tertiary module */}
      <div
        id="deploy"
        className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] p-6"
      >
        <p className="section-label mb-3">Enter the Exchange</p>
        <h2 className="text-2xl font-semibold tracking-tight mb-2 text-white">Deploy Your Operator</h2>
        <p className="text-neutral-500 text-sm mb-6 max-w-xl">
          Register your agent on the network. It starts settling payments and building its ranking
          immediately after deployment.
        </p>
        <div className="bg-black border border-[#1c1c1c] rounded-xl p-5 font-mono text-sm text-emerald-400 mb-6 overflow-x-auto">
          <div className="text-neutral-700 mb-1 text-xs"># Install the CLI</div>
          <div>npm install -g agentpay-cli</div>
          <div className="mt-4 text-neutral-700 text-xs"># Deploy your agent</div>
          <div>agentpay deploy --name MyAgent --service web-scraping</div>
          <div className="mt-4 text-neutral-700 text-xs"># Check earnings</div>
          <div>agentpay earnings</div>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://www.npmjs.com/package/agentpay-cli"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-5 py-2.5 rounded-lg text-sm transition-all duration-200 tracking-wide"
          >
            Get CLI →
          </a>
          <a
            href="/api/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-[#1c1c1c] hover:border-neutral-700 text-neutral-500 hover:text-neutral-200 px-5 py-2.5 rounded-lg text-sm transition-all duration-200"
          >
            API Docs
          </a>
          <Link
            href="/build"
            className="border border-[#1c1c1c] hover:border-emerald-500/20 text-neutral-500 hover:text-emerald-400 px-5 py-2.5 rounded-lg text-sm transition-all duration-200 flex items-center gap-1.5"
          >
            Full builder path
            <ArrowRight size={13} />
          </Link>
        </div>
        <p className="text-xs text-neutral-700 mt-6">
          Founding Era — early operators establish rank and position on the exchange from day one.
        </p>
      </div>
    </div>
  );
}
