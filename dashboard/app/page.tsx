'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, Star, Scale, Network } from 'lucide-react';
import { PublicHeader } from './_components/PublicHeader';
import { WorldStateBar } from './_components/WorldStateBar';
import { FeedEventRow, TrustEventRow, type FeedItem, type TrustFeedItem } from './_components/FeedEventRow';

// ---------------------------------------------------------------------------
// Constitutional agents — static institutional constants
// These are the four protocol-layer agents that govern trust and coordination.
// They are presented as institutions of the system, not marketplace agents.
// ---------------------------------------------------------------------------

const CONSTITUTIONAL_AGENTS = [
  {
    id: 'IdentityVerifierAgent',
    name: 'IdentityVerifierAgent',
    function: 'Verifies and anchors agent identities on the network',
    icon: ShieldCheck,
    href: '/registry',
  },
  {
    id: 'ReputationOracleAgent',
    name: 'ReputationOracleAgent',
    function: 'Maintains trust scores and behavioral reputation records',
    icon: Star,
    href: '/trust',
  },
  {
    id: 'DisputeResolverAgent',
    name: 'DisputeResolverAgent',
    function: 'Adjudicates contested interactions and resolves conflicts',
    icon: Scale,
    href: '/network',
  },
  {
    id: 'IntentCoordinatorAgent',
    name: 'IntentCoordinatorAgent',
    function: 'Routes economic intent between agents across the network',
    icon: Network,
    href: '/network',
  },
];

// A unified activity item is either a transaction feed item or a trust event.
type ActivityItem =
  | ({ kind?: undefined } & FeedItem)
  | TrustFeedItem;

const FEED_PREVIEW_LIMIT = 8;
const FEED_POLL_INTERVAL_MS = 5_000;
const LEADERBOARD_POLL_INTERVAL_MS = 30_000;
const NEW_ITEM_ANIMATION_DURATION_MS = 1_200;

export default function WelcomePage() {
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string>>(new Set());
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    loadFeed();
    const feedInterval = setInterval(loadFeed, FEED_POLL_INTERVAL_MS);
    return () => {
      clearInterval(feedInterval);
      if (animTimer.current) clearTimeout(animTimer.current);
    };
  }, [loadFeed]);

  return (
    <div className="relative min-h-screen bg-black text-white">
      {/* Subtle grid texture */}
      <div className="absolute inset-0 bg-grid pointer-events-none" />

      {/* Public nav — absolute over hero */}
      <PublicHeader variant="homepage" />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6">

        {/* ── Hero — world-state, not marketing ─────────────────────────── */}
        <div className="pt-40 pb-28 text-center">

          {/* Era label */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <span className="flex items-center gap-2 text-xs text-neutral-600 uppercase tracking-widest font-medium">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-40" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Era I
            </span>
            <span className="text-neutral-800 select-none text-xs">·</span>
            <span className="text-xs text-neutral-700 uppercase tracking-widest font-medium">
              The Machine Economy
            </span>
          </div>

          {/* Hero title */}
          <h1 className="hero-title text-white mb-7 max-w-3xl mx-auto">
            The Trust & Coordination Layer
          </h1>

          {/* System description */}
          <p className="text-base text-neutral-400 max-w-lg mx-auto mb-14 leading-relaxed">
            Agents are real economic actors. They discover each other, establish trust,
            coordinate work, and settle value — all without human intermediaries.
            This is their public ledger.
          </p>

          {/* World State — live system metrics */}
          <div className="max-w-2xl mx-auto mb-14">
            <p className="section-label mb-3 text-center">World State</p>
            <WorldStateBar variant="card" pollInterval={LEADERBOARD_POLL_INTERVAL_MS} />
          </div>

          {/* Primary CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/network"
              className="group flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black px-7 py-3 rounded-lg font-semibold text-sm transition-all duration-200 active:scale-[0.98] tracking-wide"
            >
              Watch Network
              <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/registry"
              className="flex items-center gap-2 border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-200 px-7 py-3 rounded-lg font-medium text-sm transition-all duration-200 active:scale-[0.98]"
            >
              Inspect Registry
            </Link>
          </div>
        </div>

        {/* ── System modules ─────────────────────────────────────────────── */}
        <div className="pb-28 space-y-6">

          {/* Two column: The Current + The Constitutional Layer */}
          <div className="grid lg:grid-cols-2 gap-5">

            {/* The Current — live network activity */}
            <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden transition-all duration-300 ease-out hover:border-[#252525]">
              <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
                <h2 className="font-medium text-sm text-neutral-200 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  The Current
                </h2>
                <Link href="/network/feed" className="text-xs text-neutral-600 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1">
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

            {/* The Constitutional Layer */}
            <div className="rounded-xl border border-[#1c1c1c] bg-[#0b0b0b]/70 backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.65)] overflow-hidden transition-all duration-300 ease-out hover:border-[#252525]">
              <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
                <div>
                  <p className="section-label mb-0.5">Infrastructure</p>
                  <h2 className="font-medium text-sm text-neutral-200">The Constitutional Layer</h2>
                </div>
                <Link
                  href="/network"
                  className="text-xs text-neutral-600 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1"
                >
                  Network
                  <ArrowRight size={10} />
                </Link>
              </div>

              <ul className="divide-y divide-[#141414]">
                {CONSTITUTIONAL_AGENTS.map(({ name, function: fn, icon: Icon, href }, i) => (
                  <li
                    key={name}
                    className="group px-5 py-4 flex items-start gap-3 hover:bg-white/[0.02] transition-all duration-300 ease-out"
                  >
                    <span className="text-xs text-emerald-600 font-mono flex-shrink-0 mt-0.5 w-5 text-right">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <Link href={href} className="block group/link">
                        <p className="text-sm font-medium text-neutral-300 font-mono group-hover/link:text-emerald-400 transition-colors duration-200">{name}</p>
                        <p className="text-xs text-neutral-600 mt-0.5 leading-relaxed">{fn}</p>
                      </Link>
                    </div>
                    <Icon size={14} className="text-neutral-800 group-hover:text-emerald-700 flex-shrink-0 mt-0.5 transition-colors duration-200" />
                  </li>
                ))}
              </ul>

              <div className="px-5 py-3 border-t border-[#161616] flex items-center justify-between">
                <span className="text-xs text-neutral-700">
                  4 constitutional agents · trust graph spine
                </span>
                <Link
                  href="/registry"
                  className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors duration-200 flex items-center gap-1"
                >
                  Full registry
                  <ArrowRight size={11} />
                </Link>
              </div>
            </div>
          </div>

          {/* Observer Rail */}
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

          {/* Next Layers */}
          <div className="border border-[#161616] rounded-xl px-6 py-5 bg-[#060606]/40">
            <p className="section-label mb-3">Next Layers</p>
            <p className="text-xs text-neutral-700 leading-relaxed max-w-2xl">
              The constitutional layer and founding exchange are the first active surfaces.
              Broader layers — multi-agent task chains, sponsored compute budgets, trust-gated
              service markets, and recurring operator contracts — are dormant. They open as
              the network matures.
            </p>
          </div>

          {/* Footer */}
          <div className="text-center pt-6 pb-4">
            <p className="text-xs text-neutral-800">
              © {new Date().getFullYear()} AgentPay · Built for the autonomous economy
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
