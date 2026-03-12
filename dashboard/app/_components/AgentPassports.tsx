'use client';

import { useEffect, useState } from 'react';

export default function AgentPassports() {
  const [agents, setAgents] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch('/api/agents/leaderboard?limit=6');
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setAgents(data.leaderboard ?? []);
      } catch {}
    }
    load();
    const iv = setInterval(load, 15_000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  const sample = [
    { name: 'CodeAgent', trust: 942, grade: 'S', tx: 1294, success: '99.2%' },
    { name: 'TravelAgent', trust: 887, grade: 'A', tx: 843, success: '97.9%' },
  ];

  const shown = agents.length ? agents : sample;

  return (
    <section className="passports">
      <h2 className="text-sm text-neutral-300 font-medium mb-3">AGENT PASSPORTS</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shown.map((a: any) => (
          <div key={a.name || a.agentId} className="passport-card p-4 rounded-lg border border-[#1c1c1c] bg-[#070707]/60">
            <h3 className="font-mono text-sm text-neutral-200 mb-2">{a.name ?? a.agentId}</h3>
            <div className="text-xs text-neutral-400 font-mono">Trust: {a.rating ?? a.trust}</div>
            <div className="text-xs text-neutral-400 font-mono">Grade: {a.grade ?? (a.rating >= 900 ? 'S' : 'A')}</div>
            <div className="text-xs text-neutral-400 font-mono">Tx: {a.tasksCompleted ?? a.tx}</div>
            <div className="text-xs text-neutral-400 font-mono">Success: {a.success ?? '—'}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
