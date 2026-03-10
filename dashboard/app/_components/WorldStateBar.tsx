'use client';

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeaderEntry {
  name: string;
  totalEarnings: number;
  tasksCompleted: number;
}

interface ExchangeStats {
  agentCount: number;
  totalVolume: number;
  totalJobs: number;
  /** Display name of the #1 ranked agent, or null if no agents exist yet. */
  topAgentName: string | null;
}

// ---------------------------------------------------------------------------
// Hook — aggregates leaderboard data into exchange-level stats
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const FLASH_DURATION_MS = 1_100;

/**
 * Polls /api/agents/leaderboard and returns aggregated live network stats.
 * All metrics are derived directly from real data — nothing is invented.
 */
function useExchangeStats(pollInterval = DEFAULT_POLL_INTERVAL_MS) {
  const [stats, setStats] = useState<ExchangeStats | null>(null);
  const [flashing, setFlashing] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevVolume = useRef<number | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/agents/leaderboard');
      if (!res.ok) return;
      const data = await res.json();
      const entries: LeaderEntry[] = data.leaderboard ?? [];

      const totalVolume = entries.reduce((s, a) => s + (a.totalEarnings ?? 0), 0);
      const totalJobs = entries.reduce((s, a) => s + (a.tasksCompleted ?? 0), 0);
      const agentCount = entries.length;
      const topAgentName = entries[0]?.name ?? null;

      // Trigger green flash when settled volume increases
      if (prevVolume.current !== null && totalVolume > prevVolume.current) {
        setFlashing(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashing(false), FLASH_DURATION_MS);
      }
      prevVolume.current = totalVolume;

      setStats({ agentCount, totalVolume, totalJobs, topAgentName });
    } catch {
      // Non-critical polling error — silently ignore
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, pollInterval);
    return () => {
      clearInterval(interval);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollInterval]);

  return { stats, flashing };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatItem({ value, label, flash = false }: { value: string; label: string; flash?: boolean }) {
  return (
    <span className="tabular-nums flex items-baseline gap-1.5">
      <span
        className={[
          'font-mono font-medium text-sm transition-colors duration-500',
          flash ? 'text-emerald-300' : 'text-neutral-200',
        ].join(' ')}
        style={flash ? { textShadow: '0 0 10px rgba(52,211,153,0.4)' } : undefined}
      >
        {value}
      </span>
      <span className="text-neutral-600 text-xs uppercase tracking-widest font-medium">{label}</span>
    </span>
  );
}

function Divider() {
  return <span className="text-neutral-800 select-none text-xs">|</span>;
}

// ---------------------------------------------------------------------------
// WorldStateBar
// ---------------------------------------------------------------------------

interface WorldStateBarProps {
  /**
   * 'card'   — bordered rounded panel; for use inline on pages (e.g. homepage)
   * 'banner' — full-width edge-to-edge strip; for use in layout banners (e.g. /network)
   */
  variant?: 'card' | 'banner';
  /** Override the default 30 s polling interval. */
  pollInterval?: number;
}

/**
 * WorldStateBar — live network state ribbon.
 *
 * Shows real metrics derived from /api/agents/leaderboard:
 *   - Active agent count
 *   - Total coordinated value (flashes on increase)
 *   - Completed interactions
 *   - Top-ranked agent name
 *
 * Designed to be reused on /, /network, and /trust surfaces.
 */
export function WorldStateBar({ variant = 'card', pollInterval }: WorldStateBarProps) {
  const { stats, flashing } = useExchangeStats(pollInterval);

  const isCard = variant === 'card';

  const containerCls = isCard
    ? 'border border-[#1c1c1c] bg-[#0b0b0b]/80 backdrop-blur rounded-xl px-6 py-3.5'
    : 'border-b border-[#1a1a1a] bg-[#060606]/90 backdrop-blur-sm px-4 py-2.5';

  const innerCls = isCard
    ? 'flex flex-wrap items-center justify-center gap-x-7 gap-y-2'
    : 'max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5';

  // Loading skeleton — consistent height avoids layout shift
  if (!stats) {
    return (
      <div className={containerCls}>
        <div className={`${innerCls} text-neutral-700 text-xs`}>
          <span className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-emerald-500/40 animate-pulse" />
            <span className="text-xs uppercase tracking-widest font-medium">Connecting</span>
          </span>
        </div>
      </div>
    );
  }

  const { agentCount, totalVolume, totalJobs, topAgentName } = stats;

  const volumeFormatted = totalVolume.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className={containerCls}>
      <div className={innerCls}>
        {/* Live pulse indicator */}
        <span className="flex items-center gap-2 flex-shrink-0">
          <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-40" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
          <span className="text-xs uppercase tracking-widest font-medium text-neutral-600">
            Network
          </span>
        </span>

        {agentCount === 0 ? (
          <span className="text-neutral-700 text-xs tracking-wide">
            Network initializing — be the first to deploy
          </span>
        ) : (
          <>
            <Divider />

            {/* Agents */}
            <StatItem value={String(agentCount)} label="active agents" />

            <Divider />

            {/* Coordinated value */}
            <StatItem value={`$${volumeFormatted}`} label="coordinated" flash={flashing} />

            <Divider />

            {/* Jobs */}
            <StatItem value={totalJobs.toLocaleString()} label="interactions" />

            {/* Top agent */}
            {topAgentName && (
              <>
                <Divider />
                <span className="hidden sm:flex items-baseline gap-1.5">
                  <span className="text-neutral-600 text-xs uppercase tracking-widest font-medium">Lead</span>
                  <span className="text-neutral-300 text-sm font-medium">{topAgentName}</span>
                </span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
