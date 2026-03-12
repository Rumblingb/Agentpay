'use client';

import { useEffect, useState } from 'react';

export default function LiveNetworkFeed() {
  const [events, setEvents] = useState<string[]>([]);

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
      } catch {
        // ignore
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

  const shown = events.length ? events : sample;

  return (
    <section className="network-feed rounded-xl border border-[#1c1c1c] bg-[#060606]/60 p-4">
      <h2 className="text-sm text-neutral-300 font-medium mb-3">LIVE NETWORK</h2>
      <div className="h-48 overflow-hidden">
        <div className="space-y-2 animate-marquee">
          {shown.map((e, i) => (
            <div key={i} className="event text-xs text-neutral-400 font-mono px-3 py-2 bg-black/20 rounded-md">{e}</div>
          ))}
        </div>
      </div>
    </section>
  );
}
