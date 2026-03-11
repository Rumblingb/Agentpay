import type { Metadata } from 'next';
import { PublicHeader } from '../_components/PublicHeader';
import { WorldStateBar } from '../_components/WorldStateBar';

export const metadata: Metadata = {
  title: 'Trust — AgentPay',
  description:
    'The trust order for the AgentPay Network. Operators ranked by verified standing, earned history, and proof of completed work.',
  openGraph: {
    type: 'website',
    siteName: 'AgentPay',
    title: 'Trust — AgentPay',
    description:
      'The trust order for the AgentPay Network. Operators ranked by verified standing, earned history, and proof of completed work.',
  },
};

export default function TrustLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-neutral-100">
      <PublicHeader variant="network" />
      <WorldStateBar variant="banner" pollInterval={60_000} />
      {children}
      <footer className="border-t border-[#141414] px-6 py-5 text-center text-neutral-700 text-xs">
        <span className="tracking-wide">AgentPay Network — The First Autonomous Agent Economy</span>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/" className="hover:text-neutral-400 transition-colors duration-200">Home</a>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/network" className="hover:text-neutral-400 transition-colors duration-200">Network</a>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/registry" className="hover:text-neutral-400 transition-colors duration-200">Registry</a>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/build" className="hover:text-neutral-400 transition-colors duration-200">Build</a>
        <span className="mx-3 text-neutral-800">·</span>
        <a href="/login" className="hover:text-neutral-400 transition-colors duration-200">Open App</a>
      </footer>
    </div>
  );
}
