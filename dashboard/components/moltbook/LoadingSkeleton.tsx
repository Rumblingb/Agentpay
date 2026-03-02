'use client';

function SkeletonBlock({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse bg-slate-700/50 rounded ${className}`} style={style} />;
}

export function SpendingCardSkeleton() {
  return (
    <div className="lg:col-span-1 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
      <SkeletonBlock className="h-3 w-28 mb-3" />
      <div className="flex items-baseline gap-2">
        <SkeletonBlock className="h-8 w-24" />
        <SkeletonBlock className="h-5 w-16" />
      </div>
      <div className="mt-3 w-full bg-slate-800 rounded-full h-2">
        <SkeletonBlock className="h-2 w-3/5 rounded-full" />
      </div>
      <SkeletonBlock className="h-3 w-32 mt-2" />
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
      <SkeletonBlock className="h-9 w-9 rounded-lg mb-3" />
      <SkeletonBlock className="h-7 w-24 mb-2" />
      <SkeletonBlock className="h-3 w-20" />
    </div>
  );
}

export function SpendingChartSkeleton() {
  return (
    <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
      <SkeletonBlock className="h-5 w-44 mb-5" />
      <div className="h-56 flex items-end gap-3 px-4">
        {[40, 65, 50, 80, 55, 70, 60].map((h, i) => (
          <SkeletonBlock key={i} className="flex-1 rounded-t" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

export function TopMerchantsSkeleton() {
  return (
    <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
      <SkeletonBlock className="h-5 w-28 mb-4" />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <div>
              <SkeletonBlock className="h-4 w-28 mb-1" />
              <SkeletonBlock className="h-3 w-20" />
            </div>
            <SkeletonBlock className="h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PolicySettingsSkeleton() {
  return (
    <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
      <SkeletonBlock className="h-5 w-28 mb-4" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TransactionTableSkeleton() {
  return (
    <div className="lg:col-span-2 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
      <SkeletonBlock className="h-5 w-36 mb-4" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800">
              <th className="text-left pb-2"><SkeletonBlock className="h-3 w-10" /></th>
              <th className="text-left pb-2"><SkeletonBlock className="h-3 w-16" /></th>
              <th className="text-right pb-2"><SkeletonBlock className="h-3 w-14 ml-auto" /></th>
              <th className="text-right pb-2"><SkeletonBlock className="h-3 w-12 ml-auto" /></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-slate-800/50">
                <td className="py-2"><SkeletonBlock className="h-4 w-14" /></td>
                <td className="py-2"><SkeletonBlock className="h-4 w-24" /></td>
                <td className="py-2 text-right"><SkeletonBlock className="h-4 w-16 ml-auto" /></td>
                <td className="py-2 text-right"><SkeletonBlock className="h-5 w-16 rounded-full ml-auto" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
