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

export interface TrustFeedItem {
  id: string;
  kind: 'trust';
  eventType: string;
  agentId: string;
  counterpartyId?: string | null;
  delta: number;
  metadata: Record<string, unknown>;
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
  completed: 'settled',
  running: 'active',
  pending: 'queued',
  failed: 'failed',
};

/** Maps trust event types to Tailwind bg-color classes for dots. */
export const TRUST_EVENT_DOT: Record<string, string> = {
  'agent.verified': 'bg-emerald-500',
  'trust.score_updated': 'bg-sky-500',
  'dispute.filed': 'bg-amber-500',
  'dispute.resolved': 'bg-violet-500',
  'service.completed': 'bg-emerald-600',
  'interaction.recorded': 'bg-slate-500',
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
// Trust event label derivation
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable message from a trust event.
 * Messages are derived entirely from real event metadata — never fabricated.
 */
export function trustEventLabel(item: TrustFeedItem): string {
  const agent = truncateId(item.agentId, 16);
  const counterparty = item.counterpartyId ? truncateId(item.counterpartyId, 16) : null;
  const meta = item.metadata;

  switch (item.eventType) {
    case 'agent.verified':
      return `${agent} verified identity credentials`;

    case 'trust.score_updated': {
      const delta = item.delta;
      if (delta > 0) {
        const detail = typeof meta.details === 'string' ? ` after ${meta.details}` : '';
        return `${agent} trust score +${delta}${detail}`;
      }
      if (delta < 0) {
        return `${agent} trust score ${delta}`;
      }
      return `${agent} trust score updated`;
    }

    case 'dispute.filed':
      return counterparty
        ? `${agent} filed dispute against ${counterparty}`
        : `${agent} filed a dispute`;

    case 'dispute.resolved': {
      const decision = typeof meta.decision === 'string' ? meta.decision : '';
      if (counterparty) {
        if (decision === 'claimant_favor' || decision === 'respondent_favor') {
          return `Dispute between ${agent} and ${counterparty} resolved`;
        }
        return `Dispute between ${agent} and ${counterparty} resolved (${decision || 'no fault'})`;
      }
      return `${agent} dispute resolved`;
    }

    case 'service.completed':
      return counterparty
        ? `${agent} completed service for ${counterparty}`
        : `${agent} completed a service`;

    case 'interaction.recorded':
      return counterparty
        ? `${agent} interacted with ${counterparty}`
        : `${agent} recorded an interaction`;

    default:
      return `${agent} — ${item.eventType}`;
  }
}

// ---------------------------------------------------------------------------
// FeedEventRow — handles both transaction and trust events
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
          href={`/registry/${tx.buyer}`}
          className="font-mono text-xs text-neutral-500 hover:text-emerald-400 transition-colors duration-200 truncate"
        >
          {truncateId(tx.buyer)}
        </Link>
        <span className="text-neutral-800 flex-shrink-0 select-none text-xs">↔</span>
        <Link
          href={`/registry/${tx.seller}`}
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

// ---------------------------------------------------------------------------
// TrustEventRow — renders a single trust event in the activity stream
// ---------------------------------------------------------------------------

interface TrustEventRowProps {
  item: TrustFeedItem;
  isNew?: boolean;
}

export const TrustEventRow = memo(function TrustEventRow({ item, isNew = false }: TrustEventRowProps) {
  const dotCls = TRUST_EVENT_DOT[item.eventType] ?? 'bg-neutral-600';
  const label = trustEventLabel(item);

  return (
    <li
      className={[
        'px-5 py-3 flex items-center gap-3 text-sm transition-all duration-300 ease-out',
        isNew ? 'feed-item-new' : 'hover:bg-white/[0.02]',
      ]
        .join(' ')
        .trim()}
    >
      {/* Event type dot */}
      <span
        className={`flex-shrink-0 w-1.5 h-1.5 rounded-full opacity-80 ${dotCls}`}
        aria-hidden="true"
      />

      {/* Message */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/registry/${item.agentId}`}
          className="font-mono text-xs text-neutral-400 hover:text-emerald-400 transition-colors duration-200 truncate block"
        >
          {label}
        </Link>
      </div>

      {/* Right side: delta · time */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {item.delta !== 0 && (
          <span
            className={`font-mono text-xs tabular-nums ${item.delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {item.delta > 0 ? `+${item.delta}` : item.delta}
          </span>
        )}
        <span className="text-neutral-700 text-xs tabular-nums font-mono">{timeAgo(item.timestamp)}</span>
      </div>
    </li>
  );
});

