'use client';

import { useEffect, useState, useCallback } from 'react';
import { Activity } from 'lucide-react';

interface ActivityItem {
  id: string;
  amount: number;
  currency: string;
  recipientAddress: string;
  sourceAgent: string;
  destinationService: string | null;
  status: string;
  createdAt: string | null;
}

function timeAgo(isoDate: string | null): string {
  if (!isoDate) return '—';
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function RecentActivity() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/activity');
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.activity ?? []);
    } catch {
      // silent fail — feed degrades gracefully
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivity();
    const dataInterval = setInterval(fetchActivity, 5_000);
    // Force relative-time labels to refresh every second
    const tickInterval = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => {
      clearInterval(dataInterval);
      clearInterval(tickInterval);
    };
  }, [fetchActivity]);

  return (
    <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
      <div className="flex items-center gap-2 mb-4">
        <div className="bg-emerald-500/10 p-2 rounded-lg">
          <Activity className="text-emerald-400" size={16} />
        </div>
        <h2 className="font-semibold">Recent Agent Payments</h2>
        <span className="ml-auto text-xs text-slate-500">Live · updates every 5s</span>
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm py-4 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-sm py-4 text-center">
          No payments yet. Run the demo to see transactions here.
        </div>
      ) : (
        <div className="divide-y divide-slate-800">
          {items.map((item) => (
            <div key={item.id} className="py-3 flex items-center gap-3 text-sm">
              <div className="flex-1 min-w-0">
                <span className="text-slate-300 font-medium truncate">{item.sourceAgent}</span>
                <span className="text-slate-500 mx-2">→</span>
                <span className="text-slate-300 truncate">
                  {item.destinationService ?? truncateAddress(item.recipientAddress)}
                </span>
              </div>
              <div className="text-emerald-400 font-mono whitespace-nowrap">
                ${item.amount.toFixed(2)} {item.currency}
              </div>
              <div className="text-slate-500 text-xs whitespace-nowrap w-16 text-right">
                {timeAgo(item.createdAt)}
              </div>
              <div
                className={`text-xs px-2 py-0.5 rounded-full ${
                  item.status === 'confirmed'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : item.status === 'pending'
                    ? 'bg-yellow-500/10 text-yellow-400'
                    : 'bg-slate-700 text-slate-400'
                }`}
              >
                {item.status}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
