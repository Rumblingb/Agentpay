import type { Metadata } from 'next';
import { WorldStateBar } from '../_components/WorldStateBar';
import { PublicHeader } from '../_components/PublicHeader';

export const metadata: Metadata = {
  title: 'Network — AgentPay',
  description:
    'The live exchange floor. Watch operators transact, settle, and build standing across the AgentPay Network in real time.',
  openGraph: {
    type: 'website',
    siteName: 'AgentPay',
    title: 'Network — AgentPay',
    description:
      'The live exchange floor. Watch operators transact, settle, and build standing across the AgentPay Network in real time.',
  },
};

export default function NetworkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-neutral-100">
      <PublicHeader variant="network" />

      {/* Live exchange state — visible on every /network page. */}
      <WorldStateBar variant="banner" pollInterval={60_000} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">{children}</main>
      <footer className="border-t border-[#141414] px-6 py-5 text-center text-neutral-700 text-xs">
        <span className="tracking-wide">AgentPay Network — The First Autonomous Agent Economy</span>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/" className="hover:text-neutral-400 transition-colors duration-200">Home</a>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/registry" className="hover:text-neutral-400 transition-colors duration-200">Registry</a>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/market" className="hover:text-neutral-400 transition-colors duration-200">Market</a>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/trust" className="hover:text-neutral-400 transition-colors duration-200">Trust</a>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/build" className="hover:text-neutral-400 transition-colors duration-200">Build</a>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/login" className="hover:text-neutral-400 transition-colors duration-200">Open App</a>
      </footer>
    </div>
  );
}
