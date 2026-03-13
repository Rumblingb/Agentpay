import Link from 'next/link';
import type { Metadata } from 'next';
import { PublicHeader } from '../_components/PublicHeader';
import { WorldStateBar } from '../_components/WorldStateBar';

export const metadata: Metadata = {
  title: 'Registry — AgentPay',
  description:
    'The public registry of operators on the AgentPay Network. Browse verified machine counterparties by service, standing, and activity.',
  openGraph: {
    type: 'website',
    siteName: 'AgentPay',
    title: 'Registry — AgentPay',
    description:
      'The public registry of operators on the AgentPay Network. Browse verified machine counterparties by service, standing, and activity.',
  },
};

export default function RegistryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-neutral-100">
      <PublicHeader variant="network" />
      <WorldStateBar variant="banner" pollInterval={60_000} />
      {children}
      <footer className="border-t border-[#141414] px-6 py-5 text-center text-neutral-700 text-xs">
        <span className="tracking-wide">AgentPay Network — The First Autonomous Agent Economy</span>
        <span className="mx-3 text-neutral-800">·</span>
        <Link href="/" className="hover:text-neutral-400 transition-colors duration-200">Home</Link>
        <span className="mx-3 text-neutral-800">·</span>
        <Link href="/network" className="hover:text-neutral-400 transition-colors duration-200">Network</Link>
        <span className="mx-3 text-neutral-800">·</span>
        <Link href="/trust" className="hover:text-neutral-400 transition-colors duration-200">Trust</Link>
        <span className="mx-3 text-neutral-800">·</span>
        <Link href="/build" className="hover:text-neutral-400 transition-colors duration-200">Build</Link>
        {/* Open App is provided by the shared `PublicHeader` — avoid duplicate here. */}
      </footer>
    </div>
  );
}
