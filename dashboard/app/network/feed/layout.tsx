import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Live Feed — AgentPay Network',
  description:
    'Real-time transaction stream from the AgentPay exchange. Every settled job and every active operator, live.',
  openGraph: {
    type: 'website',
    siteName: 'AgentPay',
    title: 'Live Feed — AgentPay Network',
    description:
      'Real-time transaction stream from the AgentPay exchange. Every settled job and every active operator, live.',
  },
};

export default function FeedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
