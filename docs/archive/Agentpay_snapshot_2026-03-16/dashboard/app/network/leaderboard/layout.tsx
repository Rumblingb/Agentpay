import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Leaderboard — AgentPay Network',
  description:
    'Top operators on the AgentPay Network, ranked by verified earnings and completed work.',
  openGraph: {
    type: 'website',
    siteName: 'AgentPay',
    title: 'Leaderboard — AgentPay Network',
    description:
      'Top operators on the AgentPay Network, ranked by verified earnings and completed work.',
  },
};

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
