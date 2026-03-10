'use client';

import { memo } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface FeedItem {
  id: string;
  buyer: string;
  seller: string;
  amount: number;
  status: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Shared formatting utilities
// ---------------------------------------------------------------------------

/** Maps transaction status values to Tailwind text-color classes. */
export const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-400',
  running: 'text-blue-400',
  pending: 'text-yellow-400',
  failed: 'text-red-400',
};

/** Maps transaction status values to Tailwind bg-color classes for dots/pills. */
export const STATUS_DOT: Record<string, string> = {
  completed: 'bg-emerald-400',
  running: 'bg-blue-400',
  pending: 'bg-yellow-400',
  failed: 'bg-red-400',
};

const DEFAULT_TRUNCATE_LEN = 14;

/** Truncates an agent ID to a readable length. */
export function truncateId(id: string, len = DEFAULT_TRUNCATE_LEN): string {
  return id.length > len ? id.slice(0, len) + '…' : id;
}

/** Returns a human-readable relative time string (e.g. "12s ago", "3m ago"). */
export function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// ---------------------------------------------------------------------------
// FeedEventRow
// ---------------------------------------------------------------------------

interface FeedEventRowProps {
  tx: FeedItem;
  /** Apply slide-in animation (for newly arrived items). */
  isNew?: boolean;
}

/**
 * A single exchange event row for use in feed list surfaces.
 *
 * Renders as a <li> — wrap in a <ul className="divide-y divide-slate-800/50">.
 *
 * Design:
 *   [status dot]  [buyer → seller]          [$amount]  [status]  [time]
 *
 * Used on:
 *   - homepage "The Current" preview
 *   - /network/feed full feed table (utilities only; table layout stays there)
 */
export const FeedEventRow = memo(function FeedEventRow({ tx, isNew = false }: FeedEventRowProps) {
  const dotCls = STATUS_DOT[tx.status] ?? 'bg-slate-500';
  const statusCls = STATUS_COLOR[tx.status] ?? 'text-slate-400';

  return (
    <li
      className={[
        'px-5 py-3 flex items-center gap-3 text-sm',
        isNew ? 'feed-item-new' : '',
      ]
        .join(' ')
        .trim()}
    >
      {/* Live-state dot */}
      <span
        className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${dotCls}`}
        aria-hidden="true"
      />

      {/* Counterparties */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <Link
          href={`/network/agents/${tx.buyer}`}
          className="font-mono text-xs text-slate-400 hover:text-emerald-400 transition truncate"
        >
          {truncateId(tx.buyer)}
        </Link>
        <span className="text-slate-700 flex-shrink-0 select-none">→</span>
        <Link
          href={`/network/agents/${tx.seller}`}
          className="font-mono text-xs text-slate-400 hover:text-emerald-400 transition truncate"
        >
          {truncateId(tx.seller)}
        </Link>
      </div>

      {/* Right side: amount · status · time */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-emerald-400 font-bold text-xs tabular-nums">
          ${tx.amount.toFixed(2)}
        </span>
        <span className={`text-xs font-medium ${statusCls} hidden sm:inline`}>
          {tx.status}
        </span>
        <span className="text-slate-600 text-xs tabular-nums">{timeAgo(tx.timestamp)}</span>
      </div>
    </li>
  );
});
