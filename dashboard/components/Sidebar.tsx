'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Webhook,
  KeyRound,
  CreditCard,
  LogOut,
  Star,
  Shield,
  Settings,
  Store,
  Zap,
  ChevronRight,
  Train,
} from 'lucide-react';

const coreNav = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/bro-jobs', label: 'Bro Bookings', icon: Train },
  { href: '/intents', label: 'Intents', icon: ArrowLeftRight },
  { href: '/escrow', label: 'Escrow', icon: Shield },
];

const networkNav = [
  { href: '/agentrank', label: 'AgentRank', icon: Star },
  { href: '/marketplace', label: 'Marketplace', icon: Store },
];

const accountNav = [
  { href: '/webhooks', label: 'Webhooks', icon: Webhook },
  { href: '/api-keys', label: 'API Keys', icon: KeyRound },
  { href: '/billing', label: 'Billing', icon: CreditCard },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function NavSection({
  label,
  items,
  pathname,
}: {
  label: string;
  items: typeof coreNav;
  pathname: string;
}) {
  return (
    <div className="mb-1">
      <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#404040]">
        {label}
      </p>
      {items.map(({ href, label: itemLabel, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            className={`group flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] font-medium transition-all duration-150 mb-px ${
              active
                ? 'bg-white/[0.06] text-white'
                : 'text-[#737373] hover:text-[#d4d4d4] hover:bg-white/[0.03]'
            }`}
          >
            <Icon
              size={14}
              className={active ? 'text-emerald-400' : 'text-[#525252] group-hover:text-[#a3a3a3] transition-colors'}
            />
            <span className="flex-1">{itemLabel}</span>
            {active && <ChevronRight size={11} className="text-[#404040]" />}
          </Link>
        );
      })}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <aside
      className="w-[220px] shrink-0 flex flex-col min-h-screen border-r"
      style={{
        background: '#080808',
        borderColor: '#1a1a1a',
      }}
    >
      {/* Wordmark */}
      <div className="px-4 py-5 border-b" style={{ borderColor: '#1a1a1a' }}>
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
          >
            <Zap size={12} className="text-black" fill="currentColor" />
          </div>
          <span
            className="text-[15px] font-bold tracking-[-0.02em] text-white"
            style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
          >
            AgentPay
          </span>
        </div>
        <p className="text-[10px] text-[#404040] uppercase font-semibold mt-1.5 tracking-[0.1em] ml-8">
          Operator Console
        </p>
      </div>

      {/* Live indicator strip */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b"
        style={{ borderColor: '#1a1a1a', background: 'rgba(16,185,129,0.04)' }}
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
        </span>
        <span className="text-[10px] font-medium text-emerald-500 tracking-wide uppercase">
          Network Live
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-4 overflow-y-auto">
        <NavSection label="Core" items={coreNav} pathname={pathname} />
        <NavSection label="Network" items={networkNav} pathname={pathname} />
        <NavSection label="Account" items={accountNav} pathname={pathname} />
      </nav>

      {/* Bottom: sign out */}
      <div className="px-2 pb-4 border-t pt-3" style={{ borderColor: '#1a1a1a' }}>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] font-medium text-[#525252] hover:text-[#d4d4d4] hover:bg-white/[0.03] transition-all duration-150"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
