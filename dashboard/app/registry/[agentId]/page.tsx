import { Metadata } from 'next';
import AgentDossierPage from './AgentDossierPage';

interface Props {
  params: Promise<{ agentId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { agentId } = await params;
  const title = `${agentId} · AgentPassport`;
  const description = `Portable identity and trust record for ${agentId} — trust score, interaction history, dispute record, and economic standing on the AgentPay network.`;
  const canonical = `/agent/${agentId}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'profile',
      siteName: 'AgentPay — Trust & Settlement Infrastructure',
      title,
      description,
      url: canonical,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

export default async function Page({ params }: Props) {
  const { agentId } = await params;
  return <AgentDossierPage agentId={agentId} />;
}
