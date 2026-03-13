'use client';

import { useEffect, useState } from 'react';

export default function LiveNetworkFeed({ compact }: { compact?: boolean } = {}) {
  const [events, setEvents] = useState<Array<string | Record<string, any>>>([]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch('/api/agents/feed');
        if (!res.ok) return;
        const data = await res.json();
        const feed = (data.feed ?? []).slice(0, 20).map((f: any) => {
          if (f.kind === 'trust') return `${f.agentId} · ${f.eventType}`;
          return `${f.buyer} → ${f.seller} · $${Number(f.amount ?? 0).toFixed(3)}`;
        });
        if (mounted) setEvents(feed);
      } catch (err) {
        // surface non-fatal errors in console for Founding Era observability
        // components should not crash the page but we want to see failures during preview
        // eslint-disable-next-line no-console
        console.error('LiveNetworkFeed load error:', err);
      }
    }

    load();
    const iv = setInterval(load, 4000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  const sample = [
    'DesignAgent → CodeAgent',
    'TravelAgent → FlightAgent',
    'ResearchAgent → DataAgent',
    'TrustOracle → verification complete',
    'SettlementGuardian → escrow released',
  ];

  const isPreview = events.length === 0;
  const shown = events.length ? events : sample;
  return (
    <section className="network-feed panel-glass space-card rounded-xl" aria-label="Live network feed">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm text-neutral-300 font-medium">LIVE NETWORK</h2>
        {isPreview && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-300">
            Founding Era
          </span>
        )}
      </div>

      <div className={`relative overflow-hidden ${compact ? 'h-40' : 'h-48'}`} role="region" aria-live="polite">
        <div className="marquee-fade-top" />
        <div className="marquee-fade-bottom" />

        <div
          className={`w-full animate-marquee-vertical`}
          style={{ willChange: 'transform' }}
        >
          {/* Duplicate shown items to form a continuous loop */}
          {[...shown, ...shown].map((item, idx) => {
            const key = `${idx}-${String(item).slice(0, 24)}`;
            // classify event type
            let type = 'tx';
            let payload = String(item);
            if (typeof item === 'object' && item?.eventType) {
              type = item.eventType;
              payload = item.eventType === 'trust' ? `${item.agentId} · ${item.eventType}` : `${item.buyer} → ${item.seller} · $${Number(item.amount ?? 0).toFixed(2)}`;
            } else if (String(item).toLowerCase().includes('trust')) {
              type = 'trust';
            }

            return (
              <div key={key} className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.02] last:border-0">
                <div className="flex-shrink-0">
                  <span
                    className={[
                      'inline-flex items-center justify-center rounded-full w-8 h-8 text-xs font-semibold',
                      type === 'trust' ? 'bg-violet-600/10 text-violet-300' : 'bg-emerald-600/6 text-emerald-300',
                    ].join(' ')}
                  >
                    {type === 'trust' ? 'T' : '→'}
                  </span>
                </div>

                <div className="min-w-0">
                  <div className="text-sm text-neutral-200 truncate font-mono">{payload}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">{type === 'trust' ? 'Trust event' : 'Transaction'}</div>
                </div>

                <div className="ml-auto text-xs text-neutral-500 font-mono">{''}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
