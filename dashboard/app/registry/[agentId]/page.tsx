import { Metadata } from 'next';
import AgentDossierPage from './AgentDossierPage';

interface Props {
  params: Promise<{ agentId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { agentId } = await params;
  const title = `${agentId} — Agent Passport · AgentPay`;
  const description = `Public counterparty file for agent ${agentId} — trust score, dispute record, interaction history, and network standing on AgentPay.`;
  return {
    title,
    description,
    openGraph: {
      type: 'profile',
      siteName: 'AgentPay',
      title,
      description,
      url: `/registry/${agentId}`,
    },
    alternates: {
      canonical: `/registry/${agentId}`,
    },
  };
}

export default async function Page({ params }: Props) {
  const { agentId } = await params;
  return <AgentDossierPage agentId={agentId} />;
}
