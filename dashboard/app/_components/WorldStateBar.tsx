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
const FLASH_DURATION_MS = 900;

/**
 * Polls /api/agents/leaderboard and returns aggregated live exchange stats.
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

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="tabular-nums text-slate-300">
      <span className="font-bold text-white">{value}</span>
      <span className="ml-1.5 text-slate-500 text-xs">{label}</span>
    </span>
  );
}

function Sep({ className = '' }: { className?: string }) {
  return <span className={`text-slate-700 select-none ${className}`}>·</span>;
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
 * WorldStateBar — compact live exchange status strip.
 *
 * Shows real metrics derived from /api/agents/leaderboard:
 *   - Active agent count
 *   - Total settled volume (flashes green on increase)
 *   - Completed jobs
 *   - Top-ranked agent name
 *
 * Designed to be reused on /, /network, and /trust surfaces.
 */
export function WorldStateBar({ variant = 'card', pollInterval }: WorldStateBarProps) {
  const { stats, flashing } = useExchangeStats(pollInterval);

  const isCard = variant === 'card';

  const containerCls = isCard
    ? 'border border-slate-800 bg-slate-900/60 backdrop-blur-sm rounded-xl px-6 py-3'
    : 'border-b border-emerald-900/40 bg-emerald-950/30 px-4 py-2';

  const innerCls = isCard
    ? 'flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm'
    : 'max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm';

  // Loading skeleton — consistent height avoids layout shift
  if (!stats) {
    return (
      <div className={containerCls}>
        <div className={`${innerCls} text-slate-600 text-xs`}>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/40 animate-pulse" />
            Connecting…
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
        {/* Live pulse indicator + label */}
        <span className="flex items-center gap-1.5 text-slate-500 text-xs uppercase tracking-widest font-semibold flex-shrink-0">
          <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          Exchange
        </span>

        {agentCount === 0 ? (
          <span className="text-slate-600 text-xs">
            Network initializing — be the first to deploy
          </span>
        ) : (
          <>
            {/* Agents */}
            <Stat value={String(agentCount)} label="agents" />

            <Sep />

            {/* Volume — flashes green when it ticks up */}
            <span className="tabular-nums">
              <span
                className={[
                  'font-bold transition-colors duration-300',
                  flashing ? 'text-emerald-300' : 'text-emerald-400',
                ].join(' ')}
                style={flashing ? { textShadow: '0 0 10px rgba(52,211,153,0.55)' } : undefined}
              >
                ${volumeFormatted}
              </span>
              <span className="ml-1.5 text-slate-500 text-xs">settled</span>
            </span>

            <Sep />

            {/* Jobs */}
            <Stat value={totalJobs.toLocaleString()} label="jobs completed" />

            {/* Top agent — hidden on small screens to keep strip compact */}
            {topAgentName && (
              <>
                <Sep className="hidden sm:inline" />
                <span className="hidden sm:inline text-slate-500 text-xs">
                  lead{' '}
                  <span className="text-slate-300 font-medium">{topAgentName}</span>
                </span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
