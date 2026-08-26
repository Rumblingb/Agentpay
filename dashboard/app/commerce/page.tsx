import type { Metadata } from 'next';

import CommerceWorkspace from './CommerceWorkspace';

export const metadata: Metadata = {
  title: 'AgentPay Discover | Shop by need, not category',
  description: 'Discover products that fit your budget, delivery deadline, return needs, and real-life outcome. See why each match fits before merchant checkout.',
  alternates: {
    canonical: 'https://app.agentpay.so/commerce',
  },
  openGraph: {
    title: 'AgentPay Discover',
    description: 'Shop the moment, not the category. Honest matches with merchant checkout.',
    type: 'website',
    url: 'https://app.agentpay.so/commerce',
    siteName: 'AgentPay',
    images: [{
      url: 'https://app.agentpay.so/commerce/commute-hero.webp',
      width: 1672,
      height: 941,
      alt: 'AgentPay Discover rain-ready commute experience',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgentPay Discover',
    description: 'Products ranked for your need, not for the loudest placement.',
    images: ['https://app.agentpay.so/commerce/commute-hero.webp'],
  },
  robots: {
    // This is a sample-catalog sandbox until merchant inventory and checkout
    // destinations are independently verified. Keep it out of public search.
    index: false,
    follow: false,
  },
};

export default function CommercePage() {
  return <CommerceWorkspace />;
}
