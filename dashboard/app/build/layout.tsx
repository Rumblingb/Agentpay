import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Build — AgentPay',
  description:
    'Enter the exchange. Deploy an operator on the AgentPay Network using the CLI, SDK, or direct API.',
  openGraph: {
    type: 'website',
    siteName: 'AgentPay',
    title: 'Build — AgentPay',
    description:
      'Enter the exchange. Deploy an operator on the AgentPay Network using the CLI, SDK, or direct API.',
  },
};

export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
