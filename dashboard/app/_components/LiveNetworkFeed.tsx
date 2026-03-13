'use client';

import { useEffect, useState } from 'react';

export default function LiveNetworkFeed({ compact, speed = 22, paused = false }: { compact?: boolean; speed?: number; paused?: boolean } = {}) {
  const [events, setEvents] = useState<Array<string | Record<string, any>>>([]);
  const [hover, setHover] = useState(false);

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
      <style>{`
        @keyframes feedIn {
          0% { opacity: 0; transform: translateY(8px) scale(.995); }
          20% { opacity: 1; transform: translateY(0) scale(1); }
          80% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-6px) scale(.995); }
        }
        .feed-item-futuristic { background: linear-gradient(90deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)); border: 1px solid rgba(255,255,255,0.03); box-shadow: 0 6px 18px rgba(2,6,23,0.6), 0 0 20px rgba(34,197,94,0.02); }
        .feed-item-futuristic .payload { color: #E6EEF6; }
        .feed-item-futuristic .meta { color: #93A2B3; }
        @media (prefers-reduced-motion: reduce) {
          .feed-item-futuristic { animation: none !important; }
        }
      `}</style>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm text-neutral-300 font-medium">LIVE NETWORK</h2>
      </div>

      <div
        className={`${compact ? 'h-40' : 'h-64'} overflow-auto space-y-3 py-2`}
        role="region"
        aria-live="polite"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {shown.map((item, idx) => {
          const key = `${idx}-${String(item).slice(0, 24)}`;
          let type = 'tx';
          let payload = String(item);
          if (typeof item === 'object' && item?.eventType) {
            type = item.eventType;
            payload = item.eventType === 'trust' ? `${item.agentId} · ${item.eventType}` : `${item.buyer} → ${item.seller} · $${Number(item.amount ?? 0).toFixed(2)}`;
          } else if (String(item).toLowerCase().includes('trust')) {
            type = 'trust';
          }

          return (
            <div
              key={key}
              className="flex items-center gap-3 px-4 py-3 rounded-lg feed-item-futuristic"
              style={{ transition: 'box-shadow 160ms ease, transform 120ms ease', animation: `feedIn 7000ms linear forwards`, animationDelay: `${idx * 160}ms` }}
            >
              <div className="flex-shrink-0">
                <span
                  className={[
                    'inline-flex items-center justify-center rounded-full w-9 h-9 text-sm font-semibold',
                    type === 'trust' ? 'bg-violet-600/10 text-violet-300' : 'bg-emerald-600/8 text-emerald-300',
                  ].join(' ')}
                >
                  {type === 'trust' ? 'T' : '→'}
                </span>
              </div>

              <div className="min-w-0">
                <div className="text-sm truncate payload">{payload}</div>
                <div className="text-xs mt-0.5 meta">{type === 'trust' ? 'Trust event' : 'Transaction'}</div>
              </div>

              <div className="ml-auto flex items-center gap-3">
                <div className="text-xs text-neutral-500 font-mono">{''}</div>
                <span className={`w-2.5 h-2.5 rounded-full ${type === 'trust' ? 'bg-violet-400' : 'bg-emerald-400'}`} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
