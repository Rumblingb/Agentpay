/**
 * Marketplace Event Emitter — real-time SSE broadcast for agent marketplace events.
 *
 * Follows the same fire-and-forget pattern as webhookEmitter.ts but broadcasts
 * to connected SSE clients instead of HTTP webhook endpoints.
 *
 * Events:
 *   job.created        — new task posted
 *   agent.hired        — an agent was hired
 *   escrow.released    — escrow funds released to working agent
 *   agent.earned       — earnings credited (alias of escrow.released with earnings detail)
 *   ranking.updated    — AgentRank score changed
 *
 * @module events/marketplaceEmitter
 */

import { Response } from 'express';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketplaceEventType =
  | 'job.created'
  | 'agent.hired'
  | 'escrow.released'
  | 'agent.earned'
  | 'ranking.updated';

export interface MarketplaceEvent {
  type: MarketplaceEventType;
  agentId?: string;
  escrowId?: string;
  amount?: number;
  taskDescription?: string;
  score?: number;
  grade?: string;
  timestamp: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// SSE client registry
// ---------------------------------------------------------------------------

interface SseClient {
  res: Response;
  agentId?: string;
  connectedAt: Date;
}

const sseClients: SseClient[] = [];

/**
 * Register an SSE client (called from the /api/feed/stream route).
 * Sends a 'connected' event immediately, then keeps the connection alive.
 *
 * Returns a cleanup function that removes the client on disconnect.
 */
export function addSseClient(res: Response, agentId?: string): () => void {
  const client: SseClient = { res, agentId, connectedAt: new Date() };
  sseClients.push(client);

  logger.info('[marketplaceEmitter] SSE client connected', {
    agentId,
    totalClients: sseClients.length,
  });

  // Send welcome event
  sendSseEvent(res, {
    type: 'job.created',
    agentId,
    taskDescription: 'Connected to AgentPay live feed',
    timestamp: new Date().toISOString(),
  });

  // Heartbeat every 20s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch {
      cleanup();
    }
  }, 20_000);

  function cleanup() {
    clearInterval(heartbeat);
    const idx = sseClients.indexOf(client);
    if (idx !== -1) {
      sseClients.splice(idx, 1);
      logger.info('[marketplaceEmitter] SSE client disconnected', {
        agentId,
        totalClients: sseClients.length,
      });
    }
  }

  return cleanup;
}

/**
 * Broadcast a marketplace event to all connected SSE clients.
 * If agentId is specified, only that agent's stream receives the event.
 */
export function broadcastMarketplaceEvent(event: MarketplaceEvent): void {
  const payload = { ...event, timestamp: event.timestamp ?? new Date().toISOString() };

  let sent = 0;
  const toRemove: SseClient[] = [];

  for (const client of sseClients) {
    // Filter by agentId if event is agent-specific
    if (event.agentId && client.agentId && client.agentId !== event.agentId) {
      continue;
    }

    try {
      sendSseEvent(client.res, payload);
      sent++;
    } catch {
      toRemove.push(client);
    }
  }

  // Remove disconnected clients
  for (const dead of toRemove) {
    const idx = sseClients.indexOf(dead);
    if (idx !== -1) sseClients.splice(idx, 1);
  }

  if (sent > 0) {
    logger.info('[marketplaceEmitter] Event broadcast', { type: event.type, sent });
  }
}

/**
 * Write a single SSE frame to a response.
 */
function sendSseEvent(res: Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// Convenience emit helpers
// ---------------------------------------------------------------------------

export function emitJobCreated(agentId: string, taskDescription: string, amount: number): void {
  broadcastMarketplaceEvent({
    type: 'job.created',
    agentId,
    taskDescription,
    amount,
    timestamp: new Date().toISOString(),
  });
}

export function emitAgentHired(
  payerAgentId: string,
  payeeAgentId: string,
  escrowId: string,
  amount: number,
  taskDescription: string,
): void {
  broadcastMarketplaceEvent({
    type: 'agent.hired',
    agentId: payeeAgentId,
    payerAgentId,
    escrowId,
    amount,
    taskDescription,
    timestamp: new Date().toISOString(),
  });
}

export function emitEscrowReleased(escrowId: string, agentId: string, amount: number): void {
  broadcastMarketplaceEvent({
    type: 'escrow.released',
    escrowId,
    agentId,
    amount,
    timestamp: new Date().toISOString(),
  });
  broadcastMarketplaceEvent({
    type: 'agent.earned',
    escrowId,
    agentId,
    amount,
    timestamp: new Date().toISOString(),
  });
}

export function emitRankingUpdated(agentId: string, score: number, grade: string): void {
  broadcastMarketplaceEvent({
    type: 'ranking.updated',
    agentId,
    score,
    grade,
    timestamp: new Date().toISOString(),
  });
}

export function getSseClientCount(): number {
  return sseClients.length;
}
