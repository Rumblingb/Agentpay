#!/usr/bin/env node
/**
 * AgentPay MCP Server
 *
 * Exposes AgentPay payment, trust, and governed mandate capabilities as Model
 * Context Protocol tools, so any MCP-compatible AI assistant can create
 * payment intents, verify settlements, look up AgentPassports, manage the
 * portable identity bundle, and drive mandates on the canonical /api/mandates
 * surface.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

const DEFAULT_API_URL = process.env.AGENTPAY_API_URL ?? 'https://api.agentpay.so';
const DEFAULT_API_KEY = process.env.AGENTPAY_API_KEY ?? '';
const DEFAULT_MERCHANT_ID = process.env.AGENTPAY_MERCHANT_ID ?? '';
const MANDATE_BASE_PATH = '/api/mandates';
const IDENTITY_BASE_PATH = '/api/foundation-agents/identity';
const PAYMENTS_BASE_PATH = '/api/payments';
const CAPABILITIES_BASE_PATH = '/api/capabilities';

if (!DEFAULT_API_KEY) {
  process.stderr.write('Warning: AGENTPAY_API_KEY is not set. Authenticated operations will fail.\n');
}

export interface AgentPayMcpRuntime {
  apiUrl?: string;
  apiKey?: string;
  merchantId?: string;
  fetchImpl?: typeof fetch;
  onToolResult?: (event: {
    toolName: string;
    data: unknown;
  }) => void | Promise<void>;
}

function resolveRuntime(runtime?: AgentPayMcpRuntime) {
  return {
    apiUrl: runtime?.apiUrl ?? DEFAULT_API_URL,
    apiKey: runtime?.apiKey ?? DEFAULT_API_KEY,
    merchantId: runtime?.merchantId ?? DEFAULT_MERCHANT_ID,
    fetchImpl: runtime?.fetchImpl ?? fetch,
  };
}

async function apiFetch(
  path: string,
  options: RequestInit = {},
  runtime?: AgentPayMcpRuntime,
): Promise<unknown> {
  const resolved = resolveRuntime(runtime);
  const url = `${resolved.apiUrl}${path}`;
  const res = await resolved.fetchImpl(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(resolved.apiKey ? { Authorization: `Bearer ${resolved.apiKey}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`AgentPay API error ${res.status}: ${text}`);
  return data;
}

const mandateToolDescriptions = {
  create:
    'Create and plan a governed AgentPay mandate on /api/mandates. Use this when a human has already set the objective, budget, and approval policy, and an agent needs a durable record it can inspect and execute safely.',
  get:
    'Fetch a full mandate record from /api/mandates/:intentId, including approval state, execution readiness, recommendation, and latest journey state.',
  journey:
    'Fetch the latest journey/execution session for a mandate from /api/mandates/journeys/:intentId.',
  history:
    'Fetch the append-only or synthesized audit timeline for a mandate from /api/mandates/:intentId/history.',
  approve:
    'Approve a mandate awaiting approval on /api/mandates/:intentId/approve. Supports either an actorId for policy-driven approvals or an approvalToken from a linked approval session.',
  execute:
    'Start execution for an approved or policy-authorized mandate on /api/mandates/:intentId/execute. Returns the execution state and journey session ID.',
  cancel:
    'Cancel or revoke a non-executing mandate on /api/mandates/:intentId/cancel while preserving the mandate audit trail.',
} as const;

const identityToolDescriptions = {
  get:
    'Fetch the canonical portable identity bundle from /api/foundation-agents/identity with action get_identity. Use this to inspect verified credentials, linked identities, and current trust state for an agent.',
  verify:
    'Verify an agent identity through /api/foundation-agents/identity with action verify. Use this when an operator has evidence to attest ownership, environment, and proofs for an agent.',
  inboxProvision:
    'Provision or return the portable agent inbox through /api/foundation-agents/identity with action provision_inbox. Use this when an agent needs a reusable email address and inbox identity without forcing dashboard setup.',
  inboxSend:
    'Send a message from the portable agent inbox through /api/foundation-agents/identity with action send_inbox_message. Use this for agent-driven email actions once the inbox is provisioned.',
  inboxList:
    'List recent inbox messages through /api/foundation-agents/identity with action list_inbox_messages. Use this when an agent needs to inspect recent email state without leaving the MCP runtime.',
  phoneStart:
    'Start phone verification through /api/foundation-agents/identity with action start_phone_verification. Use this when an agent needs an SMS or voice challenge started for a phone number.',
  phoneConfirm:
    'Confirm phone verification through /api/foundation-agents/identity with action confirm_phone_verification. Use this after the challenge is sent and a verification code or token is available.',
  link:
    'Link multiple agent identities through /api/foundation-agents/identity with action link. Use this to connect cross-platform identities owned by the same operator.',
  credential:
    'Verify an issued identity credential through /api/foundation-agents/identity with action verify_credential.',
} as const;

const fundingToolDescriptions = {
  create:
    'Create a Stripe funding setup intent through /api/payments/setup-intent. Use this when an agent needs a reusable off-session funding method attached to a human principal.',
  confirm:
    'Confirm a completed Stripe funding setup through /api/payments/confirm-setup so the saved payment method is stored for the principal and can be used by governed mandates.',
  list:
    'List saved funding methods for a principal through /api/payments/methods/:principalId.',
  request:
    'Create a human funding request through /api/payments/funding-request. Use this when the agent is ready to act but needs the human to fund the step inline. Returns a nextAction payload hosts can render without sending the human through a dashboard flow.',
} as const;

const capabilityToolDescriptions = {
  catalog:
    'List the external capability provider catalog from /api/capabilities/providers/catalog. Use this to inspect which providers AgentPay can connect, their free-call allowance, and their paid usage rate.',
  connect:
    'Request a secure external capability connect session through /api/capabilities/connect-sessions. Use this when a human must attach an API key or external credential without ever handing the raw secret to the agent.',
  list:
    'List connected external capabilities through /api/capabilities. Use this to inspect what external APIs are already connected and what their free-tier and paid-usage policy is.',
  get:
    'Fetch one connected external capability through /api/capabilities/:capabilityId.',
  execute:
    'Execute an external API call through the governed capability proxy at /api/capabilities/:capabilityId/execute. AgentPay injects the vaulted credential, enforces allow-listed hosts, tracks free usage, and gates paid usage.',
} as const;

export const TOOLS: Tool[] = [
  {
    name: 'agentpay_create_payment_intent',
    description:
      'Create a payment intent on AgentPay. Returns a Solana Pay URI the payer can use to send USDC, ' +
      'plus a verificationToken to include as the Solana memo. Use this when an agent needs to receive payment ' +
      'from a human or another agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        amount: {
          type: 'number',
          description: 'Amount in USDC (e.g. 5 for $5 USDC)',
        },
        purpose: {
          type: 'string',
          description: 'Human-readable description of what this payment is for (max 500 chars)',
        },
        agentId: {
          type: 'string',
          description: 'Identifier of the agent receiving payment',
        },
        currency: {
          type: 'string',
          description: 'Currency code (default: USDC)',
          default: 'USDC',
        },
      },
      required: ['amount'],
    },
  },
  {
    name: 'agentpay_get_intent_status',
    description:
      'Check the status of a payment intent. Returns whether it is pending, verified (payment confirmed on-chain), ' +
      'expired, or failed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        intentId: {
          type: 'string',
          description: 'The payment intent ID returned by agentpay_create_payment_intent',
        },
      },
      required: ['intentId'],
    },
  },
  {
    name: 'agentpay_get_receipt',
    description:
      'Get the settlement receipt for a confirmed payment intent. Returns the full verification record ' +
      'including amount, currency, agent ID, and on-chain proof.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        intentId: {
          type: 'string',
          description: 'The payment intent ID',
        },
      },
      required: ['intentId'],
    },
  },
  {
    name: 'agentpay_parse_upi_payment_request',
    description:
      'Parse and normalize a UPI payment request against /api/payments/upi/parse. ' +
      'Use this when an agent has a raw upi://pay URI or scanned QR text and needs a canonical payee, ' +
      'amount, currency, and reference breakdown before asking for approval or handing off payment.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        upiUrl: {
          type: 'string',
          description: 'Raw upi://pay URI to parse and normalize',
        },
        qrText: {
          type: 'string',
          description: 'Decoded QR payload text that contains a UPI payment request',
        },
      },
      required: [],
    },
  },
  {
    name: 'agentpay_get_passport',
    description:
      'Look up an AgentPassport - the portable identity and trust record for any agent on the AgentPay network. ' +
      'Returns trust score, interaction count, success rate, and dispute history. ' +
      'Use this to verify an agent before hiring or transacting with it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to look up',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'agentpay_get_identity_bundle',
    description: identityToolDescriptions.get,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID whose portable identity bundle should be returned',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'agentpay_verify_identity_bundle',
    description: identityToolDescriptions.verify,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to verify',
        },
        claimedEnvironment: {
          type: 'object',
          description: 'The environment the agent claims to run in',
        },
        proofs: {
          type: 'array',
          description: 'Proof objects such as oauth, api_key, signature, or deployment',
        },
      },
      required: ['agentId', 'claimedEnvironment', 'proofs'],
    },
  },
  {
    name: 'agentpay_provision_identity_inbox',
    description: identityToolDescriptions.inboxProvision,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID that should own the inbox capability',
        },
        username: {
          type: 'string',
          description: 'Optional inbox username hint',
        },
        domain: {
          type: 'string',
          description: 'Optional inbox domain override when the provider supports custom domains',
        },
        displayName: {
          type: 'string',
          description: 'Optional human-friendly sender name for the inbox',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'agentpay_send_identity_inbox_message',
    description: identityToolDescriptions.inboxSend,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID sending from its provisioned inbox',
        },
        to: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
          description: 'Recipient email or array of recipient emails',
        },
        subject: {
          type: 'string',
          description: 'Email subject line',
        },
        text: {
          type: 'string',
          description: 'Plain text email body',
        },
        html: {
          type: 'string',
          description: 'Optional HTML email body',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional provider labels to attach to the message',
        },
      },
      required: ['agentId', 'to'],
    },
  },
  {
    name: 'agentpay_list_identity_inbox_messages',
    description: identityToolDescriptions.inboxList,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID whose provisioned inbox should be read',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of recent messages to return',
          default: 20,
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'agentpay_start_identity_phone_verification',
    description: identityToolDescriptions.phoneStart,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID initiating the phone verification flow',
        },
        phone: {
          type: 'string',
          description: 'Phone number to verify, preferably in E.164 format',
        },
        channel: {
          type: 'string',
          enum: ['sms', 'call'],
          description: 'Optional delivery channel for the verification challenge',
          default: 'sms',
        },
        principalId: {
          type: 'string',
          description: 'Optional principal who owns the phone verification flow',
        },
      },
      required: ['agentId', 'phone'],
    },
  },
  {
    name: 'agentpay_confirm_identity_phone_verification',
    description: identityToolDescriptions.phoneConfirm,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID completing the phone verification flow',
        },
        verificationId: {
          type: 'string',
          description: 'The verification challenge ID returned by the start step',
        },
        code: {
          type: 'string',
          description: 'Verification code or token received by the phone owner',
        },
        phone: {
          type: 'string',
          description: 'Optional phone number used for confirmation context',
        },
      },
      required: ['agentId', 'verificationId', 'code'],
    },
  },
  {
    name: 'agentpay_link_identity_bundles',
    description: identityToolDescriptions.link,
    inputSchema: {
      type: 'object' as const,
      properties: {
        primaryAgentId: {
          type: 'string',
          description: 'The primary agent ID that owns the linked identity graph',
        },
        linkedAgentIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'The other agent IDs to link to the primary agent',
        },
        proofs: {
          type: 'array',
          description: 'Cross-platform proofs supporting the link',
        },
      },
      required: ['primaryAgentId', 'linkedAgentIds', 'proofs'],
    },
  },
  {
    name: 'agentpay_verify_identity_credential',
    description: identityToolDescriptions.credential,
    inputSchema: {
      type: 'object' as const,
      properties: {
        credentialId: {
          type: 'string',
          description: 'The issued identity credential to verify',
        },
      },
      required: ['credentialId'],
    },
  },
  {
    name: 'agentpay_create_funding_setup_intent',
    description: fundingToolDescriptions.create,
    inputSchema: {
      type: 'object' as const,
      properties: {
        principalId: {
          type: 'string',
          description: 'The principal who will own the reusable Stripe funding method',
        },
        currency: {
          type: 'string',
          description: 'Optional ISO currency hint forwarded to the setup intent flow',
        },
      },
      required: ['principalId'],
    },
  },
  {
    name: 'agentpay_confirm_funding_setup',
    description: fundingToolDescriptions.confirm,
    inputSchema: {
      type: 'object' as const,
      properties: {
        principalId: {
          type: 'string',
          description: 'The principal who owns the funding setup flow',
        },
        setupIntentId: {
          type: 'string',
          description: 'The Stripe setup intent ID returned by agentpay_create_funding_setup_intent',
        },
        paymentMethodId: {
          type: 'string',
          description: 'The Stripe payment method ID returned after client-side setup succeeds',
        },
        setDefault: {
          type: 'boolean',
          description: 'Whether this payment method should become the default funding method',
          default: true,
        },
      },
      required: ['principalId', 'setupIntentId', 'paymentMethodId'],
    },
  },
  {
    name: 'agentpay_list_funding_methods',
    description: fundingToolDescriptions.list,
    inputSchema: {
      type: 'object' as const,
      properties: {
        principalId: {
          type: 'string',
          description: 'The principal whose saved funding methods should be returned',
        },
      },
      required: ['principalId'],
    },
  },
  {
    name: 'agentpay_create_human_funding_request',
    description: fundingToolDescriptions.request,
    inputSchema: {
      type: 'object' as const,
      properties: {
        rail: {
          type: 'string',
          enum: ['card', 'upi'],
          description: 'Funding rail requested by the agent. Card is the mainstream default; UPI is the regional fallback.',
          default: 'card',
        },
        amount: {
          type: 'number',
          description: 'Amount the human should fund in the requested currency.',
        },
        currency: {
          type: 'string',
          description: 'Three-letter ISO currency code such as GBP, USD, EUR, or INR.',
        },
        amountInr: {
          type: 'number',
          description: 'Deprecated INR-only alias kept for backward compatibility with older UPI callers.',
        },
        description: {
          type: 'string',
          description: 'Short funding reason shown to the human in-host.',
        },
        requestId: {
          type: 'string',
          description: 'Optional caller-supplied request/session identifier.',
        },
        customerName: {
          type: 'string',
          description: 'Optional human-friendly payer name hint.',
        },
        customerPhone: {
          type: 'string',
          description: 'Optional phone hint passed to the payment rail.',
        },
        customerEmail: {
          type: 'string',
          description: 'Optional email hint passed to the payment rail.',
        },
        resumeUrl: {
          type: 'string',
          description: 'Optional URL the payment rail should send the human back to after completion.',
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'agentpay_list_capability_providers',
    description: capabilityToolDescriptions.catalog,
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'agentpay_request_capability_connect',
    description: capabilityToolDescriptions.connect,
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', description: 'Provider identifier such as firecrawl, browserbase, or generic_rest_api' },
        capabilityKey: { type: 'string', description: 'Stable merchant-scoped key for the connected capability, such as firecrawl_primary' },
        subjectType: {
          type: 'string',
          enum: ['merchant', 'principal', 'agent', 'workspace'],
          description: 'What entity the capability belongs to',
          default: 'merchant',
        },
        subjectRef: { type: 'string', description: 'Identifier of the merchant, principal, agent, or workspace that owns the capability' },
        baseUrl: { type: 'string', description: 'Base URL the proxy may call after the capability is connected' },
        allowedHosts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Allow-listed hosts the proxy may call with this capability',
        },
        authScheme: {
          type: 'string',
          enum: ['bearer', 'x_api_key', 'basic'],
          description: 'How AgentPay should inject the vaulted credential into upstream requests',
          default: 'bearer',
        },
        credentialKind: {
          type: 'string',
          enum: ['api_key', 'bearer_token', 'basic_auth'],
          description: 'Credential form the human will connect',
          default: 'api_key',
        },
        headerName: { type: 'string', description: 'Optional custom header name when authScheme is x_api_key' },
        scopes: { type: 'array', items: { type: 'string' }, description: 'Optional declared scopes for the connected capability' },
        freeCalls: { type: 'number', description: 'Optional free-call quota before paid usage approval is required' },
        paidUnitPriceUsdMicros: { type: 'number', description: 'Optional paid price per call in USD micros once the free tier is exhausted' },
        resumeUrl: { type: 'string', description: 'Optional host URL to resume after the secure connect step completes.' },
      },
      required: ['provider', 'capabilityKey', 'subjectType', 'subjectRef'],
    },
  },
  {
    name: 'agentpay_list_capabilities',
    description: capabilityToolDescriptions.list,
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'agentpay_get_capability',
    description: capabilityToolDescriptions.get,
    inputSchema: {
      type: 'object' as const,
      properties: {
        capabilityId: { type: 'string', description: 'Capability reference returned after a successful connect session' },
      },
      required: ['capabilityId'],
    },
  },
  {
    name: 'agentpay_execute_capability',
    description: capabilityToolDescriptions.execute,
    inputSchema: {
      type: 'object' as const,
      properties: {
        capabilityId: { type: 'string', description: 'Capability reference returned after a successful connect session' },
        method: { type: 'string', description: 'HTTP method for the proxied external API call', default: 'GET' },
        path: { type: 'string', description: 'Path relative to the connected capability base URL', default: '/' },
        query: { type: 'object', description: 'Optional query-string object forwarded to the upstream API' },
        headers: { type: 'object', description: 'Optional non-auth headers forwarded to the upstream API' },
        body: { type: 'object', description: 'Optional JSON body forwarded upstream' },
        allowPaidUsage: {
          type: 'boolean',
          description: 'Set true only after the human has approved spending beyond the free-call allowance',
          default: false,
        },
      },
      required: ['capabilityId'],
    },
  },
  {
    name: 'agentpay_create_mandate',
    description: mandateToolDescriptions.create,
    inputSchema: {
      type: 'object' as const,
      properties: {
        principalId: {
          type: 'string',
          description: 'The human principal who owns the mandate and approval authority',
        },
        operatorId: {
          type: 'string',
          description: 'The agent or operator initiating the mandate',
        },
        objective: {
          type: 'string',
          description: 'Outcome-oriented description of the work to complete',
        },
        source: {
          type: 'string',
          enum: ['direct_human', 'delegated_agent'],
          description: 'Whether the mandate comes directly from a human or from a delegated agent',
          default: 'delegated_agent',
        },
        constraints: {
          type: 'object',
          description: 'Optional execution constraints such as budgetMax or service preferences',
        },
        mandate: {
          type: 'object',
          description: 'Optional mandate policy including amountPence, currency, autoApproveAmountPence, and approvalMethod',
        },
      },
      required: ['principalId', 'operatorId', 'objective'],
    },
  },
  {
    name: 'agentpay_get_mandate',
    description: mandateToolDescriptions.get,
    inputSchema: {
      type: 'object' as const,
      properties: {
        intentId: {
          type: 'string',
          description: 'The mandate ID returned by agentpay_create_mandate',
        },
      },
      required: ['intentId'],
    },
  },
  {
    name: 'agentpay_get_mandate_journey_status',
    description: mandateToolDescriptions.journey,
    inputSchema: {
      type: 'object' as const,
      properties: {
        intentId: {
          type: 'string',
          description: 'The mandate ID returned by agentpay_create_mandate',
        },
      },
      required: ['intentId'],
    },
  },
  {
    name: 'agentpay_get_mandate_history',
    description: mandateToolDescriptions.history,
    inputSchema: {
      type: 'object' as const,
      properties: {
        intentId: {
          type: 'string',
          description: 'The mandate ID returned by agentpay_create_mandate',
        },
      },
      required: ['intentId'],
    },
  },
  {
    name: 'agentpay_approve_mandate',
    description: mandateToolDescriptions.approve,
    inputSchema: {
      type: 'object' as const,
      properties: {
        intentId: {
          type: 'string',
          description: 'The mandate ID to approve',
        },
        actorId: {
          type: 'string',
          description: 'Operator or principal identifier recording who approved the mandate',
        },
        approvalToken: {
          type: 'string',
          description: 'Ephemeral approval token from the linked approval session',
        },
        deviceId: {
          type: 'string',
          description: 'Optional local device identifier used only for one-way approval hashing',
        },
      },
      required: ['intentId'],
    },
  },
  {
    name: 'agentpay_execute_mandate',
    description: mandateToolDescriptions.execute,
    inputSchema: {
      type: 'object' as const,
      properties: {
        intentId: {
          type: 'string',
          description: 'The mandate ID to execute',
        },
        jobId: {
          type: 'string',
          description: 'Optional downstream execution or queue job ID',
        },
        actorId: {
          type: 'string',
          description: 'Optional agent/operator identifier starting execution',
        },
      },
      required: ['intentId'],
    },
  },
  {
    name: 'agentpay_cancel_mandate',
    description: mandateToolDescriptions.cancel,
    inputSchema: {
      type: 'object' as const,
      properties: {
        intentId: {
          type: 'string',
          description: 'The mandate ID to cancel',
        },
        actorId: {
          type: 'string',
          description: 'Optional operator or principal identifier recording who cancelled the mandate',
        },
        reason: {
          type: 'string',
          description: 'Optional cancellation reason for the mandate audit trail',
        },
      },
      required: ['intentId'],
    },
  },
  {
    name: 'agentpay_discover_agents',
    description:
      'Discover agents on the AgentPay network. Search by capability, filter by minimum trust score, ' +
      'and sort by score, volume, or recency. Use this to find agents to hire for a task.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: {
          type: 'string',
          description: 'Free-text search query (e.g. "research", "data analysis")',
        },
        category: {
          type: 'string',
          description: 'Filter by capability category',
        },
        minScore: {
          type: 'number',
          description: 'Minimum AgentRank trust score (0-100)',
        },
        sortBy: {
          type: 'string',
          enum: ['best_match', 'score', 'volume', 'recent'],
          description: 'Sort order',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default 10, max 50)',
          default: 10,
        },
      },
      required: [],
    },
  },
  {
    name: 'agentpay_get_merchant_stats',
    description:
      'Get payment statistics for your merchant account - total transactions, confirmed count, ' +
      'pending count, and total USDC volume processed.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'agentpay_register_agent',
    description:
      'Register an AI agent on the AgentPay network. Returns an agentId and agentKey that identify ' +
      'the agent. No merchant account required - agents can self-register. ' +
      'The agentKey is shown once; store it securely. Trust score builds automatically after confirmed transactions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Human-readable agent name (e.g. "ResearchAgent v2")',
        },
        description: {
          type: 'string',
          description: 'What this agent does (max 500 chars)',
        },
        category: {
          type: 'string',
          description: 'Agent capability category (e.g. "research", "data", "code", "travel")',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of specific capabilities (e.g. ["web_search", "summarisation"])',
        },
      },
      required: [],
    },
  },
  {
    name: 'agentpay_get_agent',
    description:
      "Look up a registered agent's public identity record - name, category, capabilities, " +
      'and registration mode. Complements agentpay_get_passport which shows trust scores; ' +
      'this shows the raw identity registration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID to look up (e.g. agt_a1b2c3d4)',
        },
      },
      required: ['agentId'],
    },
  },
];

type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
};

function json(data: unknown): ToolResponse {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

async function finalizeToolResult(
  name: string,
  data: unknown,
  runtime?: AgentPayMcpRuntime,
): Promise<ToolResponse> {
  await runtime?.onToolResult?.({
    toolName: name,
    data,
  });
  return json(data);
}

async function handleMandateTool(
  name:
    | 'agentpay_create_mandate'
    | 'agentpay_get_mandate'
    | 'agentpay_get_mandate_journey_status'
    | 'agentpay_get_mandate_history'
    | 'agentpay_approve_mandate'
    | 'agentpay_execute_mandate'
    | 'agentpay_cancel_mandate',
  args: Record<string, unknown>,
  runtime?: AgentPayMcpRuntime,
): Promise<ToolResponse> {
  switch (name) {
    case 'agentpay_create_mandate': {
      const body: Record<string, unknown> = {
        principalId: args.principalId,
        operatorId: args.operatorId,
        objective: args.objective,
        source: args.source ?? 'delegated_agent',
      };
      if (args.constraints) body.constraints = args.constraints;
      if (args.mandate) body.mandate = args.mandate;

      const created = await apiFetch(MANDATE_BASE_PATH, {
        method: 'POST',
        body: JSON.stringify(body),
      }, runtime) as Record<string, unknown>;

      const intentId = created.intentId as string | undefined;
      if (!intentId) {
        return json(created);
      }

      const planned = await apiFetch(`${MANDATE_BASE_PATH}/${encodeURIComponent(intentId)}/plan`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, runtime);

      return json({ created, planned });
    }

    case 'agentpay_get_mandate': {
      const data = await apiFetch(`${MANDATE_BASE_PATH}/${encodeURIComponent(args.intentId as string)}`, {}, runtime);
      return json(data);
    }

    case 'agentpay_get_mandate_journey_status': {
      const data = await apiFetch(`${MANDATE_BASE_PATH}/journeys/${encodeURIComponent(args.intentId as string)}`, {}, runtime);
      return json(data);
    }

    case 'agentpay_get_mandate_history': {
      const data = await apiFetch(`${MANDATE_BASE_PATH}/${encodeURIComponent(args.intentId as string)}/history`, {}, runtime);
      return json(data);
    }

    case 'agentpay_approve_mandate': {
      const body: Record<string, unknown> = {};
      if (args.actorId) body.actorId = args.actorId;
      if (args.approvalToken) body.approvalToken = args.approvalToken;
      if (args.deviceId) body.deviceId = args.deviceId;
      const data = await apiFetch(`${MANDATE_BASE_PATH}/${encodeURIComponent(args.intentId as string)}/approve`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, runtime);
      return json(data);
    }

    case 'agentpay_execute_mandate': {
      const body: Record<string, unknown> = {};
      if (args.jobId) body.jobId = args.jobId;
      if (args.actorId) body.actorId = args.actorId;
      const data = await apiFetch(`${MANDATE_BASE_PATH}/${encodeURIComponent(args.intentId as string)}/execute`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, runtime);
      return json(data);
    }

    case 'agentpay_cancel_mandate': {
      const body: Record<string, unknown> = {};
      if (args.actorId) body.actorId = args.actorId;
      if (args.reason) body.reason = args.reason;
      const data = await apiFetch(`${MANDATE_BASE_PATH}/${encodeURIComponent(args.intentId as string)}/cancel`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, runtime);
      return json(data);
    }
  }

  throw new Error(`Unknown mandate tool: ${name}`);
}

export async function handleTool(
  name: string,
  args: Record<string, unknown>,
  runtime?: AgentPayMcpRuntime,
): Promise<ToolResponse> {
  const resolved = resolveRuntime(runtime);
  switch (name) {
    case 'agentpay_get_identity_bundle': {
      const data = await apiFetch(`${IDENTITY_BASE_PATH}`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'get_identity',
          agentId: args.agentId,
        }),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_verify_identity_bundle': {
      const body: Record<string, unknown> = {
        action: 'verify',
        agentId: args.agentId,
        claimedEnvironment: args.claimedEnvironment,
        proofs: args.proofs,
      };
      const data = await apiFetch(IDENTITY_BASE_PATH, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_provision_identity_inbox': {
      const body: Record<string, unknown> = {
        action: 'provision_inbox',
        agentId: args.agentId,
      };
      if (args.username) body.username = args.username;
      if (args.domain) body.domain = args.domain;
      if (args.displayName) body.displayName = args.displayName;
      const data = await apiFetch(IDENTITY_BASE_PATH, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_send_identity_inbox_message': {
      const body: Record<string, unknown> = {
        action: 'send_inbox_message',
        agentId: args.agentId,
        to: args.to,
      };
      if (args.subject) body.subject = args.subject;
      if (args.text) body.text = args.text;
      if (args.html) body.html = args.html;
      if (args.labels) body.labels = args.labels;
      const data = await apiFetch(IDENTITY_BASE_PATH, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_list_identity_inbox_messages': {
      const body: Record<string, unknown> = {
        action: 'list_inbox_messages',
        agentId: args.agentId,
      };
      if (typeof args.limit === 'number') body.limit = args.limit;
      const data = await apiFetch(IDENTITY_BASE_PATH, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_start_identity_phone_verification': {
      const body: Record<string, unknown> = {
        action: 'start_phone_verification',
        agentId: args.agentId,
        phone: args.phone,
        channel: args.channel ?? 'sms',
      };
      if (args.principalId) body.principalId = args.principalId;
      const data = await apiFetch(IDENTITY_BASE_PATH, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_confirm_identity_phone_verification': {
      const body: Record<string, unknown> = {
        action: 'confirm_phone_verification',
        agentId: args.agentId,
        challengeId: args.verificationId,
        code: args.code,
      };
      if (args.phone) body.phone = args.phone;
      const data = await apiFetch(IDENTITY_BASE_PATH, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_link_identity_bundles': {
      const body: Record<string, unknown> = {
        action: 'link',
        primaryAgentId: args.primaryAgentId,
        linkedAgentIds: args.linkedAgentIds,
        proofs: args.proofs,
      };
      const data = await apiFetch(IDENTITY_BASE_PATH, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_verify_identity_credential': {
      const data = await apiFetch(IDENTITY_BASE_PATH, {
        method: 'POST',
        body: JSON.stringify({
          action: 'verify_credential',
          credentialId: args.credentialId,
        }),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_create_funding_setup_intent': {
      const body: Record<string, unknown> = {
        principalId: args.principalId,
      };
      if (args.currency) body.currency = args.currency;
      const data = await apiFetch(`${PAYMENTS_BASE_PATH}/setup-intent`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_confirm_funding_setup': {
      const body: Record<string, unknown> = {
        principalId: args.principalId,
        setupIntentId: args.setupIntentId,
        paymentMethodId: args.paymentMethodId,
      };
      if (args.setDefault !== undefined) body.setDefault = args.setDefault;
      const data = await apiFetch(`${PAYMENTS_BASE_PATH}/confirm-setup`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_list_funding_methods': {
      const data = await apiFetch(`${PAYMENTS_BASE_PATH}/methods/${encodeURIComponent(args.principalId as string)}`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_create_human_funding_request': {
      const body: Record<string, unknown> = {
        rail: args.rail ?? (args.amountInr !== undefined ? 'upi' : 'card'),
        description: args.description,
      };
      if (args.amount !== undefined) body.amount = args.amount;
      if (args.currency) body.currency = args.currency;
      if (args.amountInr !== undefined) body.amountInr = args.amountInr;
      if (args.requestId) body.requestId = args.requestId;
      if (args.customerName) body.customerName = args.customerName;
      if (args.customerPhone) body.customerPhone = args.customerPhone;
      if (args.customerEmail) body.customerEmail = args.customerEmail;
      if (args.resumeUrl) body.resumeUrl = args.resumeUrl;
      const data = await apiFetch(`${PAYMENTS_BASE_PATH}/funding-request`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_list_capability_providers': {
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/providers/catalog`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_request_capability_connect': {
      const body: Record<string, unknown> = {
        provider: args.provider,
        capabilityKey: args.capabilityKey,
        subjectType: args.subjectType,
        subjectRef: args.subjectRef,
        baseUrl: args.baseUrl,
        allowedHosts: args.allowedHosts,
        authScheme: args.authScheme,
        credentialKind: args.credentialKind,
      };
      if (args.headerName) body.headerName = args.headerName;
      if (args.scopes) body.scopes = args.scopes;
      if (args.freeCalls !== undefined) body.freeCalls = args.freeCalls;
      if (args.paidUnitPriceUsdMicros !== undefined) body.paidUnitPriceUsdMicros = args.paidUnitPriceUsdMicros;
      if (args.resumeUrl) body.resumeUrl = args.resumeUrl;
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/connect-sessions`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_list_capabilities': {
      const data = await apiFetch(CAPABILITIES_BASE_PATH, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_get_capability': {
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/${encodeURIComponent(args.capabilityId as string)}`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_execute_capability': {
      const body: Record<string, unknown> = {
        method: args.method,
        path: args.path,
        query: args.query,
        headers: args.headers,
        body: args.body,
        allowPaidUsage: args.allowPaidUsage ?? false,
      };
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/${encodeURIComponent(args.capabilityId as string)}/execute`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_create_payment_intent': {
      const body: Record<string, unknown> = {
        amount: args.amount,
        currency: args.currency ?? 'USDC',
        ...(args.agentId ? { agentId: args.agentId } : {}),
        ...(args.purpose ? { purpose: args.purpose } : {}),
        ...(resolved.merchantId ? { merchantId: resolved.merchantId } : {}),
      };
      const data = await apiFetch('/api/v1/payment-intents', {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_get_intent_status': {
      const data = await apiFetch(`/api/v1/payment-intents/${encodeURIComponent(args.intentId as string)}`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_get_receipt': {
      const data = await apiFetch(`/api/receipt/${encodeURIComponent(args.intentId as string)}`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_parse_upi_payment_request': {
      const body: Record<string, unknown> = {};
      if (args.upiUrl) body.upiUrl = args.upiUrl;
      if (args.qrText) body.qrText = args.qrText;
      const data = await apiFetch('/api/payments/upi/parse', {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_get_passport': {
      const data = await apiFetch(`/api/passport/${encodeURIComponent(args.agentId as string)}`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_create_mandate':
    case 'agentpay_get_mandate':
    case 'agentpay_get_mandate_journey_status':
    case 'agentpay_get_mandate_history':
    case 'agentpay_approve_mandate':
    case 'agentpay_execute_mandate':
    case 'agentpay_cancel_mandate':
      return handleMandateTool(name, args, resolved);

    case 'agentpay_discover_agents': {
      const qs = new URLSearchParams();
      if (args.q) qs.set('q', args.q as string);
      if (args.category) qs.set('category', args.category as string);
      if (args.minScore !== undefined) qs.set('minScore', String(args.minScore));
      if (args.sortBy) qs.set('sortBy', args.sortBy as string);
      qs.set('limit', String(Math.min((args.limit as number | undefined) ?? 10, 50)));
      const data = await apiFetch(`/api/marketplace/discover?${qs}`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_get_merchant_stats': {
      const data = await apiFetch('/api/merchants/stats', {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_register_agent': {
      const body: Record<string, unknown> = {};
      if (args.name) body.name = args.name;
      if (args.description) body.description = args.description;
      if (args.category) body.category = args.category;
      if (args.capabilities) body.capabilities = args.capabilities;
      const data = await apiFetch('/api/v1/agents/register', {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_get_agent': {
      const data = await apiFetch(`/api/v1/agents/${encodeURIComponent(args.agentId as string)}`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createAgentPayMcpServer(runtime?: AgentPayMcpRuntime): Server {
  const server = new Server(
    { name: 'agentpay', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      return await handleTool(name, args as Record<string, unknown>, runtime);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

const isMainModule = typeof require !== 'undefined'
  && typeof module !== 'undefined'
  && require.main === module;

if (isMainModule) {
  void (async () => {
    const server = createAgentPayMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('AgentPay MCP server running on stdio\n');
  })();
}
