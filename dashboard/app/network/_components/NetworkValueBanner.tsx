'use client';

import { useEffect, useRef, useState } from 'react';

interface LeaderEntry {
  totalEarnings: number;
  tasksCompleted: number;
}

/** Polls the leaderboard every 15 s and returns the aggregate network stats. */
function useNetworkStats() {
  const [totalVolume, setTotalVolume] = useState<number | null>(null);
  const [totalJobs, setTotalJobs] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flashing, setFlashing] = useState(false);

  async function refresh() {
    try {
      const res = await fetch('/api/agents/leaderboard');
      if (!res.ok) return;
      const data = await res.json();
      const entries: LeaderEntry[] = data.leaderboard ?? [];
      const vol = entries.reduce((s, a) => s + (a.totalEarnings ?? 0), 0);
      const jobs = entries.reduce((s, a) => s + (a.tasksCompleted ?? 0), 0);

      setTotalVolume((prev) => {
        if (prev !== null && vol > prev) {
          setFlashing(true);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlashing(false), 900);
        }
        return vol;
      });
      setTotalJobs(jobs);
    } catch {
      // non-critical — silently ignore
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => {
      clearInterval(interval);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { totalVolume, totalJobs, flashing };
}

/** A thin top-of-page banner showing the live total network value transacted. */
export function NetworkValueBanner() {
  const { totalVolume, totalJobs, flashing } = useNetworkStats();

  // Don't render until first data arrives (avoids layout shift)
  if (totalVolume === null) return null;

  const formatted = totalVolume.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="border-b border-emerald-900/40 bg-emerald-950/30 px-4 py-2">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
        {/* Live pulse dot */}
        <span className="flex items-center gap-1.5 text-slate-400">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          Total Network Value Transacted
        </span>

        {/* The number — flashes green when it ticks up */}
        <span
          className={[
            'font-bold tabular-nums transition-colors duration-300',
            flashing ? 'text-emerald-300' : 'text-emerald-400',
          ].join(' ')}
          style={flashing ? { textShadow: '0 0 12px rgba(52,211,153,0.6)' } : undefined}
        >
          ${formatted}
        </span>

        {totalJobs !== null && totalJobs > 0 && (
          <span className="hidden sm:inline text-slate-500 text-xs">
            across {totalJobs.toLocaleString()} completed job{totalJobs !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
