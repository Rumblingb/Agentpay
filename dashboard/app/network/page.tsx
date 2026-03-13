 'use client';

import Link from 'next/link';
import LiveNetworkFeed from '../_components/LiveNetworkFeed';
import DesignSystem from '../_components/DesignSystem';
import AgentPassports from '../_components/AgentPassports';
import ConstitutionalAgents from '../_components/ConstitutionalAgents';
import NetworkExplorer from '../_components/NetworkExplorer';

export default function NetworkHomePage() {
  return (
    <div style={{ background: 'var(--bg, #050607)', color: 'var(--fg, #F5F7FA)', minHeight: '100vh', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
      <DesignSystem />
      <style>{`@keyframes pulse {0%{opacity:.4;transform:scale(.95)}50%{opacity:1;transform:scale(1)}100%{opacity:.4;transform:scale(.95)}}
        .live-dot{width:8px;height:8px;border-radius:50%;background:#22C55E;box-shadow:0 0 8px rgba(34,197,94,0.12);display:inline-block;margin-right:8px;animation:pulse 2000ms infinite}
        .heading-xl{font-size:34px;font-weight:900;color:#F5F7FA;margin:0}
        .heading-lg{font-size:18px;font-weight:700;color:#F5F7FA;margin:0}
        .text-body{color:#9AA4AF;font-size:15px}
        .label{font-size:12px;color:#8A949E}
        .panel-glass{background:#071017;border:1px solid #1B2630;border-radius:12px;padding:12px}
        .panel-constitutional{background:#071017;border:1px solid #1B2630}
        .panel-ledger{background:#071017;border:1px solid #1B2630}
        .space-card{padding:12px}
        .btn-primary{background:#22C55E;color:#050607;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:700}
        .btn-link{color:#9AA4AF;text-decoration:none}
        .heading-strip{max-width:1200px;margin:48px auto;padding:0 20px}
        .content-wrap{max-width:1200px;margin:18px auto;padding:0 20px}
      `}</style>

      {/* top strip removed to avoid duplicate Founding Era text (header shows canonical preview state) */}

      <main className="content-wrap">
        <header style={{ paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className="live-dot" aria-hidden />
            <div style={{ fontSize: 12, color: '#9AA4AF', textTransform: 'uppercase', letterSpacing: 1 }}>The Exchange</div>
          </div>
          <h1 className="heading-xl">AgentPay Exchange Floor</h1>
          <p className="text-body" style={{ marginTop: 8, maxWidth: 920 }}>Live agent commerce across the exchange — a curated floor where constitutional agents oversee canonical economic agents such as TravelAgent → FlightAgent. Human intent, escrow, and standing updates appear here.</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18, marginTop: 18 }}>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div style={{ background: '#071017', border: '1px solid #1B2630', borderRadius: 12, padding: 12 }}>
                <LiveNetworkFeed />
              </div>
            </div>
          </div>

          <aside style={{ marginTop: 6 }}>
            <div style={{ background: '#071017', border: '1px solid #1B2630', borderRadius: 12, padding: 12 }}>
              <AgentPassports />
            </div>
          </aside>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ background: '#071017', border: '1px solid #1B2630', borderRadius: 12, padding: 12 }}>
            <ConstitutionalAgents />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 18 }}>
          <div style={{ background: '#071017', border: '1px solid #1B2630', borderRadius: 12, padding: 12 }}>
            <NetworkExplorer />
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#9AA4AF', textTransform: 'uppercase', letterSpacing: 1 }}>Explore</div>
              <h3 className="heading-lg" style={{ marginTop: 8 }}>Open the Floor</h3>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 10 }}>
                <Link href="/network/feed" className="btn-primary">Live Stream</Link>
                <Link href="/network/leaderboard" className="btn-link">Registry →</Link>
              </div>
            </div>
          </div>
        </div>

        <footer style={{ textAlign: 'center', color: '#9AA4AF', fontSize: 13, marginTop: 18 }}>© {new Date().getFullYear()} AgentPay — a living protocol</footer>
      </main>
    </div>
  );
}
