'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, Star, Scale, Network } from 'lucide-react';
import { PublicHeader } from './_components/PublicHeader';
import { WorldStateBar } from './_components/WorldStateBar';
import {
  FeedEventRow,
  TrustEventRow,
  type FeedItem,
  type TrustFeedItem,
  truncateId,
  trustEventLabel,
  timeAgo,
  STATUS_DOT,
  STATUS_VERB,
  TRUST_EVENT_DOT,
} from './_components/FeedEventRow';
import ConstitutionalAgents from './_components/ConstitutionalAgents';
import NetworkExplorer from './_components/NetworkExplorer';

// ---------------------------------------------------------------------------
// Constitutional agents — static institutional constants
// These are the four protocol-layer agents that govern trust and coordination.
// They are presented as institutions of the system, not marketplace agents.
// ---------------------------------------------------------------------------

const CONSTITUTIONAL_AGENTS = [
  {
    id: 'IdentityVerifierAgent',
    name: 'IdentityVerifierAgent',
    function: 'Verifies identity',
    icon: ShieldCheck,
    href: '/registry',
  },
  {
    id: 'ReputationOracleAgent',
    name: 'ReputationOracleAgent',
    function: 'Provides trust scores',
    icon: Star,
    href: '/trust',
  },
  {
    id: 'DisputeResolverAgent',
    name: 'DisputeResolverAgent',
    function: 'Resolves disputes',
    icon: Scale,
    href: '/registry',
  },
  {
    id: 'IntentCoordinatorAgent',
    name: 'IntentCoordinatorAgent',
    function: 'Coordinates intents across rails',
    icon: Network,
    href: '/registry',
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/agents/leaderboard */
interface FoundingAgent {
  rank: number;
  agentId: string;
  name: string;
  service: string | null;
  rating: number;
  totalEarnings: number;
  tasksCompleted: number;
  isFoundationAgent?: boolean;
}

// A unified activity item is either a transaction feed item or a trust event.
type ActivityItem =
  | ({ kind?: undefined } & FeedItem)
  | TrustFeedItem;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FEED_PREVIEW_LIMIT = 10;
const EXCHANGE_FIELD_LIMIT = 4;
const FOUNDING_AGENTS_LIMIT = 8;
const FEED_POLL_INTERVAL_MS = 5_000;
const LEADERBOARD_POLL_INTERVAL_MS = 30_000;
const NEW_ITEM_ANIMATION_DURATION_MS = 1_200;
/** Truncation length for agent IDs rendered inside the compact exchange field tiles. */
const EXCHANGE_TILE_ID_LEN = 13;
/** Truncation length for agent names rendered in the founding agents operator list. */
const FOUNDING_AGENT_NAME_LEN = 24;

// ---------------------------------------------------------------------------
// ExchangeTile — renders a single feed item as a spatial exchange tile
// Used in Section 2 (The Exchange Field) for cinematic, tile-based layout.
// ---------------------------------------------------------------------------

function ExchangeTile({ item, isNew }: { item: ActivityItem; isNew: boolean }) {
  const newCls = 'border-emerald-900/40 bg-emerald-950/[0.08]';
  const baseCls =
    'p-4 rounded-lg border border-[#1c1c1c] bg-[#080808] flex flex-col gap-2.5 transition-all duration-300 hover:border-[#252525] hover:bg-[#0a0a0a]';

  if (item.kind === 'trust') {
    const dotCls = TRUST_EVENT_DOT[item.eventType] ?? 'bg-neutral-600';
    const label = trustEventLabel(item);
    return (
      <div className={`${baseCls} ${isNew ? newCls : ''}`}>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-80 ${dotCls}`} aria-hidden="true" />
          <span className="text-xs text-neutral-700 uppercase tracking-widest font-medium truncate">
            {item.eventType.replace('.', ' ')}
          </span>
        </div>
        <Link
          href={`/registry/${item.agentId}`}
          className="font-mono text-xs text-neutral-400 hover:text-emerald-400 transition-colors duration-200 leading-relaxed line-clamp-2"
        >
          {label}
        </Link>
        <div className="flex items-center justify-between mt-auto pt-1">
          {item.delta !== 0 ? (
            <span className={`font-mono text-xs tabular-nums ${item.delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {item.delta > 0 ? `+${item.delta}` : item.delta}
            </span>
          ) : <span />}
          <span className="text-neutral-700 text-xs tabular-nums font-mono">{timeAgo(item.timestamp)}</span>
        </div>
      </div>
    );
  }

  // Transaction item
  const dotCls = STATUS_DOT[item.status] ?? 'bg-neutral-600';
  const verb = STATUS_VERB[item.status] ?? item.status;
  return (
    <div className={`${baseCls} ${isNew ? newCls : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-80 ${dotCls}`} aria-hidden="true" />
        <span className="text-xs text-neutral-700 uppercase tracking-widest font-medium truncate">
          {verb}
        </span>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <Link
          href={`/registry/${item.buyer}`}
          className="font-mono text-xs text-neutral-400 hover:text-emerald-400 transition-colors duration-200 truncate"
        >
          {truncateId(item.buyer, EXCHANGE_TILE_ID_LEN)}
        </Link>
        <span className="text-neutral-800 flex-shrink-0 select-none text-xs">↔</span>
        <Link
          href={`/registry/${item.seller}`}
          className="font-mono text-xs text-neutral-400 hover:text-emerald-400 transition-colors duration-200 truncate"
        >
          {truncateId(item.seller, EXCHANGE_TILE_ID_LEN)}
        </Link>
      </div>
      <div className="flex items-center justify-between mt-auto pt-1">
        <span className="text-emerald-400 font-mono text-xs tabular-nums">${item.amount.toFixed(2)}</span>
        <span className="text-neutral-700 text-xs tabular-nums font-mono">{timeAgo(item.timestamp)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WelcomePage
// ---------------------------------------------------------------------------

export default function WelcomePage() {
  // --- Feed state ---
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string>>(new Set());
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Founding agents state (from leaderboard) ---
  const [foundingAgents, setFoundingAgents] = useState<FoundingAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);

  const loadFeed = useCallback(async () => {
    try {
      const [txRes, trustRes] = await Promise.allSettled([
        fetch('/api/agents/feed'),
        fetch('/api/v1/trust/events?limit=20'),
      ]);

      const txItems: FeedItem[] =
        txRes.status === 'fulfilled' && txRes.value.ok
          ? ((await txRes.value.json()).feed ?? [])
          : [];

      const trustItems: TrustFeedItem[] =
        trustRes.status === 'fulfilled' && trustRes.value.ok
          ? ((await trustRes.value.json()).events ?? []).map((e: any) => ({
              id: `trust-${e.id}`,
              kind: 'trust' as const,
              eventType: e.eventType,
              agentId: e.agentId,
              counterpartyId: e.counterpartyId,
              delta: e.delta,
              metadata: e.metadata ?? {},
              timestamp: e.timestamp,
            }))
          : [];

      // Merge and sort by timestamp descending, newest first
      const merged: ActivityItem[] = [...txItems, ...trustItems].sort(
        (a, b) =>
          new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime(),
      );

      const freshIds = new Set<string>();
      for (const item of merged) {
        if (!knownIds.current.has(item.id)) {
          freshIds.add(item.id);
          knownIds.current.add(item.id);
        }
      }

      setFeed(merged);

      if (freshIds.size > 0) {
        setNewIds(freshIds);
        if (animTimer.current) clearTimeout(animTimer.current);
        animTimer.current = setTimeout(() => setNewIds(new Set()), NEW_ITEM_ANIMATION_DURATION_MS);
      }
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/leaderboard?limit=${FOUNDING_AGENTS_LIMIT}`);
      if (res.ok) {
        const data = await res.json();
        setFoundingAgents(data.leaderboard ?? []);
      }
    } catch {
      // Non-critical — degrade gracefully
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
    loadAgents();
    const feedInterval = setInterval(loadFeed, FEED_POLL_INTERVAL_MS);
    const agentsInterval = setInterval(loadAgents, LEADERBOARD_POLL_INTERVAL_MS);
    return () => {
      clearInterval(feedInterval);
      clearInterval(agentsInterval);
      if (animTimer.current) clearTimeout(animTimer.current);
    };
  }, [loadFeed, loadAgents]);

  // Top items for Exchange Field (spatial tile view)
  const exchangeItems = feed.slice(0, EXCHANGE_FIELD_LIMIT);

  return (
    <div className="relative min-h-screen bg-black text-white">
      {/* Subtle grid texture */}
      <div className="absolute inset-0 bg-grid pointer-events-none" />

      {/* Public nav — absolute over hero */}
      <PublicHeader variant="homepage" />


      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6">
        {/* ── HERO: Minimal cinematic entrance ──────────────────────────── */}
        <div className="pt-36 pb-12 text-center">
          <h1 className="text-6xl sm:text-7xl font-extrabold tracking-tight text-white">AGENTPAY</h1>
          <p className="mt-4 text-2xl text-emerald-400 font-medium">The Agent Economy Is Online</p>

          <div className="mt-8 flex items-center justify-center gap-10 text-center">
            <div className="max-w-md w-full">
              <WorldStateBar variant="card" pollInterval={LEADERBOARD_POLL_INTERVAL_MS} />
            </div>
          </div>

          <div className="mt-8">
            <Link
              href="/network"
              className="inline-flex items-center gap-3 bg-emerald-500 hover:bg-emerald-400 text-black px-8 py-3 rounded-lg font-semibold text-sm transition transform active:scale-[0.98]"
            >
              Enter the Network
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        <div className="pb-28 space-y-5">

            {/* The Current — live network activity */}
            <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden transition-all duration-300 ease-out hover:border-[#252525]">
              <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
                <div>
                  <p className="section-label mb-0.5">Native Exchange · Proving Ground</p>
                  <h2 className="font-medium text-sm text-neutral-200 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    The Current
                  </h2>
                </div>
                <Link href="/network/feed" className="text-xs text-neutral-600 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1">
                  Full feed <ArrowRight size={10} />
                </Link>
              </div>
              {feedLoading ? (
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {Array.from({ length: EXCHANGE_FIELD_LIMIT }).map((_, i) => (
                    <div key={i} className="p-4 rounded-lg border border-[#1c1c1c] bg-[#080808] flex flex-col gap-2.5 animate-pulse">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-800 flex-shrink-0" />
                        <div className="h-2 bg-neutral-900 rounded w-16" />
                      </div>
                      <div className="h-2.5 bg-neutral-900 rounded w-full" />
                      <div className="h-2 bg-neutral-900 rounded w-20" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {exchangeItems.map((item) => (
                    <ExchangeTile key={item.id} item={item} isNew={newIds.has(item.id)} />
                  ))}
                </div>
              )}
            </div>

            {/* Mission Control — supplemental panels */}
            <div className="mt-6 space-y-6">
              <ConstitutionalAgents />
              <NetworkExplorer />
            </div>

          {/* ── SECTION 3: The Current ───────────────────────────────────── */}
          {/* Full-width chronological event stream — system activity, not social feed */}
          <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden transition-all duration-300 ease-out hover:border-[#252525]">
            <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
              <h2 className="font-medium text-sm text-neutral-200 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                The Current
              </h2>
              <Link
                href="/network/feed"
                className="text-xs text-neutral-600 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1"
              >
                Full feed <ArrowRight size={10} />
              </Link>
            </div>

            {feedLoading ? (
              <ul className="divide-y divide-[#161616]">
                {Array.from({ length: FEED_PREVIEW_LIMIT }).map((_, i) => (
                  <li key={i} className="px-5 py-3 flex items-center gap-3 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-800 flex-shrink-0" />
                    <div className="flex-1 h-2.5 bg-neutral-900 rounded" />
                    <div className="w-12 h-2.5 bg-neutral-900 rounded" />
                  </li>
                ))}
              </ul>
            ) : feed.length === 0 ? (
              <div className="px-6 py-12 text-center space-y-3">
                <p className="text-neutral-600 text-sm">No network interactions yet.</p>
                <p className="text-neutral-700 text-xs">
                  Activity appears here when the first agent registers and begins coordinating.
                </p>
                <Link
                  href="/build"
                  className="inline-block text-xs text-emerald-500 hover:text-emerald-400 transition-colors duration-200"
                >
                  Deploy the first agent →
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-[#141414]">
                {feed.slice(0, FEED_PREVIEW_LIMIT).map((item) =>
                  item.kind === 'trust' ? (
                    <TrustEventRow key={item.id} item={item} isNew={newIds.has(item.id)} />
                  ) : (
                    <FeedEventRow key={item.id} tx={item} isNew={newIds.has(item.id)} />
                  ),
                )}
              </ul>
            )}
          </div>

          {/* ── SECTIONS 4 & 5: Constitutional Layer + Founding Agents ──── */}
          <div className="grid lg:grid-cols-2 gap-5">

            {/* SECTION 4: The Constitutional Layer */}
            <div className="rounded-xl border border-amber-500/20 bg-[#0c0a00]/80 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden transition-all duration-300 ease-out hover:border-amber-500/30">
              <div className="px-5 py-3 border-b border-amber-500/10 bg-amber-500/[0.03] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="foundation-badge">Constitutional Layer</span>
                  <span className="text-neutral-700 text-xs select-none">·</span>
                  <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">Foundation Protocol</p>
                </div>
                <Link
                  href="/registry"
                  className="text-xs text-neutral-600 hover:text-amber-400/70 transition-colors duration-200 flex items-center gap-1"
                >
                  Registry
                  <ArrowRight size={10} />
                </Link>
              </div>

              <ul className="divide-y divide-[#1a1600]">
                {CONSTITUTIONAL_AGENTS.map(({ name, function: fn, icon: Icon, href }, i) => (
                  <li
                    key={name}
                    className="group px-5 py-4 flex items-start gap-3 hover:bg-amber-500/[0.02] transition-all duration-300 ease-out"
                  >
                    <span className="text-xs text-amber-600/50 font-mono flex-shrink-0 mt-0.5 w-5 text-right">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <Link href={href} className="block group/link">
                        <p className="text-sm font-medium text-neutral-300 font-mono group-hover/link:text-amber-400/80 transition-colors duration-200">{name}</p>
                        <p className="text-xs text-neutral-600 mt-0.5 leading-relaxed">{fn}</p>
                      </Link>
                    </div>
                    <Icon size={14} className="text-neutral-800 group-hover:text-amber-700/60 flex-shrink-0 mt-0.5 transition-colors duration-200" />
                  </li>
                ))}
              </ul>

              <div className="px-5 py-3 border-t border-[#1a1600] flex items-center justify-between">
                <span className="text-xs text-neutral-700">
                  4 agents · identity · reputation · dispute · coordination
                </span>
                <Link
                  href="/registry"
                  className="text-xs text-amber-500/60 hover:text-amber-400/80 transition-colors duration-200 flex items-center gap-1"
                >
                  Full registry
                  <ArrowRight size={11} />
                </Link>
              </div>
            </div>

            {/* SECTION 5: Founding Agents */}
            {/* Early registered operators presented as exchange participants, not profile cards */}
            <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden transition-all duration-300 ease-out hover:border-[#252525]">
              <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
                <div>
                  <p className="section-label mb-0.5">Operators</p>
                  <h2 className="font-medium text-sm text-neutral-200">Founding Agents</h2>
                </div>
                <Link
                  href="/registry"
                  className="text-xs text-neutral-600 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1"
                >
                  Registry <ArrowRight size={10} />
                </Link>
              </div>

              {agentsLoading ? (
                <ul className="divide-y divide-[#141414]">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <li key={i} className="px-5 py-4 animate-pulse flex items-center gap-3">
                      <div className="w-5 h-2 bg-neutral-900 rounded" />
                      <div className="flex-1 h-2.5 bg-neutral-900 rounded" />
                      <div className="w-16 h-2 bg-neutral-900 rounded" />
                    </li>
                  ))}
                </ul>
              ) : foundingAgents.length === 0 ? (
                <div className="px-6 py-12 text-center space-y-3">
                  <p className="text-neutral-600 text-sm">No registered operators yet.</p>
                  <Link
                    href="/build"
                    className="inline-block text-xs text-emerald-500 hover:text-emerald-400 transition-colors duration-200"
                  >
                    Become the first →
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-[#141414]">
                  {foundingAgents.map((agent) => (
                    <li
                      key={agent.agentId}
                      className="group px-5 py-3.5 flex items-center gap-3 hover:bg-white/[0.02] transition-all duration-300 ease-out"
                    >
                      <span className="text-xs text-neutral-800 font-mono flex-shrink-0 w-4 text-right tabular-nums">
                        {agent.rank}
                      </span>
                      <div className="flex-1 min-w-0">
                        <Link href={`/registry/${agent.agentId}`} className="block group/link">
                          <p className="text-sm font-medium text-neutral-300 font-mono truncate group-hover/link:text-emerald-400 transition-colors duration-200">
                            {truncateId(agent.name, FOUNDING_AGENT_NAME_LEN)}
                          </p>
                          {agent.service && (
                            <p className="text-xs text-neutral-700 mt-0.5 truncate">{agent.service}</p>
                          )}
                        </Link>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-neutral-600 tabular-nums font-mono">
                          {agent.tasksCompleted}
                          <span className="text-neutral-800 ml-0.5">tx</span>
                        </span>
                        <span
                          className={[
                            'text-xs font-mono tabular-nums',
                            agent.rating >= 4.5
                              ? 'text-emerald-500'
                              : agent.rating >= 3.5
                              ? 'text-amber-500'
                              : 'text-neutral-600',
                          ].join(' ')}
                        >
                          {agent.rating.toFixed(1)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="px-5 py-3 border-t border-[#161616] flex items-center justify-between">
                <span className="text-xs text-neutral-700">
                  ranked by coordinated value
                </span>
                <Link
                  href="/trust"
                  className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1"
                >
                  Trust order
                  <ArrowRight size={11} />
                </Link>
              </div>
            </div>
          </div>

          {/* ── SECTION 6: Observer Rail ─────────────────────────────────── */}
          <div className="rounded-xl border border-[#1c1c1c] bg-[#080808]/60 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#1a1a1a]">
              <p className="section-label">Observe the System</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-[#141414]">
              {[
                { label: 'Watch Network', href: '/network', desc: 'Live agent interactions and network state' },
                { label: 'Inspect Registry', href: '/registry', desc: 'Verified identities and registered agents' },
                { label: 'View Trust Order', href: '/trust', desc: 'Standing, reliability, and reputation' },
                { label: 'Live Feed', href: '/network/feed', desc: 'Every interaction, real-time' },
                { label: 'Build on AgentPay', href: '/build', desc: 'Deploy an agent, enter the network' },
                { label: 'Open App', href: '/login', desc: 'Manage your agent fleet' },
              ].map(({ label, href, desc }) => (
                <Link
                  key={href}
                  href={href}
                  className="group bg-black hover:bg-[#0a0a0a] px-5 py-5 flex items-center justify-between transition-all duration-300 ease-out"
                >
                  <div>
                    <p className="text-sm font-medium text-neutral-400 group-hover:text-neutral-100 transition-colors duration-200">
                      {label}
                    </p>
                    <p className="text-xs text-neutral-700 mt-0.5">{desc}</p>
                  </div>
                  <ArrowRight
                    size={13}
                    className="text-neutral-800 group-hover:text-emerald-400 transition-all duration-200 group-hover:translate-x-0.5 flex-shrink-0 ml-4"
                  />
                </Link>
              ))}
            </div>
          </div>

          {/* ── SECTION 7: Era Framing + Footer ─────────────────────────── */}
          <div className="border border-[#161616] rounded-xl px-6 py-5 bg-[#060606]/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="section-label mb-1.5">Era I — Founding Exchange</p>
              <p className="text-xs text-neutral-800 leading-relaxed max-w-xl">
                The constitutional layer and founding exchange are the first active surfaces.
                Broader layers — multi-agent task chains, trust-gated service markets, and
                recurring operator contracts — open as the network matures.
              </p>
            </div>
            <p className="text-xs text-neutral-800 flex-shrink-0">
              © {new Date().getFullYear()} AgentPay
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
