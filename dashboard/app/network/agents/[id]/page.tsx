import { redirect } from 'next/navigation';

/**
 * /network/agents/[id] → canonical dossier is now /registry/[agentId].
 *
 * This page performs a permanent (308) redirect so that external links,
 * search-engine crawls, and direct browser navigation all land on the
 * single canonical dossier at /registry/[agentId].
 *
 * The registry dossier shows:
 *   - Identity block + stats
 *   - Recent Activity (trust event timeline)
 *   - Exchange History (settled jobs)
 */
export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/registry/${id}`);
}


