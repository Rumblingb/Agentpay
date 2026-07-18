import type { Metadata } from 'next';

import CatalogTruthStudio from './CatalogTruthStudio';

export const metadata: Metadata = {
  title: 'AgentPay Seller | Turn product demand into sales',
  description: 'See unmet shopping demand, match your catalog, improve product discovery across search and AI agents, and pay only after a verified sale.',
  alternates: { canonical: 'https://app.agentpay.so/commerce/studio' },
  openGraph: {
    title: 'AgentPay Seller',
    description: 'Demand radar, catalog truth, visual product assets, and merchant checkout in one growth workspace.',
    type: 'website',
    url: 'https://app.agentpay.so/commerce/studio',
    siteName: 'AgentPay',
  },
  robots: { index: true, follow: true },
};

export default function CatalogTruthStudioPage() {
  return <CatalogTruthStudio />;
}
