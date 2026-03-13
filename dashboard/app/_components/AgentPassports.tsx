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
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('AgentPassports load error:', err);
      }
    }
    load();
    const iv = setInterval(load, 15_000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  // surface fetch errors to console so Founding Era operators can see failures
  // (non-fatal; does not block rendering)

  const sample = [
    { name: 'CodeAgent', trust: 942, grade: 'S', tx: 1294, success: '99.2%' },
    { name: 'TravelAgent', trust: 887, grade: 'A', tx: 843, success: '97.9%' },
  ];

  const shown = agents.length ? agents : sample;

  function computeTrustPercent(agent: any) {
    const raw = agent.rating ?? agent.trust ?? 0;
    const num = Number(raw) || 0;
    if (num > 10) return Math.min(num / 1000, 1);
    return Math.min(num / 5, 1);
  }

  function displayTrustValue(agent: any) {
    const raw = agent.rating ?? agent.trust ?? 0;
    return raw;
  }

  return (
    <section className="passports">
      <h2 className="text-sm text-neutral-300 font-medium mb-3">AGENT PASSPORTS</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shown.map((a: any) => {
          const id = a.agentId ?? a.name ?? 'unknown';
          const percent = computeTrustPercent(a);
          const trustLabel = displayTrustValue(a);
          const grade = a.grade ?? (Number(trustLabel) >= 900 ? 'S' : 'A');
          const interactions = a.tasksCompleted ?? a.tx ?? 0;
          const reliability = a.success ?? (a.successRate ?? '—');

          return (
            <article key={id} className="passport-card panel-ledger space-card rounded-lg">
              {/* Issuer header */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs text-neutral-500">Agent Passport</div>
                  <div className="text-[11px] text-neutral-600">Issued by AgentPay Trust Layer</div>
                </div>
                <div className="text-xs text-neutral-500">{a.isFoundationAgent ? 'Foundation' : 'Operator'}</div>
              </div>

              {/* Main identity + trust ring */}
              <div className="flex items-center gap-4">
                <div style={{ width: 68, height: 68 }} className="flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full">
                    <defs />
                    <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="4" />
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="var(--color-live)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${Math.round(94)} 100"`}
                      style={{ strokeDashoffset: `${100 - Math.round(percent * 100)}` }}
                    />
                  </svg>
                </div>

                <div className="min-w-0">
                  <h3 className="font-mono text-sm text-neutral-200 truncate">{a.name ?? id}</h3>
                  <div className="text-xs text-neutral-500 font-mono truncate">{a.agentId ?? '—'}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="text-xs text-neutral-400">Grade <span className="font-semibold text-neutral-200">{grade}</span></div>
                    <div className="text-xs text-neutral-400">Trust <span className="font-semibold text-emerald-400">{String(trustLabel)}</span></div>
                  </div>
                </div>
              </div>

              {/* Activity ribbon */}
              <div className="mt-4 flex items-center justify-between bg-white/[0.02] rounded-md px-3 py-2 text-xs">
                <div className="text-neutral-300">+{interactions} successful interactions</div>
                <div className="text-neutral-500">{reliability} reliability</div>
              </div>

              {/* Reputation block */}
              <div className="mt-3 text-xs text-neutral-400 space-y-1">
                <div>Endorsements: <span className="text-neutral-200 font-medium">{a.endorsements ?? '—'}</span></div>
                <div>Resolved disputes: <span className="text-neutral-200 font-medium">{a.disputesResolved ?? '—'}</span></div>
                <div>Network standing: <span className="text-neutral-200 font-medium">{a.rank ?? '—'}</span></div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
