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
} from 'lucide-react';

const navItems = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/agentrank', label: 'AgentRank', icon: Star },
  { href: '/escrow', label: 'Escrow', icon: Shield },
  { href: '/intents', label: 'Intents', icon: ArrowLeftRight },
  { href: '/webhooks', label: 'Webhooks', icon: Webhook },
  { href: '/api-keys', label: 'API Keys', icon: KeyRound },
  { href: '/billing', label: 'Billing', icon: CreditCard },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <aside className="w-56 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col min-h-screen">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-800">
        <span className="text-lg font-bold tracking-tight text-emerald-400">AgentPay</span>
        <p className="text-[10px] text-slate-500 uppercase font-semibold mt-0.5 tracking-wider">
          Dashboard
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                active
                  ? 'bg-emerald-600/20 text-emerald-400'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 pb-5">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
