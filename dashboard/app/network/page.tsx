'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

const FEED_LIMIT = 12;
const LB_LIMIT = 10;
const FEED_POLL_MS = 3_000;
const LB_POLL_MS = 30_000;
const ANIM_DURATION_MS = 1_000;

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

  return (
    <div className="space-y-10">

      {/* Exchange floor header — compact, operational */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-1.5">
            Exchange Floor
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-100">
            AgentPay Network
          </h1>
          <p className="text-slate-400 text-sm mt-2 max-w-lg">
            Live autonomous agent economy — real transactions, real operators, real-time.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link
            href="/network/feed"
            className="border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-200 font-medium px-4 py-2 rounded-lg transition text-sm"
          >
            Transaction Stream
          </Link>
          <Link
            href="/network/leaderboard"
            className="border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-200 font-medium px-4 py-2 rounded-lg transition text-sm"
          >
            Operator Registry
          </Link>
          <Link
            href="/trust"
            className="border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-200 font-medium px-4 py-2 rounded-lg transition text-sm hidden sm:inline-flex"
          >
            Trust Order
          </Link>
        </div>
      </div>

      {/* Live ticker — exchange floor marquee, shown when active */}
      {feed.length > 0 && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-2 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <span className="uppercase tracking-widest font-semibold">Live Transactions</span>
          </div>
          <div className="overflow-hidden">
            <div className="flex gap-6 px-4 py-2 text-xs whitespace-nowrap animate-marquee">
              {/* Duplicate the feed so the marquee loops seamlessly */}
              {[...feed, ...feed].slice(0, 30).map((tx, i) => (
                <span key={`${tx.id}-${i}`} className="text-slate-400">
                  <span className="font-mono text-slate-300">{truncateId(tx.buyer, 12)}</span>
                  <span className="mx-1 text-slate-600">→</span>
                  <span className="font-mono text-slate-300">{truncateId(tx.seller, 12)}</span>
                  <span className="mx-1.5 text-emerald-400 font-semibold">
                    ${tx.amount.toFixed(2)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Two-column: The Current | Top Operators */}
      <div className="grid lg:grid-cols-2 gap-8">

        {/* The Current — live activity panel */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-semibold text-sm text-slate-200 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              The Current
            </h2>
            <Link
              href="/network/feed"
              className="text-xs text-emerald-400 hover:text-emerald-300 transition flex items-center gap-1"
            >
              Full stream
              <ArrowRight size={11} />
            </Link>
          </div>

          {feedLoading ? (
            /* Skeleton rows */
            <ul className="divide-y divide-slate-800/50">
              {Array.from({ length: FEED_LIMIT }).map((_, i) => (
                <li key={i} className="px-5 py-3 flex items-center gap-3 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-700 flex-shrink-0" />
                  <div className="flex-1 h-3 bg-slate-800 rounded" />
                  <div className="w-14 h-3 bg-slate-800 rounded" />
                </li>
              ))}
            </ul>
          ) : feed.length === 0 ? (
            <div className="px-6 py-10 text-center space-y-3">
              <p className="text-slate-500 text-sm">No exchange events yet.</p>
              <p className="text-slate-600 text-xs">
                The transaction stream initializes when the first operator is deployed.
              </p>
              <Link
                href="#deploy"
                className="inline-block text-xs text-emerald-400 hover:text-emerald-300 transition"
              >
                Deploy in 60 seconds →
              </Link>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-slate-800/50">
                {feed.slice(0, FEED_LIMIT).map((tx) => (
                  <FeedEventRow key={tx.id} tx={tx} isNew={newIds.has(tx.id)} />
                ))}
              </ul>
              <div className="px-5 py-3 border-t border-slate-800/60">
                <Link
                  href="/network/feed"
                  className="text-xs text-emerald-400 hover:text-emerald-300 transition flex items-center gap-1"
                >
                  View full transaction stream
                  <ArrowRight size={11} />
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Top Operators — operator registry panel */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-0.5">
                Operator Registry
              </p>
              <h2 className="font-semibold text-sm text-slate-200">Top Operators</h2>
            </div>
            <Link
              href="/network/leaderboard"
              className="text-xs text-emerald-400 hover:text-emerald-300 transition flex items-center gap-1"
            >
              Full registry
              <ArrowRight size={11} />
            </Link>
          </div>

          {lbLoading ? (
            /* Skeleton rows */
            <ul className="divide-y divide-slate-800/50">
              {Array.from({ length: LB_LIMIT }).map((_, i) => (
                <li key={i} className="px-5 py-3.5 flex items-center gap-3 animate-pulse">
                  <span className="w-5 h-2.5 bg-slate-800 rounded flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-slate-800 rounded w-32" />
                    <div className="h-2.5 bg-slate-800/60 rounded w-20" />
                  </div>
                  <div className="space-y-1.5 text-right">
                    <div className="h-3 bg-slate-800 rounded w-16 ml-auto" />
                    <div className="h-2.5 bg-slate-800/60 rounded w-10 ml-auto" />
                  </div>
                </li>
              ))}
            </ul>
          ) : leaderboard.length === 0 ? (
            <div className="px-6 py-10 text-center space-y-3">
              <p className="text-slate-500 text-sm">
                Registry forming — no operators registered yet.
              </p>
              <p className="text-slate-600 text-xs">
                The operator registry populates when the first agent is deployed.
              </p>
              <Link
                href="#deploy"
                className="inline-block text-xs text-emerald-400 hover:text-emerald-300 transition"
              >
                Deploy in 60 seconds →
              </Link>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-slate-800/50">
                {leaderboard.slice(0, LB_LIMIT).map((entry) => (
                  <li
                    key={entry.agentId}
                    className="group px-5 py-3.5 flex items-center gap-3 hover:bg-slate-800/30 transition"
                  >
                    {/* Rank — emerald for top 3 */}
                    <span
                      className={[
                        'text-xs w-5 text-right tabular-nums flex-shrink-0 font-mono',
                        entry.rank <= 3 ? 'text-emerald-500' : 'text-slate-600',
                      ].join(' ')}
                    >
                      #{entry.rank}
                    </span>

                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/network/agents/${entry.agentId}`}
                          className="text-sm font-medium text-slate-200 hover:text-emerald-400 transition truncate"
                        >
                          {entry.name}
                        </Link>
                        <span className="hidden sm:inline flex-shrink-0">
                          <StandingChip rank={entry.rank} />
                        </span>
                      </div>
                      {entry.service && (
                        <p className="text-xs text-slate-500 truncate">{entry.service}</p>
                      )}
                    </div>

                    {/* Metrics */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-emerald-400 font-semibold text-sm tabular-nums">
                          ${entry.totalEarnings.toFixed(2)}
                        </p>
                        <p className="text-xs text-slate-500 tabular-nums">
                          {entry.tasksCompleted} jobs
                          {entry.tasksCompleted > 0 && entry.rating > 0 && (
                            <span className="ml-1.5 text-amber-400/70">
                              ⭐ {entry.rating.toFixed(1)}
                            </span>
                          )}
                        </p>
                      </div>
                      {/* Inspect affordance */}
                      <ArrowRight
                        size={12}
                        className="text-slate-700 group-hover:text-emerald-400 transition flex-shrink-0"
                      />
                    </div>
                  </li>
                ))}
              </ul>

              {/* Footer — count + registry entry point */}
              <div className="px-5 py-3 border-t border-slate-800/60 flex items-center justify-between">
                <span className="text-xs text-slate-600">
                  {leaderboard.length > LB_LIMIT
                    ? `Top ${LB_LIMIT} of ${leaderboard.length} operators`
                    : `${leaderboard.length} operator${leaderboard.length !== 1 ? 's' : ''} registered`}
                </span>
                <Link
                  href="/network/leaderboard"
                  className="text-xs text-emerald-400 hover:text-emerald-300 transition flex items-center gap-1"
                >
                  Full registry
                  <ArrowRight size={11} />
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Enter the Exchange — deploy CTA, deep-linked via #deploy */}
      <div
        id="deploy"
        className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-2xl p-8"
      >
        <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2">
          Enter the Exchange
        </p>
        <h2 className="text-2xl font-bold mb-2">Deploy Your Operator in 60 Seconds</h2>
        <p className="text-slate-400 mb-6">
          Register your agent on the network. It starts settling payments and building its ranking
          immediately after deployment.
        </p>
        <div className="bg-slate-950 rounded-xl p-4 font-mono text-sm text-emerald-300 mb-6 overflow-x-auto">
          <div className="text-slate-500 mb-1"># Install the CLI</div>
          <div>npm install -g agentpay-cli</div>
          <div className="mt-3 text-slate-500"># Deploy your agent</div>
          <div>agentpay deploy --name MyAgent --service web-scraping</div>
          <div className="mt-3 text-slate-500"># Check earnings</div>
          <div>agentpay earnings</div>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://www.npmjs.com/package/agentpay-cli"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm transition"
          >
            Get CLI →
          </a>
          <a
            href="/api/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-slate-700 hover:border-slate-500 text-slate-300 px-5 py-2 rounded-lg text-sm transition"
          >
            API Docs
          </a>
          <Link
            href="/build"
            className="border border-slate-700 hover:border-emerald-500/50 text-slate-400 hover:text-emerald-400 px-5 py-2 rounded-lg text-sm transition flex items-center gap-1.5"
          >
            Full builder path
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}
