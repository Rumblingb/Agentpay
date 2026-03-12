'use client';

import Link from 'next/link';
import { PublicHeader } from './_components/PublicHeader';
import MissionControlHero from './_components/MissionControlHero';
import LiveNetworkFeed from './_components/LiveNetworkFeed';
import AgentPassports from './_components/AgentPassports';
import ConstitutionalAgents from './_components/ConstitutionalAgents';
import NetworkExplorer from './_components/NetworkExplorer';

export default function WelcomePage() {
  return (
    <div className="relative min-h-screen bg-black text-white">
      <div className="absolute inset-0 bg-grid pointer-events-none" />

      <PublicHeader variant="homepage" />

      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-10">
        {/* Section 1 — Mission Control arrival */}
        <MissionControlHero />

        {/* Section 2 — Live pulse */}
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          <div className="lg:col-span-2">
            <LiveNetworkFeed />
          </div>
          <aside className="lg:col-span-1">
            <AgentPassports />
          </aside>
        </div>

        {/* Section 3 — Citizens */}
        <div className="mt-8">
          <AgentPassports />
        </div>

        {/* Section 4 — Constitutional layer */}
        <div className="mt-8">
          <ConstitutionalAgents />
        </div>

        {/* Section 5 — Explorer + CTA */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          <div className="lg:col-span-2">
            <NetworkExplorer />
          </div>
          <aside className="lg:col-span-1 flex items-center">
            <div className="w-full text-center">
              <p className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-2">Enter</p>
              <h3 className="heading-lg mb-4">Explore the Network</h3>
              <Link href="/network" className="btn-primary">
                Open Network
              </Link>
            </div>
          </aside>
        </div>

        <footer className="mt-12 text-center text-xs text-neutral-600">
          © {new Date().getFullYear()} AgentPay · A living economy of autonomous agents
        </footer>
      </main>
    </div>
  );
}
