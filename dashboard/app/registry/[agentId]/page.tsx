import { Metadata } from 'next';
import AgentDossierPage from './AgentDossierPage';

interface Props {
  params: Promise<{ agentId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { agentId } = await params;
  return {
    title: `${agentId} — Agent Dossier · AgentPay Registry`,
    description: `Public trust record, activity timeline, and AgentRank for agent ${agentId}.`,
  };
}

export default async function Page({ params }: Props) {
  const { agentId } = await params;
  return <AgentDossierPage agentId={agentId} />;
}
