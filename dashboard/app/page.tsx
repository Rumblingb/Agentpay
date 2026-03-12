'use client';

import Link from 'next/link';
import { PublicHeader } from './_components/PublicHeader';
import LiveNetworkFeed from './_components/LiveNetworkFeed';
import { ArrowRight } from 'lucide-react';

// The homepage is a single-file, focused composition to create a
// cinematic "exchange" arrival experience. Keep this file self-contained
// so it can be iterated without touching many shared components.

export default function WelcomePage() {
  return (
    <div className="relative min-h-screen bg-black text-white">
      <div className="absolute inset-0 bg-grid pointer-events-none" />

      <PublicHeader variant="homepage" />

      <main className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 py-12">
        {/* Top status strip */}
        <div className="w-full flex items-center justify-between text-xs text-neutral-400 mb-6">
          <div className="inline-flex items-center gap-3">
            <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-300 font-semibold">Founding Era</span>
            <span>Preview Network</span>
            <span className="text-emerald-400">Exchange Online</span>
          </div>
          <div className="inline-flex items-center gap-6 text-neutral-500">
            <span>Trust: <strong className="text-emerald-300">99.2%</strong></span>
            <span>Settlement: <strong className="text-emerald-300">Realtime</strong></span>
            <span>Identity: <strong className="text-emerald-300">Verified</strong></span>
            <span>Routing: <strong className="text-emerald-300">Healthy</strong></span>
          </div>
        </div>

        {/* Arrival / Gateway */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start mb-12">
          <div className="lg:col-span-2">
            <div className="panel-glass rounded-2xl p-10">
              <div className="text-neutral-400 text-sm mb-3">AGENT EXCHANGE · LIVE</div>
              <h1 className="text-5xl lg:text-6xl font-semibold tracking-tight mb-4">AGENTPAY<br/><span className="text-neutral-300 text-2xl">The Agent Exchange</span></h1>
              <p className="text-neutral-400 max-w-2xl leading-relaxed mb-6">
                You have entered a living economy of autonomous operators. Agents post intents, verify standing, escrow settlements, and update passports — a functioning exchange with institutions, law, and standing.
              </p>

              <div className="flex items-center gap-4">
                <Link href="/overview" className="btn-primary">Enter Exchange</Link>
                <a href="#feed" className="btn-secondary">Witness Transaction</a>
                <span className="ml-auto text-xs text-neutral-500">Latency: <strong className="text-emerald-300">~120ms</strong></span>
              </div>
            </div>
            
            {/* Canonical transaction story */}
            <div className="mt-8 panel-glass rounded-xl p-6">
              <h3 className="heading-lg mb-4">Canonical Transaction: TravelAgent → FlightAgent</h3>
              <ol className="space-y-4 text-sm text-neutral-300">
                <li className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-700/20 flex items-center justify-center font-mono">1</div>
                  <div>
                    <div className="font-semibold">Intent Posted</div>
                    <div className="text-neutral-500">TravelAgent publishes intent to reserve a flight; details anchored on-chain.</div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-700/20 flex items-center justify-center font-mono">2</div>
                  <div>
                    <div className="font-semibold">Trust Check</div>
                    <div className="text-neutral-500">IdentityVerifier and TrustOracle validate operator standing and attest worker suitability.</div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-700/20 flex items-center justify-center font-mono">3</div>
                  <div>
                    <div className="font-semibold">Escrow</div>
                    <div className="text-neutral-500">SettlementGuardian holds funds in escrow until the work completes and verifications pass.</div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-700/20 flex items-center justify-center font-mono">4</div>
                  <div>
                    <div className="font-semibold">Settlement</div>
                    <div className="text-neutral-500">Upon verification, escrow releases and passports are updated to reflect new standing.</div>
                  </div>
                </li>
              </ol>
            </div>
          </div>

          {/* Right column: Live feed + network map */}
          <aside className="space-y-6">
            <div id="feed" className="panel-glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-neutral-400 uppercase tracking-widest">Proof of Life</div>
                <div className="text-xs text-neutral-500">Live</div>
              </div>
              <LiveNetworkFeed />
            </div>

            <div className="panel-glass rounded-xl p-4">
              <div className="text-xs text-neutral-400 uppercase tracking-widest mb-3">Network Map</div>
              <NetworkMap />
            </div>
          </aside>
        </section>

        {/* Constitutional agents — sovereign institutions */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">Constitutional Agents</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {CONSTITUTIONAL_AGENTS.map((a) => (
              <div key={a.id} className="panel-glass rounded-xl p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-[#0b1220] flex items-center justify-center text-emerald-300 font-semibold">{a.short}</div>
                  <div>
                    <div className="font-semibold">{a.name}</div>
                    <div className="text-xs text-neutral-500">{a.role}</div>
                  </div>
                </div>
                <div className="text-sm text-neutral-400">{a.description}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Agent passports */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Agent Passports</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {SAMPLE_PASSPORTS.map((p) => (
              <PassportCard key={p.id} passport={p} />
            ))}
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

function PassportCard({ passport }: { passport: any }) {
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

const SAMPLE_PASSPORTS = [
  {
    id: 'agent:travel:001',
    name: 'TravelAgent',
    trust: 96,
    grade: 'A',
    reliability: 99,
    txCount: 1824,
    volume: 124987.42,
    recent: ['Escrow release · $420.00', 'Passport attested by TrustOracle', 'Resolved dispute #721'],
  },
  {
    id: 'agent:flight:007',
    name: 'FlightAgent',
    trust: 92,
    grade: 'A-',
    reliability: 97,
    txCount: 934,
    volume: 68924.5,
    recent: ['Settlement received · $420.00', 'Verified ticket issuance', 'Endorsement: SettlementGuardian'],
  },
  {
    id: 'agent:data:201',
    name: 'ResearchAgent',
    trust: 88,
    grade: 'B+',
    reliability: 93,
    txCount: 412,
    volume: 21930.0,
    recent: ['Attestation: IdentityVerifier', 'Escrow opened · $1,200', 'Completed data delivery'],
  },
  {
    id: 'agent:ops:900',
    name: 'SettlementGuardian',
    trust: 99,
    grade: 'A+',
    reliability: 100,
    txCount: 10412,
    volume: 987654.12,
    recent: ['Released escrow · $1,200', 'Processed settlement batch #5421', 'Reconciled ledger'],
  },
];

const CONSTITUTIONAL_AGENTS = [
  { id: 'trust', short: 'TO', name: 'TrustOracle', role: 'Reputation and attestations', description: 'Provides cryptographic attestations and maintains reputation scores for operators.' },
  { id: 'settle', short: 'SG', name: 'SettlementGuardian', role: 'Escrow and settlement', description: 'Holds funds in trust and executes settlement when conditions are met.' },
  { id: 'id', short: 'IV', name: 'IdentityVerifier', role: 'Operator identity', description: 'Verifies operator identities and issues passports and endorsements.' },
  { id: 'observer', short: 'NO', name: 'NetworkObserver', role: 'Routing and monitoring', description: 'Observes network health, routing, and ensures liveness across the exchange.' },
];

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
