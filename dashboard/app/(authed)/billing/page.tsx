import { CreditCard, Receipt, Percent, AlertCircle } from 'lucide-react';

const feeItems = [
  {
    label: 'Platform Fee',
    value: '0.5%',
    description: 'Applied to each confirmed USDC payment',
    icon: Percent,
    iconColor: 'text-purple-400',
    iconBg: 'bg-purple-500/10',
  },
  {
    label: 'Settlement',
    value: 'Instant',
    description: 'Funds sent directly to your Solana wallet on confirmation',
    icon: CreditCard,
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
  },
  {
    label: 'Network Fee',
    value: '~$0.0001',
    description: 'Solana transaction fee (covered by payer)',
    icon: Receipt,
    iconColor: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
  },
];

export default function BillingPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold">Billing</h1>

      <div className="bg-amber-900/20 border border-amber-700/40 text-amber-300 px-4 py-3 rounded-lg flex items-start gap-3">
        <AlertCircle size={16} className="shrink-0 mt-0.5" />
        <p className="text-sm">
          Detailed billing analytics are coming soon. Fee breakdown shown below is based on
          current pricing. Historical invoice data will be available in a future release.
        </p>
      </div>

      {/* Fee breakdown */}
      <div className="space-y-4">
        {feeItems.map(({ label, value, description, icon: Icon, iconColor, iconBg }) => (
          <div
            key={label}
            className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl flex items-start gap-4"
          >
            <div className={`${iconBg} p-2.5 rounded-lg shrink-0`}>
              <Icon className={iconColor} size={20} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{label}</span>
                <span className="text-sm font-bold text-white">{value}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">{description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Placeholder chart area */}
      <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        <h2 className="font-semibold mb-4">Monthly Fee Summary</h2>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm border border-dashed border-slate-700 rounded-xl">
          Analytics data will appear here once available.
        </div>
      </div>
    </div>
  );
}
