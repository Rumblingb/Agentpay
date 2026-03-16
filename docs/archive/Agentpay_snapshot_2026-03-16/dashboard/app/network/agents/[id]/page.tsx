import { permanentRedirect } from 'next/navigation';

/**
 * /network/agents/[id] → canonical Agent Passport is /registry/[agentId].
 *
 * Permanent 308 redirect so that external links, search-engine crawls, and
 * direct browser navigation all land on the single canonical passport page.
 */
export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/registry/${id}`);
}

