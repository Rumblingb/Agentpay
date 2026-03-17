import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  loading?: boolean;
  /** e.g. "+12.4%" — shown as a trend badge */
  trend?: string;
  /** positive | negative | neutral — controls trend colour */
  trendDir?: 'positive' | 'negative' | 'neutral';
  /** small description below the label */
  sub?: string;
}

export default function MetricCard({
  label,
  value,
  icon: Icon,
  iconColor = 'text-emerald-400',
  iconBg = 'bg-emerald-500/10',
  loading = false,
  trend,
  trendDir = 'neutral',
  sub,
}: MetricCardProps) {
  const trendColor =
    trendDir === 'positive'
      ? 'text-emerald-400'
      : trendDir === 'negative'
      ? 'text-red-400'
      : 'text-[#525252]';

  const TrendIcon =
    trendDir === 'positive' ? TrendingUp : trendDir === 'negative' ? TrendingDown : Minus;

  return (
    <div
      className="relative rounded-xl p-5 flex flex-col gap-3 overflow-hidden"
      style={{
        background: '#0d0d0d',
        border: '1px solid #1c1c1c',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
      }}
    >
      {/* Icon + trend row */}
      <div className="flex items-start justify-between">
        <div
          className={`${iconBg} w-8 h-8 rounded-lg flex items-center justify-center`}
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Icon className={iconColor} size={15} />
        </div>
        {trend && !loading && (
          <span
            className={`flex items-center gap-1 text-[11px] font-semibold ${trendColor}`}
          >
            <TrendIcon size={11} />
            {trend}
          </span>
        )}
      </div>

      {/* Value */}
      <div>
        {loading ? (
          <div className="h-7 w-20 rounded-md animate-pulse" style={{ background: '#1c1c1c' }} />
        ) : (
          <div
            className="text-[26px] font-bold tracking-tight text-white"
            style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}
          >
            {value}
          </div>
        )}
        <div className="text-[12px] text-[#525252] mt-1 font-medium">{label}</div>
        {sub && !loading && (
          <div className="text-[11px] text-[#3d3d3d] mt-0.5">{sub}</div>
        )}
      </div>

      {/* Subtle bottom glow on hover */}
      <div
        className="absolute inset-x-0 bottom-0 h-px opacity-0 hover:opacity-100 transition-opacity"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(16,185,129,0.3), transparent)' }}
      />
    </div>
  );
}
