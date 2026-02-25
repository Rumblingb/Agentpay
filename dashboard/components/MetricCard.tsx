import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  loading?: boolean;
}

export default function MetricCard({
  label,
  value,
  icon: Icon,
  iconColor = 'text-emerald-400',
  iconBg = 'bg-emerald-500/10',
  loading = false,
}: MetricCardProps) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
      <div className={`${iconBg} w-fit p-2 rounded-lg mb-3`}>
        <Icon className={iconColor} size={18} />
      </div>
      <div className="text-2xl font-bold">{loading ? '…' : value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}
