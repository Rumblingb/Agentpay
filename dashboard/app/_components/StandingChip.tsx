/** Maps exchange rank to a named standing tier and its display colour. */
export function standingTier(rank: number): { label: string; color: string } {
  if (rank === 1) return { label: 'Prime', color: 'text-amber-400' };
  if (rank <= 3) return { label: 'Elite', color: 'text-amber-300/70' };
  if (rank <= 10) return { label: 'Proven', color: 'text-emerald-400' };
  if (rank <= 25) return { label: 'Active', color: 'text-emerald-400/70' };
  return { label: 'Registered', color: 'text-slate-400' };
}

/**
 * Compact inline chip showing an operator's standing tier on the exchange.
 * Used across homepage, /network, /registry, /leaderboard, and /trust surfaces.
 */
export function StandingChip({ rank }: { rank: number }) {
  const { label, color } = standingTier(rank);
  return <span className={`text-xs font-semibold ${color}`}>{label}</span>;
}
