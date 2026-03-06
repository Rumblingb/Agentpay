/**
 * AgentPay Payment Node for LangGraph
 * =====================================
 * Drop this into any LangGraph workflow to add a payment processing node.
 *
 * Usage:
 *   import { agentPayNode, AgentPayState } from './langgraph-payment-node';
 *
 *   const workflow = new StateGraph<AgentPayState>({ channels: agentPayChannels })
 *     .addNode('process_payment', agentPayNode)
 *     .addEdge(START, 'process_payment')
 *     .compile();
 *
 * Install:
 *   npm install @agentpay/sdk @langchain/langgraph
 */

import { END, START, StateGraph, Annotation } from '@langchain/langgraph';

// ---------------------------------------------------------------------------
// State type for the payment workflow node
// ---------------------------------------------------------------------------
export const AgentPayAnnotation = Annotation.Root({
  // Input fields
  action: Annotation<string>({ reducer: (_, v) => v }),
  amountUsd: Annotation<number>({ reducer: (_, v) => v }),
  recipientId: Annotation<string>({ reducer: (_, v) => v }),
  memo: Annotation<string | undefined>({ reducer: (_, v) => v }),
  paymentId: Annotation<string | undefined>({ reducer: (_, v) => v }),
  agentId: Annotation<string | undefined>({ reducer: (_, v) => v }),

  // Output fields
  result: Annotation<Record<string, unknown> | null>({ reducer: (_, v) => v, default: () => null }),
  error: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
  status: Annotation<string>({ reducer: (_, v) => v, default: () => 'idle' }),
});

export type AgentPayState = typeof AgentPayAnnotation.State;

// ---------------------------------------------------------------------------
// AgentPay client (thin wrapper; replace with @agentpay/sdk when published)
// ---------------------------------------------------------------------------
const AGENTPAY_BASE_URL = process.env.AGENTPAY_API_URL ?? 'https://api.agentpay.gg';
const AGENTPAY_API_KEY = process.env.AGENTPAY_API_KEY ?? '';

async function agentpayFetch(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${AGENTPAY_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AGENTPAY_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AgentPay API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// LangGraph node — processes payments based on state.action
// ---------------------------------------------------------------------------
export async function agentPayNode(state: AgentPayState): Promise<Partial<AgentPayState>> {
  const { action, amountUsd, recipientId, memo, paymentId, agentId } = state;

  try {
    switch (action) {
      case 'create_payment': {
        const result = await agentpayFetch('/api/v1/payment-intents', 'POST', {
          amount: Math.round(amountUsd * 100), // convert to cents
          recipient: recipientId,
          memo: memo ?? 'LangGraph payment',
          method: 'solana',
        });
        return { result, status: 'payment_created', error: null };
      }

      case 'verify_payment': {
        if (!paymentId) throw new Error('paymentId required for verify_payment');
        const result = await agentpayFetch(`/api/verify/${paymentId}`);
        return { result, status: `payment_${result['status']}`, error: null };
      }

      case 'check_rank': {
        if (!agentId) throw new Error('agentId required for check_rank');
        const result = await agentpayFetch(`/api/agentrank/${agentId}`);
        return { result, status: 'rank_checked', error: null };
      }

      case 'create_escrow': {
        const result = await agentpayFetch('/api/escrow/create', 'POST', {
          payeeAgentId: recipientId,
          amount: amountUsd,
          taskDescription: memo ?? 'Task via LangGraph',
        });
        return { result, status: 'escrow_created', error: null };
      }

      default:
        return { error: `Unknown action: ${action}`, status: 'error', result: null };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, status: 'error', result: null };
  }
}

// ---------------------------------------------------------------------------
// Minimal workflow example — runs if executed directly
// ---------------------------------------------------------------------------
async function runExample() {
  const workflow = new StateGraph(AgentPayAnnotation)
    .addNode('payment', agentPayNode)
    .addEdge(START, 'payment')
    .addEdge('payment', END)
    .compile();

  const result = await workflow.invoke({
    action: 'create_payment',
    amountUsd: 2.5,
    recipientId: 'agent-openai-001',
    memo: 'LangGraph weather data access fee',
  } as AgentPayState);

  console.log('LangGraph payment result:', JSON.stringify(result, null, 2));
}

// Uncomment to run:
// runExample().catch(console.error);
export { runExample };
