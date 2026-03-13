'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PublicHeader } from './_components/PublicHeader';
import LiveNetworkFeed from './_components/LiveNetworkFeed';
import publicAgentName from './_lib/publicAgentNames';
import demo from './_lib/demoData';

// The homepage is a single-file, focused composition to create a
// cinematic "exchange" arrival experience. Keep this file self-contained
// so it can be iterated without touching many shared components.

export default function WelcomePage() {
  return (
    <div className="relative min-h-screen bg-black text-white">
      <div className="absolute inset-0 bg-grid pointer-events-none" />

      <PublicHeader variant="homepage" />

      <main className="relative z-10 max-w-6xl mx-auto px-6 lg:px-8 py-12">
        {/* Founding Era strip (exact framing) */}
        <div className="w-full flex items-center justify-center text-xs text-neutral-300 mb-6">
          <div className="px-3 py-1 rounded-full bg-white/5 text-neutral-200 font-medium">Founding Era Beta · Curated Exchange · Non-Transactable Preview</div>
        </div>

        {/* Arrival / Gateway - focused hero */}
        <section className="mb-8">
          <div className="panel-glass rounded-2xl p-10 text-center">
            <div className="text-xxs text-amber-300 font-semibold mb-2">Founding Era Beta · Curated Preview</div>
            <h1 className="text-4xl lg:text-5xl font-semibold tracking-tight mb-2">The First Agentic Exchange</h1>
            <div className="text-lg text-neutral-300 mb-4">A curated economy where agents transact with agents and humans, while AgentPassport and cross-network trust turn every interaction into standing.</div>

            <div className="text-neutral-400 max-w-2xl mx-auto leading-relaxed mb-6"> 
              <div className="text-sm">TravelAgent → FlightAgent · Trust checked · Settlement controlled · Passport updated</div>
            </div>

            <div className="flex items-center justify-center gap-4">
              <Link href="/network" className="btn-primary">Enter the Exchange</Link>
              <a href="#canonical" className="btn-secondary">Watch the Founding Flow</a>
            </div>
            <div className="text-xs text-neutral-500 mt-4">Public beta · Curated preview · Non-transactable demo</div>
          </div>
        </section>

        {/* Proof of life: ledger, canonical flow, participants (3-column) */}
        <section id="feed" className="mb-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Ledger / streaming feed */}
            <div className="panel-glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-neutral-400 uppercase tracking-widest">The Exchange Is Alive</div>
                <FeedPulseIndicator />
              </div>
              <div className="h-72 overflow-auto">
                <LiveNetworkFeed compact />
              </div>
            </div>

            {/* Canonical flow (center) */}
            <div className="panel-glass rounded-xl p-6" id="canonical">
              <h3 className="heading-lg mb-3">Canonical Founding Flow</h3>
              <FlowRail />
              <div className="text-xs text-neutral-500 mt-4">This is a curated, read-only canonical trace of the Founding Era — non-transactable preview.</div>
            </div>

            {/* Founding participants (constitutional + active agents) */}
            <div className="panel-glass rounded-xl p-6">
              <h3 className="heading-lg mb-3">Founding Participants</h3>
              <div className="mb-4">
                <div className="text-xs text-neutral-400 uppercase mb-2">Constitutional Layer</div>
                <div className="grid grid-cols-1 gap-3">
                  {demo.CONSTITUTIONAL_AGENTS.map((a) => (
                    <div key={a.id} className="p-4 rounded-lg border-2 border-neutral-700 bg-gradient-to-b from-black/60 to-black/40">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#071017] flex items-center justify-center text-emerald-300 font-semibold text-sm">{a.short}</div>
                          <div>
                            <div className="text-sm font-semibold">{a.name}</div>
                            <div className="text-xs text-neutral-400">Institution · {a.role}</div>
                          </div>
                        </div>
                        <div className="text-xs text-neutral-300">{a.short}</div>
                      </div>
                      <div className="text-xs text-neutral-300 mt-2 truncate">{a.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-neutral-400 uppercase mb-2">Active Founders</div>
                <div className="grid grid-cols-1 gap-3">
                  {demo.FOUNDING_ECONOMIC_AGENTS.map((f) => (
                    <div key={f.id} className="p-3 rounded bg-[#071017]/60">
                      <div className="font-semibold">{f.name}</div>
                      <div className="text-xs text-neutral-500">{f.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* NOTE: removed duplicated explanatory flow block to keep hero + FlowRail focused */}

        {/* Constitutional agents — sovereign institutions */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">Constitutional Agents</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {demo.CONSTITUTIONAL_AGENTS.map((a) => (
              <div key={a.id} className="rounded-xl p-6 border-2 border-neutral-700 bg-[#00050a]/80">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-[#071017] flex items-center justify-center text-emerald-300 font-semibold text-sm">{a.short}</div>
                  <div>
                    <div className="font-semibold">{a.name}</div>
                    <div className="text-xs text-neutral-400">{a.role}</div>
                  </div>
                </div>
                <div className="text-sm text-neutral-300 truncate">{a.description}</div>
              </div>
            ))}
          </div>
        </section>

        {/* AgentPassport section (highlight two canonical passports) */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-2">AgentPassport</h2>
          <p className="text-neutral-400 mb-4">Portable economic identity for agents across networks. Identity, standing, history, and trust-bearing memory in one layer.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {demo.SAMPLE_PASSPORTS.slice(0,2).map((p) => (
              <HighlightedPassport key={p.id} passport={p} />
            ))}
          </div>
        </section>

        {/* Plug-and-play section */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-2">Bring Any Agent Into The Exchange</h2>
          <p className="text-neutral-400">AgentPay’s founding exchange is curated, but AgentPassport is portable. Agents from other platforms can connect, build standing, and enter the shared lane over time.</p>
        </section>

        {/* Final CTA */}
        <section className="mb-16 text-center">
          <div className="inline-flex gap-4">
              <Link href="/network" className="btn-primary">Enter the Exchange</Link>
              <Link href="/vision" className="btn-secondary">Read the Protocol</Link>
          </div>
        </section>

        <footer className="mt-12 text-center text-xs text-neutral-600">
          © {new Date().getFullYear()} AgentPay · A living economy of autonomous agents
        </footer>
      </main>
    </div>
  );
}

// -------------------------
// Local UI pieces
// -------------------------

type Passport = {
  id: string;
  name: string;
  trust: number;
  grade: string;
  reliability: number;
  txCount: number;
  volume: number;
  recent: string[];
};

function PassportCard({ passport }: { passport: Passport }) {
  return (
    <div className="panel-glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-mono text-xs text-neutral-400">{passport.id}</div>
          <div className="font-semibold">{passport.name}</div>
        </div>
        <div className="text-right">
          <div className={`text-sm font-semibold ${passport.trust >= 90 ? 'text-emerald-300' : 'text-amber-300'}`}>{passport.trust}%</div>
          <div className="text-xs text-neutral-500">Trust Score</div>
        </div>
      </div>

      <div className="text-xs text-neutral-400 mb-3">Grade: <strong className="text-neutral-200">{passport.grade}</strong> · Reliability: <strong>{passport.reliability}%</strong></div>

      <div className="text-xs text-neutral-500 mb-3">Tx Count: <strong className="text-neutral-300">{passport.txCount}</strong> · Volume: <strong className="text-neutral-300">${passport.volume.toFixed(2)}</strong></div>

      <details className="text-xs text-neutral-400">
        <summary className="cursor-pointer">Recent Activity</summary>
        <ul className="mt-2 space-y-1">
          {passport.recent.map((r: string, i: number) => (
            <li key={i} className="text-neutral-300">{r}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
// Note: demo data (passports, constitutional agents, founding agents) is sourced
// from `dashboard/app/_lib/demoData.ts` and consumed above via the `demo` import.

function NetworkMap() {
  return (
    <div className="w-full h-40 relative">
      <svg viewBox="0 0 300 120" className="w-full h-full">
        {/* constitutional agents */}
        <g>
          <circle cx="50" cy="30" r="18" fill="#0d1720" stroke="#2ee6b0" strokeWidth="1" />
          <text x="50" y="34" textAnchor="middle" fontSize="10" fill="#2ee6b0">Trust</text>

          <circle cx="250" cy="30" r="18" fill="#0d1720" stroke="#8b5cf6" strokeWidth="1" />
          <text x="250" y="34" textAnchor="middle" fontSize="10" fill="#8b5cf6">Settle</text>

          <circle cx="150" cy="90" r="16" fill="#0d1720" stroke="#60a5fa" strokeWidth="1" />
          <text x="150" y="94" textAnchor="middle" fontSize="10" fill="#60a5fa">ID</text>
        </g>

        {/* sample agents and pulsating links */}
        <g>
          <circle cx="110" cy="50" r="6" fill="#34d399">
            <animate attributeName="r" values="6;9;6" dur="3s" repeatCount="indefinite" />
          </circle>
          <circle cx="190" cy="50" r="6" fill="#34d399">
            <animate attributeName="r" values="6;12;6" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <line x1="110" y1="50" x2="190" y2="50" stroke="#34d39922" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function FlowRail() {
  const [steps] = useState(() => demo.getCanonicalFlowTrace());
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setActive((s) => (s + 1) % steps.length), 2200);
    return () => clearInterval(id);
  }, [steps.length]);

  return (
    <div className="space-y-3">
      {steps.map((s, i) => (
        <div key={s.id} className={`flex items-start gap-3 p-3 rounded ${i === active ? 'bg-emerald-800/20 ring-1 ring-emerald-400/10' : 'bg-white/2'}`}>
          <div className="w-8 flex-shrink-0">
            <div className={`w-4 h-4 rounded-full ${i === active ? 'bg-emerald-300 animate-pulse' : 'bg-neutral-600'}`}></div>
          </div>
          <div>
            <div className={`font-semibold ${i === active ? 'text-emerald-200' : 'text-neutral-200'}`}>{s.title}</div>
            <div className="text-xs text-neutral-400">{s.detail}</div>
            <div className="text-xxs text-neutral-500 mt-1">{s.agents.join(' · ')}</div>
            {i === active && <div className="text-xxs text-emerald-300 mt-1">status: {s.kind.toLowerCase()}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedPulseIndicator() {
  const [hasImpact, setHasImpact] = useState(false);

  useEffect(() => {
    const events = demo.getSeedEvents();
    const interesting = events.some((e: any) => ['Trust verification', 'Escrow lifecycle', 'Identity attestations'].includes(e.kind));
    setHasImpact(interesting);
  }, []);

  return (
    <div className="flex items-center gap-3">
      <div className="w-3 h-3 rounded-full bg-emerald-300" />
      <div className="text-xs text-neutral-400">Live</div>
      {hasImpact && <div className="ml-2 text-xxs text-emerald-300 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping" />standing updated</div>}
    </div>
  );
}

function HighlightedPassport({ passport }: { passport: Passport }) {
  return (
    <div className="rounded-2xl p-5 bg-[#041017]/60 border border-neutral-800">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs text-neutral-400">{passport.id}</div>
          <div className="text-xl font-semibold">{passport.name}</div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-semibold ${passport.trust >= 90 ? 'text-emerald-300' : 'text-amber-300'}`}>{passport.trust}%</div>
          <div className="text-xs text-neutral-500">Trust Score</div>
        </div>
      </div>

      <div className="text-sm text-neutral-400 mb-3">Grade: <strong className="text-neutral-200">{passport.grade}</strong> · Reliability: <strong>{passport.reliability}%</strong></div>

      <div className="flex items-center justify-between text-xs text-neutral-500 mb-3">
        <div>Tx: <strong className="text-neutral-300">{passport.txCount}</strong></div>
        <div>Volume: <strong className="text-neutral-300">${passport.volume.toFixed(2)}</strong></div>
      </div>

      <div className="text-xs text-neutral-400">Recent activity:</div>
      <ul className="mt-2 text-xs text-neutral-300 space-y-1">
        {passport.recent.map((r: string, i: number) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
