'use client';

import Link from 'next/link';
import LiveNetworkFeed from '../_components/LiveNetworkFeed';
import DesignSystem from '../_components/DesignSystem';
import AgentPassports from '../_components/AgentPassports';
import ConstitutionalAgents from '../_components/ConstitutionalAgents';
import NetworkExplorer from '../_components/NetworkExplorer';

export default function NetworkHomePage() {
  return (
    <div
      style={{
        background: 'var(--bg, #050607)',
        color: 'var(--fg, #F5F7FA)',
        minHeight: '100vh',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      <DesignSystem />

      {/* top strip removed to avoid duplicate Founding Era text (header shows canonical preview state) */}

      <main className="content-wrap">
        <header style={{ paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className="live-dot" aria-hidden />
            <div style={{ fontSize: 12, color: '#9AA4AF', textTransform: 'uppercase', letterSpacing: 1 }}>
              Live Proof
            </div>
          </div>
          <h1 className="heading-xl">Governed Agent Commerce, Live</h1>
          <p className="text-body" style={{ marginTop: 8, maxWidth: 920 }}>
            Live AgentPay activity across approval, execution, escrow, and proof surfaces. This page shows how hosted intent becomes governed action without losing continuity.
          </p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18, marginTop: 18 }}>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div className="panel-glass rounded-xl p-3">
                <LiveNetworkFeed />
              </div>
            </div>
          </div>

          <aside style={{ marginTop: 6 }}>
            <div className="panel-glass rounded-xl p-3">
              <AgentPassports />
            </div>
          </aside>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="panel-constitutional rounded-xl p-3">
            <ConstitutionalAgents />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 18 }}>
          <div className="panel-glass rounded-xl p-3">
            <NetworkExplorer />
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#9AA4AF', textTransform: 'uppercase', letterSpacing: 1 }}>
                Explore
              </div>
              <h3 className="heading-lg" style={{ marginTop: 8 }}>
                Open the Registry
              </h3>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 10 }}>
                <Link href="/network/feed" className="btn-primary">
                  Live Stream
                </Link>
                <Link href="/network/leaderboard" className="btn-link">
                  Registry →
                </Link>
              </div>
            </div>
          </div>
        </div>

        <footer style={{ textAlign: 'center', color: '#9AA4AF', fontSize: 13, marginTop: 18 }}>
          © {new Date().getFullYear()} AgentPay — live proof of governed execution
        </footer>
      </main>
    </div>
  );
}
