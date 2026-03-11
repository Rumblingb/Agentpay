'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  type FeedItem,
  STATUS_COLOR,
  truncateId,
  timeAgo,
} from '../../_components/FeedEventRow';

export default function FeedPage() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Track the id of the most-recent item to skip re-renders when nothing changed
  const lastTopId = useRef<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/agents/feed');
      if (res.ok) {
        const data = await res.json();
        const incoming: FeedItem[] = data.feed ?? [];
        // Only update state when the feed has actually changed (new top item)
        const topId = incoming[0]?.id ?? null;
        if (topId !== lastTopId.current) {
          lastTopId.current = topId;
          setFeed(incoming);
          setLastUpdated(new Date());
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1.5">
            Exchange Floor
          </p>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            Live Feed
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Agent-to-agent transactions in real time. Refreshes every 3 seconds.
          </p>
        </div>
        {lastUpdated && (
          <span className="text-xs text-neutral-500">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="bg-[#0b0b0b]/70 border border-[#1c1c1c] rounded-xl overflow-hidden">
        {loading ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 border-b border-[#1c1c1c]">
                <th className="text-left px-6 py-3 font-medium text-neutral-600 text-xs uppercase tracking-widest">Time</th>
                <th className="text-left px-6 py-3 font-medium">Buyer Agent</th>
                <th className="text-left px-6 py-3 font-medium">Seller Agent</th>
                <th className="text-right px-6 py-3 font-medium">Amount</th>
                <th className="text-left px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[#1a1a1a] animate-pulse">
                  <td className="px-6 py-3"><div className="h-3 bg-neutral-800 rounded w-12" /></td>
                  <td className="px-6 py-3"><div className="h-3 bg-neutral-800 rounded w-32" /></td>
                  <td className="px-6 py-3"><div className="h-3 bg-neutral-800 rounded w-32" /></td>
                  <td className="px-6 py-3 text-right"><div className="h-3 bg-neutral-800 rounded w-14 ml-auto" /></td>
                  <td className="px-6 py-3"><div className="h-3 bg-neutral-800 rounded w-16" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : feed.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-3 text-neutral-500">
            <p>No transactions yet.</p>
            <p className="text-xs text-neutral-600">
              The feed initializes when the first agent is deployed.
            </p>
            <Link
              href="/build"
              className="inline-block text-xs text-emerald-400 hover:text-emerald-300 transition"
            >
              Deploy the first operator →
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 border-b border-[#1c1c1c]">
                <th className="text-left px-6 py-3 font-medium">Time</th>
                <th className="text-left px-6 py-3 font-medium">Buyer Agent</th>
                <th className="text-left px-6 py-3 font-medium">Seller Agent</th>
                <th className="text-right px-6 py-3 font-medium">Amount</th>
                <th className="text-left px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {feed.map((tx) => (
                <tr
                  key={tx.id}
                  className="border-b border-[#1a1a1a] hover:bg-white/[0.02] transition"
                >
                  <td className="px-6 py-3 text-neutral-500 text-xs tabular-nums">
                    {timeAgo(tx.timestamp)}
                  </td>
                  <td className="px-6 py-3">
                    <Link
                      href={`/registry/${tx.buyer}`}
                      className="font-mono text-xs text-neutral-300 hover:text-emerald-400 transition"
                    >
                      {truncateId(tx.buyer, 20)}
                    </Link>
                  </td>
                  <td className="px-6 py-3">
                    <Link
                      href={`/registry/${tx.seller}`}
                      className="font-mono text-xs text-neutral-300 hover:text-emerald-400 transition"
                    >
                      {truncateId(tx.seller, 20)}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-right font-semibold text-emerald-400 tabular-nums">
                    ${tx.amount.toFixed(2)}
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={`text-xs font-medium ${STATUS_COLOR[tx.status] ?? 'text-slate-400'}`}
                    >
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer navigation */}
      <div className="flex flex-wrap items-center gap-5 text-xs border-t border-[#1c1c1c] pt-4">
        <Link href="/network/leaderboard" className="text-neutral-500 hover:text-neutral-300 transition flex items-center gap-1">
          Leaderboard <ArrowRight size={10} />
        </Link>
        <Link href="/registry" className="text-neutral-500 hover:text-neutral-300 transition flex items-center gap-1">
          Registry <ArrowRight size={10} />
        </Link>
        <Link href="/trust" className="text-neutral-500 hover:text-neutral-300 transition flex items-center gap-1">
          Trust Order <ArrowRight size={10} />
        </Link>
        <Link href="/build" className="text-emerald-500 hover:text-emerald-400 transition flex items-center gap-1 ml-auto">
          Build on AgentPay <ArrowRight size={10} />
        </Link>
      </div>
    </div>
  );
}
