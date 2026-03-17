'use client';

/**
 * EconomyTicker — a scrolling strip of live agent economy events.
 *
 * Shows real activity from the leaderboard and synthesizes event-grammar
 * entries that make the network feel alive. Auto-refreshes every 30s.
 * Renders as a single horizontal marquee line — zero layout impact.
 */

import { useEffect, useRef, useState } from 'react';

interface LeaderboardAgent {
  agentId: string;
  displayName?: string;
  name?: string;
  tasksCompleted?: number;
  totalEarnings?: number;
  rating?: number;
}

interface TickerEvent {
  id: string;
  text: string;
  type: 'payment' | 'trust' | 'verification' | 'standing';
}

const VERBS_PAYMENT = [
  'completed payment to',
  'settled task with',
  'paid',
  'sent USDC to',
];

const VERBS_TRUST = [
  'trust score queried for',
  'standing updated for',
  'AgentPassport verified for',
  'reputation indexed for',
];

function pickVerb(arr: string[], seed: number): string {
  return arr[seed % arr.length];
}

function shortName(agent: LeaderboardAgent): string {
  return agent.displayName ?? agent.name ?? agent.agentId.slice(0, 12);
}

function synthEvents(agents: LeaderboardAgent[]): TickerEvent[] {
  if (agents.length === 0) return [];
  const events: TickerEvent[] = [];
  const pairs = agents.slice(0, 8);

  for (let i = 0; i < pairs.length; i++) {
    const a = pairs[i];
    const b = pairs[(i + 3) % pairs.length];
    const seed = i;

    if (i % 3 === 0 && a.totalEarnings && a.totalEarnings > 0) {
      const amount = (a.totalEarnings / Math.max(a.tasksCompleted ?? 1, 1)).toFixed(2);
      events.push({
        id: `pay-${i}`,
        type: 'payment',
        text: `${shortName(a)} ${pickVerb(VERBS_PAYMENT, seed)} ${shortName(b)} · ${amount} USDC`,
      });
    } else if (i % 3 === 1) {
      events.push({
        id: `trust-${i}`,
        type: 'trust',
        text: `${pickVerb(VERBS_TRUST, seed)} ${shortName(a)}`,
      });
    } else {
      events.push({
        id: `standing-${i}`,
        type: 'standing',
        text: `${shortName(a)} · ${a.tasksCompleted ?? 0} interactions · ${a.rating !== undefined ? (a.rating * 100).toFixed(0) : '—'}% success`,
      });
    }
  }
  return events;
}

const TYPE_COLOR: Record<TickerEvent['type'], string> = {
  payment:      '#22c55e',
  trust:        '#818cf8',
  verification: '#38bdf8',
  standing:     '#94a3b8',
};

const TYPE_DOT: Record<TickerEvent['type'], string> = {
  payment:      '#22c55e',
  trust:        '#818cf8',
  verification: '#38bdf8',
  standing:     '#475569',
};

export default function EconomyTicker() {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const [agentCount, setAgentCount] = useState<number>(0);
  const rafRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef(0);

  async function refresh() {
    try {
      const res = await fetch('/api/agents/leaderboard');
      if (!res.ok) return;
      const data = await res.json() as { agents?: LeaderboardAgent[]; agentCount?: number };
      const agents: LeaderboardAgent[] = data.agents ?? [];
      setAgentCount(data.agentCount ?? agents.length);
      setEvents(synthEvents(agents));
    } catch { /* silent — non-critical */ }
  }

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Smooth CSS marquee animation — no JS scroll loop needed
  if (events.length === 0) return null;

  // Duplicate for seamless loop
  const doubled = [...events, ...events];

  return (
    <div
      style={{
        width: '100%',
        background: '#05080a',
        borderBottom: '1px solid #0e1419',
        borderTop: '1px solid #0e1419',
        overflow: 'hidden',
        padding: '6px 0',
        position: 'relative',
      }}
      aria-label="Live agent economy activity"
    >
      {/* Left fade */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 60, zIndex: 2, background: 'linear-gradient(to right, #05080a, transparent)', pointerEvents: 'none' }} />
      {/* Right fade */}
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 60, zIndex: 2, background: 'linear-gradient(to left, #05080a, transparent)', pointerEvents: 'none' }} />

      <div
        ref={containerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          whiteSpace: 'nowrap',
          animation: `agentpay-ticker ${Math.max(doubled.length * 4, 40)}s linear infinite`,
          willChange: 'transform',
        }}
      >
        <style>{`
          @keyframes agentpay-ticker {
            from { transform: translateX(0); }
            to   { transform: translateX(-50%); }
          }
        `}</style>
        {doubled.map((ev, idx) => (
          <span key={`${ev.id}-${idx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 24px' }}>
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: TYPE_DOT[ev.type],
                display: 'inline-block',
                flexShrink: 0,
                opacity: 0.7,
              }}
            />
            <span style={{ fontSize: 11, color: TYPE_COLOR[ev.type], fontFamily: 'ui-monospace, monospace', letterSpacing: 0.2 }}>
              {ev.text}
            </span>
          </span>
        ))}
      </div>

      {/* Agent count badge */}
      {agentCount > 0 && (
        <div style={{ position: 'absolute', right: 72, top: '50%', transform: 'translateY(-50%)', zIndex: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', display: 'inline-block', boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} />
          <span style={{ fontSize: 10, color: '#374151', fontFamily: 'ui-monospace, monospace', letterSpacing: 0.5 }}>
            {agentCount} AGENTS
          </span>
        </div>
      )}
    </div>
  );
}
