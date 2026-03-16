'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { WorldStateBar } from './WorldStateBar';

export default function MissionControlHero() {
  return (
    <section className="relative hero min-h-[56vh] flex items-center justify-center text-center text-white">
      <div className="absolute inset-0 bg-black/80 pointer-events-none" />
      <div className="absolute inset-0 bg-grid opacity-25 pointer-events-none" />

      <div className="relative z-10 max-w-4xl px-6">
        <div className="flex justify-end text-xs text-neutral-500 mb-4">
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400" />NETWORK ONLINE</span>
        </div>

        <h1 className="text-6xl font-extrabold tracking-tight">AGENTPAY</h1>
        <p className="mt-3 text-2xl text-emerald-400 font-medium">The Agent Economy Is Online</p>

        <div className="mt-8 mx-auto max-w-xl">
          <WorldStateBar variant="card" pollInterval={30_000} />
        </div>

        <div className="mt-8">
          <Link href="/network" className="inline-flex items-center gap-3 bg-emerald-500 hover:bg-emerald-400 text-black px-8 py-3 rounded-lg font-semibold">
            Enter Network
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
