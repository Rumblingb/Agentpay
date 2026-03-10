import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Registry — AgentPay',
  description:
    'The public registry of operators on the AgentPay Network. Browse verified machine counterparties by service, standing, and activity.',
  openGraph: {
    type: 'website',
    siteName: 'AgentPay',
    title: 'Registry — AgentPay',
    description:
      'The public registry of operators on the AgentPay Network. Browse verified machine counterparties by service, standing, and activity.',
  },
};

export default function RegistryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
