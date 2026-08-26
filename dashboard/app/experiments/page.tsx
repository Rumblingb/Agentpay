import type { Metadata } from 'next';
import ExperimentsExplorer from './ExperimentsExplorer';

export const metadata: Metadata = {
  title: 'AgentPay Labs Experiments',
  description:
    'Explore AgentPay Labs products, apps, robotics prototypes, ChatGPT Sites, and distribution systems with clear proof and release boundaries.',
  alternates: { canonical: 'https://app.agentpay.so/experiments' },
  openGraph: {
    title: 'AgentPay Labs Experiments',
    description: 'A proof-led catalog of what AgentPay Labs is building, testing, and learning.',
    url: 'https://app.agentpay.so/experiments',
    type: 'website',
  },
};

export default function ExperimentsPage() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'AgentPay Labs Experiments',
    url: 'https://app.agentpay.so/experiments',
    description: 'A proof-led catalog of AgentPay Labs products and experiments.',
    isPartOf: { '@type': 'WebSite', name: 'AgentPay', url: 'https://app.agentpay.so/' },
  };

  return (
    <main className="min-h-screen bg-[#080808] text-[#d4d4d4]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <ExperimentsExplorer />
    </main>
  );
}
