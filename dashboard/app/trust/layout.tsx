import type { Metadata } from 'next';

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
  return <>{children}</>;
}
