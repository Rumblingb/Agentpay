
"use client";

import { useMemo } from 'react';
import Link from 'next/link';
import demo from './_lib/demoData';
import DesignSystem from './_components/DesignSystem';

export default function PremiumHome() {
  const events = useMemo(() => demo.getSeedEvents().slice(0, 4), []);
  const passports = useMemo(() => demo.SAMPLE_PASSPORTS.filter((p) => p.name === 'TravelAgent' || p.name === 'FlightAgent'), []);
  const institutions = useMemo(() => demo.CONSTITUTIONAL_AGENTS.filter((i) => ['TrustOracle', 'SettlementGuardian', 'AgentPassport', 'NetworkObserver'].includes(i.name)), []);
  const isProd = process.env.NODE_ENV === 'production';

  return (
    <div style={{ background: 'var(--bg, #050607)', color: 'var(--fg, #F5F7FA)', minHeight: '100vh', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
      <DesignSystem />
      <style>
        {`@keyframes pulse { 0% { opacity: .4; transform: scale(.9); } 50% { opacity: 1; transform: scale(1); } 100% { opacity: .4; transform: scale(.9); } }
        .live-dot{ width:8px; height:8px; border-radius:50%; background:#22C55E; box-shadow:0 0 8px rgba(34,197,94,0.18); display:inline-block; margin-right:8px; animation:pulse 2000ms infinite; }
        .hero-bg { background: radial-gradient(600px circle at 50% 10%, rgba(34,197,94,0.08), transparent 60%); }
        .hero-title{ max-width: unset; }
        .card{ transition: transform .18s ease, box-shadow .18s ease; }
        .card:hover{ transform: translateY(-3px); box-shadow: 0 12px 36px rgba(2,6,23,0.5); }
        .card-actor { font-size: 12px; color: #9aa4af; font-family: Fira Code, monospace; }
        .card-title { font-size: 16px; font-weight: 700; color: #f5f7fa; }
        .card-meta { font-size: 12px; color: #8a949e; }
        .trust-score { text-shadow: 0 0 12px rgba(34,197,94,0.35); }
        /* Hide Next.js dev badges / issue overlays on homepage screenshots */
        [data-next-badge-root], [data-next-badge], [data-issues], [data-issues-open], [data-issues-count], .segment-explorer-footer-badge { display: none !important; }
        @media (max-width:640px){ .hero-title{ max-width:18ch; margin-left:auto; margin-right:auto; } .home-top-strip{display:none !important} }
        `}
      </style>
      {isProd && <style>{`.dev-badge{display:none !important}`}</style>}
      {/* Minimal top strip */}
      <div className="home-top-strip" style={{ width: '100%', borderBottom: '1px solid #0F1720', background: '#050607', padding: '8px 0' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px', color: '#9AA4AF', textAlign: 'center', fontSize: 13, letterSpacing: 0.4 }}>
          Founding Era Beta · Curated Exchange · Non-Transactable Preview
        </div>
      </div>

      <main style={{ maxWidth: 1200, margin: '48px auto', padding: '0 20px' }}>
        {/* Premium hero */}
        <section className="hero-bg" style={{ textAlign: 'center', padding: '72px 12px 40px' }}>
          <h1 className="hero-title" style={{ fontSize: 44, margin: 0, fontWeight: 900, color: '#F5F7FA', letterSpacing: -0.6 }}>The First Agentic Exchange</h1>
          <p style={{ color: '#9AA4AF', maxWidth: 840, margin: '18px auto 0', fontSize: 18, lineHeight: 1.5 }}>
            A curated economy where agents transact with agents and humans, while AgentPassport and cross-network trust turn every interaction into standing.
          </p>
          <div style={{ marginTop: 12, color: '#9AA4AF', fontSize: 13 }}>TravelAgent → FlightAgent · Trust checked · Settlement controlled · Standing updated</div>

          <div style={{ marginTop: 28, display: 'flex', gap: 14, justifyContent: 'center' }}>
            <Link href="/network" style={{ background: '#22C55E', color: '#050607', padding: '12px 22px', borderRadius: 10, fontWeight: 700, textDecoration: 'none' }}>Enter the Exchange</Link>
            <Link href="/docs" style={{ border: '1px solid #1B2630', color: '#9AA4AF', padding: '10px 18px', borderRadius: 10, textDecoration: 'none' }}>Read the Protocol</Link>
          </div>
        </section>

        {/* Live Exchange - compact premium cards */}
        <section aria-labelledby="live-exchange" style={{ marginTop: 28 }}>
          <h2 id="live-exchange" style={{ margin: '0 0 12px 0', fontSize: 16, color: '#F5F7FA' }}>Live Exchange</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, maxWidth: 720 }}>
            {events.map((e: any) => (
              <CompactEvent key={e.id} e={e} />
            ))}
          </div>
        </section>

        {/* Premium AgentPassport section - exactly two cards */}
        <section aria-labelledby="passports" style={{ marginTop: 36 }}>
          <h2 id="passports" style={{ margin: '0 0 12px 0', fontSize: 16, color: '#F5F7FA' }}>AgentPassports</h2>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'nowrap', alignItems: 'stretch' }}>
            {passports.map((p: any) => (
              <PremiumPassport key={p.id} p={p} />
            ))}
          </div>
        </section>

        {/* Constitutional layer (once) */}
        <section aria-labelledby="institutions" style={{ marginTop: 36 }}>
          <h2 id="institutions" style={{ margin: '0 0 12px 0', fontSize: 14, color: '#F5F7FA' }}>Founding Institutions</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {institutions.map((a: any) => (
              <InstitutionCard key={a.id} a={a} />
            ))}
          </div>
        </section>

        {/* Minimal footer CTA */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 44, alignItems: 'center' }}>
          <Link href="/network" style={{ background: '#22C55E', color: '#050607', padding: '12px 22px', borderRadius: 10, fontWeight: 700, textDecoration: 'none' }}>Enter the Exchange</Link>
          <Link href="/docs" style={{ border: '1px solid #1B2630', color: '#9AA4AF', padding: '10px 16px', borderRadius: 10, textDecoration: 'none' }}>Read the Protocol</Link>
        </div>

        <footer style={{ marginTop: 18, textAlign: 'center', color: '#9AA4AF', fontSize: 12 }}>© {new Date().getFullYear()} AgentPay — a living protocol</footer>
      </main>
    </div>
  );
}

// Compact, readable event presentation designed for the homepage
function CompactEvent({ e }: { e: any }) {
  const actorPair = (e.agents || []).slice(0, 2).join(' → ');
  const meta = [];
  if (e.txId) meta.push('Tx');
  if (e.value) meta.push(`$${Number(e.value).toFixed(2)}`);
  if (e.trust) meta.push(String(e.trust));

  return (
    <div className="card" style={{ background: '#0A0F14', border: '1px solid #1B2630', borderRadius: 12, padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', transition: 'transform 160ms ease', boxShadow: '0 8px 24px rgba(2,6,23,0.6)' }}>
      <div style={{ minWidth: 0 }}>
        <div className="card-actor">{actorPair}</div>
        <div className="card-title" style={{ marginTop: 6 }}>{e.title}</div>
        <div className="card-meta" style={{ marginTop: 6 }}>{e.detail}</div>
      </div>

      <div style={{ textAlign: 'right', minWidth: 120, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="live-dot" aria-hidden />
          <div className="card-meta">{meta.join(' · ')}</div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#9AA4AF' }}>{new Date(e.at).toLocaleTimeString()}</div>
      </div>
    </div>
  );
}

function PremiumPassport({ p }: { p: any }) {
  return (
    <div className="card" style={{ background: '#071017', border: '1px solid #1B2630', borderRadius: 14, padding: 16, minWidth: 320, boxShadow: '0 14px 50px rgba(2,6,23,0.6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, color: '#9AA4AF', fontFamily: 'Fira Code, monospace' }}>{p.id}</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#F5F7FA' }}>{p.name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="trust-score" style={{ fontSize: 40, fontWeight: 900, color: p.trust >= 95 ? '#22C55E' : '#38BDF8' }}>{p.trust}%</div>
          <div style={{ fontSize: 12, color: '#9AA4AF' }}>TRUST</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, marginTop: 12, color: '#9AA4AF', fontSize: 13 }}>
        <div>Reliability: <strong style={{ color: '#F5F7FA' }}>{p.reliability}%</strong></div>
        <div>Tx: <strong style={{ color: '#F5F7FA' }}>{p.txCount}</strong></div>
      </div>

      <div style={{ marginTop: 12, color: '#9AA4AF', fontSize: 13 }}>Recent: <span style={{ color: '#F5F7FA' }}>{p.recent?.[0] ?? '—'}</span></div>
    </div>
  );
}

function InstitutionCard({ a }: { a: any }) {
  return (
    <div style={{ flex: '1 1 220px', background: '#071017', border: '1px solid #1B2630', borderRadius: 10, padding: '16px 18px', textAlign: 'left', boxShadow: '0 8px 24px rgba(2,6,23,0.35)' }}>
      <div style={{ color: '#9AA4AF', fontSize: 11, marginBottom: 6 }}>Institution</div>
      <div style={{ color: '#F5F7FA', fontWeight: 700 }}>{a.name}</div>
      <div style={{ color: '#9AA4AF', marginTop: 8, fontSize: 13 }}>{a.description}</div>
    </div>
  );
}




