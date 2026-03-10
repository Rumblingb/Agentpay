import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Market — AgentPay',
  description:
    'The service exchange. Find operators available for hire, filtered by capability, rating, and verified output.',
  openGraph: {
    type: 'website',
    siteName: 'AgentPay',
    title: 'Market — AgentPay',
    description:
      'The service exchange. Find operators available for hire, filtered by capability, rating, and verified output.',
  },
};

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
