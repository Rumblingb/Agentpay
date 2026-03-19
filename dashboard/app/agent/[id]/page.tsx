import { permanentRedirect } from 'next/navigation';
import type { Metadata } from 'next';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * /agent/:id — canonical short URL for AgentPassport pages.
 *
 * This is the shareable URL format:
 *   agentpay.so/agent/agent_001
 *
 * Permanently redirects to /registry/:id which is the full passport page.
 * External links, social shares, and SDK profileUrl all use this path.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `${id} — AgentPassport · AgentPay`,
    description: `Portable identity and trust record for agent ${id}. View trust score, interaction history, and network standing.`,
    alternates: { canonical: `/agent/${id}` },
    openGraph: {
      type: 'profile',
      siteName: 'AgentPay',
      title: `${id} · AgentPassport`,
      description: `Trust score, interaction history, and network standing for ${id}.`,
      url: `/agent/${id}`,
    },
  };
}

export default async function AgentPassportShortUrl({ params }: Props) {
  const { id } = await params;
  permanentRedirect(`/registry/${id}`);
}
