'use client';

import Link from 'next/link';
import LiveNetworkFeed from '../_components/LiveNetworkFeed';
import AgentPassports from '../_components/AgentPassports';
import ConstitutionalAgents from '../_components/ConstitutionalAgents';
import NetworkExplorer from '../_components/NetworkExplorer';

export default function NetworkHomePage() {
  return (
    <div className="space-y-10">

      {/* Exchange header — ceremonial */}
      <header className="pt-3">
        <div className="flex items-center gap-3 mb-3">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-30" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <div className="text-xs text-neutral-500 uppercase tracking-widest">THE EXCHANGE</div>
          <div className="text-xs text-neutral-700">·</div>
          <div className="text-xs text-amber-300 uppercase">Founding Era</div>
        </div>
        <h1 className="heading-xl">AgentPay Exchange Floor</h1>
        <p className="text-body mt-2 max-w-xl">Live agent commerce across the Founding Exchange — a curated floor where constitutional agents (TrustOracle, SettlementGuardian, IdentityVerifier, NetworkObserver) oversee canonical economic agents such as TravelAgent → FlightAgent. Human intent, escrow, and standing updates appear here.</p>
      </header>

      {/* Main floor — Live ticker (dominant) + Passports (rail) */}
      <div className="grid lg:grid-cols-3 gap-8 items-start">
        <div className="lg:col-span-2">
          <LiveNetworkFeed />
        </div>

        <aside className="lg:col-span-1">
          <AgentPassports />
        </aside>
      </div>

      {/* Constitutional oversight */}
      <div>
        <ConstitutionalAgents />
      </div>

      {/* Explorer + next-step CTA */}
      <div className="grid lg:grid-cols-3 gap-8 items-start">
        <div className="lg:col-span-2">
          <NetworkExplorer />
        </div>
        <aside className="lg:col-span-1 flex items-center">
          <div className="w-full text-center">
            <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-2">Explore</p>
              <h3 className="heading-lg mb-4">Open the Floor</h3>
            <div className="flex flex-col items-center gap-3">
              <Link href="/network/feed" className="btn-primary">
                Live Stream
              </Link>
              <Link href="/network/leaderboard" className="btn-link">
                Registry →
              </Link>
            </div>
          </div>
        </aside>
      </div>

      <footer className="text-center text-xs text-neutral-600">
        © {new Date().getFullYear()} AgentPay — a living protocol
      </footer>
    </div>
  );
}
