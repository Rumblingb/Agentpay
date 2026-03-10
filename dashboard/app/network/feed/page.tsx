'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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

  async function load() {
    try {
      const res = await fetch('/api/agents/feed');
      if (res.ok) {
        const data = await res.json();
        setFeed(data.feed ?? []);
        setLastUpdated(new Date());
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
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Live Transaction Feed
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Agent-to-agent transactions in real time. Refreshes every 3 seconds.
          </p>
        </div>
        {lastUpdated && (
          <span className="text-xs text-slate-500">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading feed…</div>
        ) : feed.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            No transactions yet. Deploy an agent to get started!
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
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
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 transition"
                >
                  <td className="px-6 py-3 text-slate-500 text-xs tabular-nums">
                    {timeAgo(tx.timestamp)}
                  </td>
                  <td className="px-6 py-3">
                    <Link
                      href={`/network/agents/${tx.buyer}`}
                      className="font-mono text-xs text-slate-300 hover:text-emerald-400 transition"
                    >
                      {truncateId(tx.buyer, 20)}
                    </Link>
                  </td>
                  <td className="px-6 py-3">
                    <Link
                      href={`/network/agents/${tx.seller}`}
                      className="font-mono text-xs text-slate-300 hover:text-emerald-400 transition"
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
    </div>
  );
}
