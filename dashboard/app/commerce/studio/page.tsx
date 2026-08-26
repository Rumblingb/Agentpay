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
  // The seller surface is a local preview and must not be discoverable as a
  // live merchant acquisition or checkout product before it is connected.
  robots: { index: false, follow: false },
};

export default function CatalogTruthStudioPage() {
  return <CatalogTruthStudio />;
}
