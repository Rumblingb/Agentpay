'use client';

import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

const PAGE_META: Record<string, { title: string; desc: string }> = {
  '/overview':    { title: 'Overview',     desc: 'Payment metrics and network activity' },
  '/rcm':         { title: 'RCM Ops',      desc: 'Autonomous billing operations and exception control' },
  '/intents':     { title: 'Intents',      desc: 'Payment intent ledger' },
  '/escrow':      { title: 'Escrow',       desc: 'Agent-to-agent escrow contracts' },
  '/agentrank':   { title: 'AgentRank',    desc: 'Economic reputation scores' },
  '/marketplace': { title: 'Marketplace',  desc: 'Agent discovery and hiring' },
  '/webhooks':    { title: 'Webhooks',     desc: 'Payment event subscriptions' },
  '/api-keys':    { title: 'API Keys',     desc: 'Key management and rotation' },
  '/billing':     { title: 'Billing',      desc: 'Payment history and usage' },
  '/settings':    { title: 'Settings',     desc: 'Account and integration settings' },
};

async function checkApiHealth(): Promise<boolean> {
  try {
    const r = await fetch('/api/health');
    const d = await r.json();
    return d.status === 'active';
  } catch {
    return false;
  }
}

export default function TopBar() {
  const pathname = usePathname();
  const matchedEntry = Object.entries(PAGE_META)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const meta = matchedEntry?.[1] ?? { title: 'AgentPay', desc: '' };

  const { data: apiOnline = false } = useQuery({
    queryKey: ['apiHealth'],
    queryFn: checkApiHealth,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return (
    <header
      className="flex items-center justify-between px-6 py-3 border-b shrink-0"
      style={{
        background: '#080808',
        borderColor: '#141414',
        height: '52px',
      }}
    >
      {/* Left: breadcrumb */}
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-[#2a2a2a] font-medium">AgentPay</span>
        <span className="text-[#1c1c1c]">/</span>
        <span className="text-[#737373] font-medium">{meta.title}</span>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-4">
        {/* API status */}
        <div className="flex items-center gap-1.5">
          <span
            className={`relative flex h-1.5 w-1.5 ${apiOnline ? '' : 'opacity-50'}`}
          >
            {apiOnline && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            )}
            <span
              className={`relative inline-flex rounded-full h-1.5 w-1.5 ${apiOnline ? 'bg-emerald-500' : 'bg-[#404040]'}`}
            />
          </span>
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${apiOnline ? 'text-emerald-600' : 'text-[#404040]'}`}>
            {apiOnline ? 'Live' : 'Offline'}
          </span>
        </div>

      </div>
    </header>
  );
}
