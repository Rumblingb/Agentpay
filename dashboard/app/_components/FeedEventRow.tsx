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
  running: 'text-sky-400',
  pending: 'text-amber-400',
  failed: 'text-red-400',
};

/** Maps transaction status values to Tailwind bg-color classes for dots/pills. */
export const STATUS_DOT: Record<string, string> = {
  completed: 'bg-emerald-500',
  running: 'bg-sky-500',
  pending: 'bg-amber-500',
  failed: 'bg-red-500',
};

/** Maps transaction status values to human-readable interaction verbs. */
export const STATUS_VERB: Record<string, string> = {
  completed: 'completed',
  running: 'active',
  pending: 'queued',
  failed: 'failed',
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
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
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
 * A single network interaction event row for use in feed list surfaces.
 *
 * Renders as a <li> — wrap in a <ul className="divide-y divide-[#1a1a1a]">.
 *
 * Design:
 *   [status dot]  [initiator ↔ recipient]   [$amount]  [verb]  [time]
 */
export const FeedEventRow = memo(function FeedEventRow({ tx, isNew = false }: FeedEventRowProps) {
  const dotCls = STATUS_DOT[tx.status] ?? 'bg-neutral-600';
  const statusCls = STATUS_COLOR[tx.status] ?? 'text-neutral-400';
  const verb = STATUS_VERB[tx.status] ?? tx.status;

  return (
    <li
      className={[
        'px-5 py-3 flex items-center gap-3 text-sm transition-all duration-300 ease-out',
        isNew ? 'feed-item-new' : 'hover:bg-white/[0.02]',
      ]
        .join(' ')
        .trim()}
    >
      {/* Live-state dot */}
      <span
        className={`flex-shrink-0 w-1.5 h-1.5 rounded-full opacity-80 ${dotCls}`}
        aria-hidden="true"
      />

      {/* Counterparties */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <Link
          href={`/network/agents/${tx.buyer}`}
          className="font-mono text-xs text-neutral-500 hover:text-emerald-400 transition-colors duration-200 truncate"
        >
          {truncateId(tx.buyer)}
        </Link>
        <span className="text-neutral-800 flex-shrink-0 select-none text-xs">↔</span>
        <Link
          href={`/network/agents/${tx.seller}`}
          className="font-mono text-xs text-neutral-500 hover:text-emerald-400 transition-colors duration-200 truncate"
        >
          {truncateId(tx.seller)}
        </Link>
      </div>

      {/* Right side: amount · verb · time */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-emerald-400 font-mono text-xs tabular-nums">
          ${tx.amount.toFixed(2)}
        </span>
        <span className={`text-xs ${statusCls} hidden sm:inline opacity-80`}>
          {verb}
        </span>
        <span className="text-neutral-700 text-xs tabular-nums font-mono">{timeAgo(tx.timestamp)}</span>
      </div>
    </li>
  );
});
