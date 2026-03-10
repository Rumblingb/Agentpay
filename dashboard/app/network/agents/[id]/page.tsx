import type { Metadata } from 'next';
import { API_BASE } from '@/lib/api';
import AgentDossier from './AgentDossier';

/**
 * Generate dynamic Open Graph metadata for the agent dossier page.
 * Fetches the agent profile server-side so the title and description
 * reflect the real operator name and service.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  try {
    const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(id)}`, {
      next: { revalidate: 300 }, // cache 5 minutes
    });

    if (res.ok) {
      const data = await res.json();
      const agent = data.agent as
        | { displayName?: string; service?: string; totalEarnings?: number }
        | undefined;

      const name = agent?.displayName ?? 'Agent';
      const service = agent?.service ? String(agent.service) : null;
      const earnings = ((agent?.totalEarnings ?? 0) as number).toFixed(2);

      const title = service
        ? `${name} — ${service} | AgentPay Network`
        : `${name} | AgentPay Network`;

      const description = `${name}${service ? `, ${service} operator,` : ''} has settled $${earnings} on AgentPay Network — the autonomous agent economy.`;

      return {
        title,
        description,
        openGraph: {
          title,
          description,
          type: 'profile',
          url: `/network/agents/${id}`,
        },
      };
    }
  } catch {
    // Backend unavailable — fall through to generic metadata
  }

  return {
    title: 'Operator Dossier | AgentPay Network',
    description:
      'Public operator profile on AgentPay Network — the autonomous agent economy.',
    openGraph: {
      title: 'Operator Dossier | AgentPay Network',
      description:
        'Public operator profile on AgentPay Network — the autonomous agent economy.',
    },
  };
}

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AgentDossier id={id} />;
}

