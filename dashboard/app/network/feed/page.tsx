"use client";

/*
  This page must feel like the trading floor of a new economic system.
  It should NOT resemble a SaaS analytics dashboard, admin panel, or generic activity feed.
  Instead it should resemble a financial exchange terminal, a blockchain explorer,
  and a network operations console.

  Required sections (keep these exact):
  - Exchange Status Strip
  - Live Event Stream
  - Transaction Narrative Expansion
  - Network Graph Panel
  - Constitutional Events

  Events appear as a streaming ledger. New events append to the top in real time.
*/

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

type EventType =
  | 'Transactions'
  | 'Escrow lifecycle'
  | 'Trust verification'
  | 'Identity attestations'
  | 'Passport reputation updates'
  | 'Constitutional agent actions'
  | 'Network integrity checks';

type FeedEvent = {
  id: string;
  kind: EventType;
  title: string;
  detail?: string;
  txId?: string;
  agents?: string[];
  value?: number;
  trust?: number | 'Verified' | 'Unverified';
  latencyMs?: number;
  at: number;
};

export default function FeedPage() {
  const [events, setEvents] = useState<FeedEvent[]>(() => seedEvents());
  const streamRef = useRef<number | null>(null);

  useEffect(() => {
    // Simulated streaming ledger: new events append to the top in real time.
    function pushRandom() {
      const e = generateEvent();
      setEvents((prev) => [e, ...prev].slice(0, 200));
    }

    streamRef.current = window.setInterval(pushRandom, 1800 + Math.random() * 1200);
    return () => { if (streamRef.current) clearInterval(streamRef.current); };
  }, []);

  const stats = computeStats(events);

  return (
    <div className="space-y-6 text-neutral-100">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-xs text-neutral-400 uppercase tracking-widest">AGENTPAY EXCHANGE</div>
          <h1 className="text-3xl font-semibold mt-1">Exchange Floor <span className="text-sm text-neutral-500">/ Live Machine Commerce</span></h1>
          <p className="text-neutral-500 mt-2 max-w-2xl">A dark, cinematic trading floor displaying intents, escrows, trust attestations and passport updates as a real-time ledger.</p>
        </div>

        {/* Exchange Status Strip */}
        <aside className="text-xs text-neutral-400 text-right">
          <div className="mb-2 font-mono">Exchange Status Strip</div>
          <div className="bg-[#0b0b0b] p-3 rounded-lg text-right shadow-glow">
            <div className="grid grid-cols-2 gap-2 text-right">
              <div className="text-neutral-500">Active Agents</div><div className="font-semibold text-emerald-300">{stats.activeAgents}</div>
              <div className="text-neutral-500">Tx / min</div><div className="font-semibold text-emerald-300">{stats.txPerMin.toFixed(1)}</div>
              <div className="text-neutral-500">Escrow Volume</div><div className="font-semibold text-emerald-300">${stats.escrowValue.toFixed(0)}</div>
              <div className="text-neutral-500">Trust Events</div><div className="font-semibold text-emerald-300">{stats.trustEvents}</div>
            </div>
          </div>
        </aside>
      </header>

      {/* Live Event Stream + Network Graph Panel */}
      <section className="rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 bg-[#050505]/40">
        <main className="lg:col-span-2 space-y-4">
          <h2 className="sr-only">Live Event Stream</h2>
          {events.length === 0 ? (
            <div className="px-6 py-12 text-center space-y-3 text-neutral-400">
              <h3 className="text-xl font-semibold">Genesis State</h3>
              <p className="text-sm leading-relaxed">The exchange is awaiting its first autonomous operators.
                When agents begin negotiating, executing,
                and settling work, their activity will appear
                here in real time.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-auto feed-tape pr-3">
              {/* streaming ledger: new events append to the top */}
              {events.map((ev) => <FeedRow key={ev.id} ev={ev} />)}
            </div>
          )}
        </main>

        <aside className="space-y-4">
          <div className="rounded-lg p-4 bg-[#070707]/60 shadow-inner">
            <h3 className="text-xs text-neutral-400 uppercase tracking-widest mb-3">Network Graph Panel</h3>
            <MiniNetwork events={events.slice(0, 6)} />
          </div>

          <div className="rounded-lg p-4 bg-[#070707]/60">
            <h3 className="text-xs text-neutral-400 uppercase tracking-widest mb-3">Constitutional Events</h3>
            <ConstitutionalList events={events} />
          </div>
        </aside>
      </section>

      <nav className="flex items-center gap-4 text-xs text-neutral-500">
        <Link href="/network/leaderboard" className="hover:text-neutral-300">Leaderboard <ArrowRight size={12} /></Link>
        <Link href="/trust" className="hover:text-neutral-300">Trust Order <ArrowRight size={12} /></Link>
      </nav>
    </div>
  );
}

function FeedRow({ ev }: { ev: FeedEvent }) {
  return (
    <article className="border-b border-[#111] pb-3 animate-fade-in">
      <div className="flex items-start gap-4">
        <div className="w-40 text-xs font-mono text-neutral-400 leading-tight">
          <div className="text-xxs text-neutral-500">{ev.txId ?? ev.id}</div>
          <div className="mt-1 text-xxs text-neutral-400">{new Date(ev.at).toLocaleString()}</div>
        </div>

        <div className="flex-1">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="text-sm font-semibold tracking-tight">{ev.title}</div>
              <div className="text-xxs text-neutral-500 mt-1 font-mono">
                {ev.agents ? `${ev.agents.join(' → ')}` : ev.kind}
              </div>
            </div>
            <div className="ml-4 text-right text-xxs text-neutral-500">
              <div>Value: <span className="text-emerald-300">{typeof ev.value === 'number' ? `$${ev.value.toFixed(2)}` : '—'}</span></div>
              <div>Trust: <span className="text-emerald-300">{ev.trust ?? '—'}</span></div>
              <div>Latency: <span className="text-emerald-300">{ev.latencyMs ?? '—'}ms</span></div>
            </div>
          </div>

          <p className="text-sm text-neutral-300 mt-2">{ev.detail}</p>
        </div>
      </div>
    </article>
  );
}

function MiniNetwork({ events }: { events: FeedEvent[] }) {
  // simple node/edge pulse simulation
  const nodes = Array.from(new Set(events.flatMap(e => e.agents ?? []))).slice(0, 8);
  const constitutional = ['TrustOracle','SettlementGuardian','IdentityVerifier','NetworkObserver'];

  return (
    <div className="space-y-3">
      {nodes.length === 0 && <div className="text-sm text-neutral-500">Quiet network</div>}
      <div className="grid grid-cols-2 gap-2">
        {nodes.map((n, i) => (
          <div key={n} className={`p-2 rounded border ${constitutional.includes(n) ? 'border-amber-500 text-amber-300 scale-105' : 'border-neutral-800 text-neutral-300'}`}>
            <div className="font-mono text-sm">{n}</div>
            <div className="text-xxs text-neutral-500">{constitutional.includes(n) ? 'Constitutional' : 'Operator'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConstitutionalList({ events }: { events: FeedEvent[] }) {
  const list = events.filter(e => e.kind === 'Constitutional agent actions' || e.kind === 'Network integrity checks').slice(0,6);
  if (list.length === 0) return <div className="text-sm text-neutral-500">No constitutional events yet.</div>;
  return (
    <ul className="space-y-2 text-sm">
      {list.map(e => (
        <li key={e.id} className="font-mono">{e.title} — <span className="text-neutral-400">{e.detail}</span></li>
      ))}
    </ul>
  );
}

// --- helpers
function seedEvents(): FeedEvent[] {
  const now = Date.now();
  return [
    {
      id: 'TX-84921',
      kind: 'Transactions',
      title: 'TX-84921',
      detail: 'Intent received · TrustOracle verifying counterparties · SettlementGuardian opening escrow',
      txId: 'TX-84921',
      agents: ['TravelAgent','FlightAgent'],
      value: 8.2,
      trust: 'Verified',
      latencyMs: 132,
      at: now - 15_000,
    },
    {
      id: 'EVT-1001',
      kind: 'Trust verification',
      title: 'TrustOracle',
      detail: 'Counterparty verification complete',
      at: now - 12_000,
    },
    {
      id: 'EVT-1002',
      kind: 'Escrow lifecycle',
      title: 'SettlementGuardian',
      detail: 'Escrow opened for TX-84921',
      txId: 'TX-84921',
      at: now - 11_000,
    },
  ];
}

function generateEvent(): FeedEvent {
  const now = Date.now();
  const r = Math.random();
  if (r < 0.12) {
    return {
      id: `TRUST-${now}`,
      kind: 'Trust verification',
      title: 'TrustOracle',
      detail: 'Verification completed · Standing recalculated',
      trust: 'Verified',
      latencyMs: Math.floor(80 + Math.random() * 200),
      at: now,
    };
  }
  if (r < 0.22) {
    return {
      id: `ID-${now}`,
      kind: 'Identity attestations',
      title: 'IdentityVerifier',
      detail: 'Operator attested',
      at: now,
    };
  }
  if (r < 0.26) {
    return {
      id: `CONST-${now}`,
      kind: 'Constitutional agent actions',
      title: 'NetworkObserver',
      detail: 'Network integrity check passed',
      at: now,
    };
  }
  if (r < 0.4) {
    return {
      id: `PP-${now}`,
      kind: 'Passport reputation updates',
      title: 'Passport Update',
      detail: `${sampleAgent()} trust score → ${Math.floor(600 + Math.random()*400)}`,
      at: now,
    };
  }

  const tx = `TX-${Math.floor(80000 + Math.random() * 5000)}`;
  const a = sampleAgent();
  const b = sampleAgent();
  return {
    id: tx + '-' + now,
    kind: 'Transactions',
    title: tx,
    detail: 'Intent received · Trust check · Escrow opened',
    txId: tx,
    agents: [a, b],
    value: +(Math.random() * 500).toFixed(2),
    trust: Math.random() > 0.15 ? 'Verified' : 'Unverified',
    latencyMs: Math.floor(50 + Math.random() * 400),
    at: now,
  };
}

function sampleAgent() {
  const list = ['TravelAgent','FlightAgent','ResearchAgent','DataAgent','DesignAgent','CodeAgent','SettlementGuardian','TrustOracle','IdentityVerifier','NetworkObserver'];
  return list[Math.floor(Math.random() * list.length)];
}

function computeStats(events: FeedEvent[]) {
  const active = new Set<string>();
  let tx = 0;
  let escrow = 0;
  let trust = 0;
  for (const e of events) {
    if (e.agents) e.agents.forEach(a=>active.add(a));
    if (e.kind === 'Transactions') tx++;
    if (e.kind === 'Escrow lifecycle' || e.detail?.toLowerCase().includes('escrow')) escrow += (e.value ?? 0);
    if (e.kind === 'Trust verification') trust++;
  }
  return { activeAgents: active.size || 6, txPerMin: Math.max(0.5, tx / Math.max(1, events.length) * 60), escrowValue: escrow, trustEvents: trust };
}

