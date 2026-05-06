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
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { ACE_TOOLS, handleAceTool } from './ace-tools.js';

const DEFAULT_API_URL = process.env.AGENTPAY_API_URL ?? 'https://api.agentpay.so';
const DEFAULT_API_KEY = process.env.AGENTPAY_API_KEY ?? '';
const DEFAULT_MERCHANT_ID = process.env.AGENTPAY_MERCHANT_ID ?? '';
const MANDATE_BASE_PATH = '/api/mandates';
const IDENTITY_BASE_PATH = '/api/foundation-agents/identity';
const PAYMENTS_BASE_PATH = '/api/payments';
const CAPABILITIES_BASE_PATH = '/api/capabilities';
const ACTIONS_BASE_PATH = '/api/actions';

if (!DEFAULT_API_KEY) {
  process.stderr.write('Warning: AGENTPAY_API_KEY is not set. Authenticated operations will fail.\n');
}

// ── Setup micro-agent: known env var → provider mapping ───────────────────
// The agent scans process.env for these patterns. The developer never has to
// copy keys into dashboards — one OTP confirms the entire vault setup.

const KNOWN_ENV_PROVIDERS = [
  { envVar: 'FIRECRAWL_API_KEY',     provider: 'firecrawl',     label: 'Firecrawl',     baseUrl: 'https://api.firecrawl.dev',          authScheme: 'bearer'    as const, credentialKind: 'api_key' as const },
  { envVar: 'BROWSERBASE_API_KEY',   provider: 'browserbase',   label: 'Browserbase',   baseUrl: 'https://www.browserbase.com',         authScheme: 'x_api_key' as const, credentialKind: 'api_key' as const },
  { envVar: 'PERPLEXITY_API_KEY',    provider: 'perplexity',    label: 'Perplexity',    baseUrl: 'https://api.perplexity.ai',           authScheme: 'bearer'    as const, credentialKind: 'api_key' as const },
  { envVar: 'TAVILY_API_KEY',        provider: 'tavily',        label: 'Tavily',        baseUrl: 'https://api.tavily.com',              authScheme: 'bearer'    as const, credentialKind: 'api_key' as const },
  { envVar: 'EXA_API_KEY',           provider: 'exa',           label: 'Exa',           baseUrl: 'https://api.exa.ai',                  authScheme: 'bearer'    as const, credentialKind: 'api_key' as const },
  { envVar: 'SERPER_API_KEY',        provider: 'serper',        label: 'Serper',        baseUrl: 'https://google.serper.dev',           authScheme: 'x_api_key' as const, credentialKind: 'api_key' as const },
  { envVar: 'OPENAI_API_KEY',        provider: 'openai',        label: 'OpenAI',        baseUrl: 'https://api.openai.com',              authScheme: 'bearer'    as const, credentialKind: 'api_key' as const },
  { envVar: 'GOOGLE_MAPS_API_KEY',   provider: 'google_maps',   label: 'Google Maps',   baseUrl: 'https://maps.googleapis.com',         authScheme: 'x_api_key' as const, credentialKind: 'api_key' as const },
  { envVar: 'AVIATIONSTACK_API_KEY', provider: 'aviationstack', label: 'Aviationstack', baseUrl: 'https://api.aviationstack.com',        authScheme: 'x_api_key' as const, credentialKind: 'api_key' as const },
  { envVar: 'TICKETMASTER_API_KEY',  provider: 'ticketmaster',  label: 'Ticketmaster',  baseUrl: 'https://app.ticketmaster.com',         authScheme: 'x_api_key' as const, credentialKind: 'api_key' as const },
] as const;

const SECRET_LEAK_PATTERNS = [
  {
    provider: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    authScheme: 'bearer' as const,
    credentialKind: 'api_key' as const,
    severity: 'critical' as const,
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/g,
    rotation: 'Create a replacement OpenAI project key, lower budget if high-limit, update AgentPay vaulting, then revoke the exposed key in OpenAI project settings.',
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    authScheme: 'x_api_key' as const,
    credentialKind: 'api_key' as const,
    headerName: 'x-api-key',
    severity: 'critical' as const,
    pattern: /\bsk-ant-(?:api\d{2}|sid\d{2})-[A-Za-z0-9_-]{24,}\b/g,
    rotation: 'Revoke the exposed Anthropic workspace token, vault a replacement, and scrub the context with [AGENTPAY_VAULTED_SECRET].',
  },
  {
    provider: 'stripe',
    label: 'Stripe',
    baseUrl: 'https://api.stripe.com',
    authScheme: 'bearer' as const,
    credentialKind: 'api_key' as const,
    severity: 'critical' as const,
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    rotation: 'Restricted or test keys can be replaced through a configured Stripe rotation adapter. Live master keys must be revoked manually and the agent session should be killed.',
  },
  {
    provider: 'aws',
    label: 'AWS',
    baseUrl: 'https://sts.amazonaws.com',
    authScheme: 'x_api_key' as const,
    credentialKind: 'api_key' as const,
    headerName: 'x-api-key',
    severity: 'critical' as const,
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    rotation: 'Deactivate and delete exposed long-term AWS access keys before replacement because IAM users can only hold two active access keys.',
  },
  {
    provider: 'google',
    label: 'Google API',
    baseUrl: 'https://www.googleapis.com',
    authScheme: 'x_api_key' as const,
    credentialKind: 'api_key' as const,
    severity: 'high' as const,
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    rotation: 'Restrict or rotate the exposed Google API key in Google Cloud Console, then vault the replacement in AgentPay.',
  },
] as const;

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
  const boundFetch = (input: unknown, init?: RequestInit) =>
    globalThis.fetch(input as Parameters<typeof fetch>[0], init);
  return {
    apiUrl: runtime?.apiUrl ?? DEFAULT_API_URL,
    apiKey: runtime?.apiKey ?? DEFAULT_API_KEY,
    merchantId: runtime?.merchantId ?? DEFAULT_MERCHANT_ID,
    // Cloudflare Workers can throw "Illegal invocation" if the ambient
    // fetch function is passed around unbound and later called with the wrong
    // `this` reference. Always wrap it before storing on runtime state.
    fetchImpl: runtime?.fetchImpl ?? boundFetch,
  };
}

function asAceRuntime(resolved: ReturnType<typeof resolveRuntime>) {
  return {
    apiUrl: resolved.apiUrl,
    apiKey: resolved.apiKey,
    fetchImpl: resolved.fetchImpl,
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
    'Fetch the latest journey/execution session for a mandate from /api/mandates/journeys/:intentId. If no journey session exists yet, treat that as expected until downstream dispatch has started.',
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
  leakGuard:
    'Scan pasted text or agent output for leaked API keys. Returns only redacted/fingerprinted findings, provider-specific rotation policy, scrubbed context, and can optionally start AgentPay Leak Guard vaulting through /api/capabilities/leak-guard/events. Never echoes raw secrets back to the agent.',
  buyApi:
    'Buy or reuse governed API access for an agent need through /api/capabilities/access-resolve. Use this when an agent knows the capability it needs, not necessarily the provider. AgentPay picks a provider, starts secure setup if needed, can issue an opaque workbench lease, and can optionally run the initial call without exposing secrets.',
  authorityRead:
    'Read terminal-native authority bootstrap state through /api/capabilities/authority-bootstrap: guardrails, funding readiness, provider access, and workbench continuity.',
  authorityUpdate:
    'Set terminal-native authority defaults through /api/capabilities/authority-bootstrap: contact, phone notification hint, funding rail, auto-approve threshold, OTP policy, and spend limits.',
  controlPlane:
    'Read the AgentPay terminal control-plane snapshot through /api/capabilities/terminal/control-plane for the current principal and workbench.',
  leaseExecute:
    'Execute an API call through /api/capabilities/lease-execute using an opaque workbench lease token. The agent never receives the raw provider secret.',
  leaseList:
    'List active, expired, or revoked workbench leases through /api/capabilities/leases so terminal hosts can show reusable access without a dashboard.',
  leaseRevoke:
    'Revoke a workbench lease through /api/capabilities/leases/:leaseId/revoke without touching the vaulted provider credential.',
  resume:
    'Inspect an agent-resumable human step through /api/capabilities/execution-attempts/:attemptId or /api/actions/:sessionId. Use this after a human finishes auth, funding, OTP, or approval.',
  catalog:
    'List the external capability provider catalog from /api/capabilities/providers/catalog. Use this to inspect which providers AgentPay can connect, their free-call allowance, and their paid usage rate.',
  connect:
    'Request a secure external capability connect session through /api/capabilities/connect-sessions. Use this when a human must attach an API key or external credential without ever handing the raw secret to the agent.',
  list:
    'List connected external capabilities through /api/capabilities. Use this to inspect what external APIs are already connected and what their free-tier and paid-usage policy is.',
  get:
    'Fetch one connected external capability through /api/capabilities/:capabilityId.',
  connectStatus:
    'Fetch the current secure capability connect session through /api/capabilities/connect-sessions/:sessionId. Use this to see whether the human finished the connect step and which hosted action session or capability it produced.',
  execute:
    'Execute an external API call through the governed capability proxy at /api/capabilities/:capabilityId/execute. AgentPay injects the vaulted credential, enforces allow-listed hosts, tracks free usage, and gates paid usage.',
} as const;

const actionToolDescriptions = {
  get:
    'Fetch the current hosted action session through /api/actions/:sessionId. Use this to poll whether a human-step funding, auth, approval, or verification action is still pending, completed, failed, or expired.',
} as const;

const arbitraryObjectSchema = (description: string) => ({
  type: 'object' as const,
  additionalProperties: true,
  description,
});

const arbitraryObjectArraySchema = (description: string) => ({
  type: 'array' as const,
  items: {
    type: 'object' as const,
    additionalProperties: true,
  },
  description,
});

export const READ_ONLY_TOOL_NAMES = new Set([
  'agentpay_get_intent_status',
  'agentpay_get_receipt',
  'agentpay_parse_upi_payment_request',
  'agentpay_get_passport',
  'agentpay_get_identity_bundle',
  'agentpay_list_identity_inbox_messages',
  'agentpay_verify_identity_credential',
  'agentpay_list_funding_methods',
  'agentpay_read_authority_bootstrap',
  'agentpay_get_terminal_control_plane',
  'agentpay_list_workbench_leases',
  'agentpay_execute_with_resume_token',
  'agentpay_scan_for_leaked_secrets',
  'agentpay_list_capability_providers',
  'agentpay_list_capabilities',
  'agentpay_get_capability',
  'agentpay_get_capability_connect_session',
  'agentpay_get_action_session',
  'agentpay_get_mandate',
  'agentpay_get_mandate_journey_status',
  'agentpay_get_mandate_history',
  'agentpay_discover_agents',
  'agentpay_get_merchant_stats',
  'agentpay_get_agent',
  'ace_whoami',
  'ace_get_trip_status',
]);

const RAW_TOOLS: Tool[] = [
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
          ...arbitraryObjectSchema('The environment the agent claims to run in'),
        },
        proofs: {
          ...arbitraryObjectArraySchema('Proof objects such as oauth, api_key, signature, or deployment'),
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
          type: 'array',
          items: { type: 'string' },
          description: 'Recipient email addresses. Pass one or more recipients as an array of strings.',
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
          ...arbitraryObjectArraySchema('Cross-platform proofs supporting the link'),
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
    name: 'agentpay_scan_for_leaked_secrets',
    description: capabilityToolDescriptions.leakGuard,
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'Text, chat transcript, terminal output, or tool output to scan for leaked secrets.',
        },
        source: {
          type: 'string',
          description: 'Optional source label such as claude_chat, codex_terminal, logs, pull_request, or user_paste.',
        },
        autoVault: {
          type: 'boolean',
          description: 'If true, start the AgentPay Leak Guard vault flow for detected keys that policy allows. Raw keys are sent only to AgentPay and never returned in the tool result.',
          default: false,
        },
        mode: {
          type: 'string',
          enum: ['scan', 'vault', 'auto_heal'],
          description: 'scan returns local policy only. vault or auto_heal calls AgentPay /api/capabilities/leak-guard/events for server-side scrub/vault/resume handling.',
          default: 'scan',
        },
        subjectType: {
          type: 'string',
          enum: ['merchant', 'principal', 'agent', 'workspace'],
          description: 'Optional owner type for follow-up vaulting.',
          default: 'workspace',
        },
        subjectRef: {
          type: 'string',
          description: 'Optional owner reference for follow-up vaulting.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'agentpay_buy_api',
    description: capabilityToolDescriptions.buyApi,
    inputSchema: {
      type: 'object' as const,
      properties: {
        capability: {
          type: 'string',
          description: 'Capability need such as web_scraping_high_stealth, web_scraping, market_data, search, maps, events, or generic_api.',
        },
        provider: {
          type: 'string',
          description: 'Optional explicit provider such as firecrawl, browserbase, exa, databento, or generic_rest_api. If omitted, AgentPay chooses from capability and priority.',
        },
        requestedProviderName: {
          type: 'string',
          description: 'Human-readable provider/API name when no preset provider exists yet.',
        },
        priority: {
          type: 'string',
          enum: ['latency', 'cost', 'quality', 'reliability'],
          description: 'Optimization hint AgentPay can use to pick a provider.',
        },
        maxBudgetUsd: {
          type: 'number',
          description: 'Maximum budget the agent is allowed to request for this API need.',
        },
        subjectType: {
          type: 'string',
          enum: ['merchant', 'principal', 'agent', 'workspace'],
          description: 'Entity that should own the governed capability.',
          default: 'workspace',
        },
        subjectRef: {
          type: 'string',
          description: 'Stable ID of the workspace, agent, principal, or merchant that owns this access.',
        },
        principalId: {
          type: 'string',
          description: 'Human principal who owns funding and authority policy.',
        },
        operatorId: {
          type: 'string',
          description: 'Agent or operator requesting access.',
        },
        workbenchId: {
          type: 'string',
          description: 'Local host/workbench ID for opaque lease reuse.',
        },
        workbenchLabel: {
          type: 'string',
          description: 'Human-readable workbench label shown in terminal control surfaces.',
        },
        issueWorkbenchLease: {
          type: 'boolean',
          description: 'Issue an opaque lease for same-workbench reuse when governed access already exists.',
          default: true,
        },
        notificationChannel: {
          type: 'string',
          enum: ['terminal', 'phone', 'both'],
          description: 'Preferred human-in-the-loop surface. Phone is a hint for mobile/push hooks; terminal remains the fallback.',
          default: 'terminal',
        },
        customerPhone: {
          type: 'string',
          description: 'Phone hint for OTP, approval, funding, or future mobile push notification.',
        },
        customerEmail: {
          type: 'string',
          description: 'Email hint for hosted setup, OTP, or receipts.',
        },
        requestedBaseUrl: {
          type: 'string',
          description: 'Required for unknown/generic providers: API base URL AgentPay may proxy.',
        },
        allowedHosts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required for unknown/generic providers: upstream hosts AgentPay may call.',
        },
        authScheme: {
          type: 'string',
          enum: ['bearer', 'x_api_key', 'basic'],
          description: 'Auth injection scheme for unknown/generic providers.',
        },
        credentialKind: {
          type: 'string',
          enum: ['api_key', 'bearer_token', 'basic_auth'],
          description: 'Credential kind for unknown/generic providers.',
        },
        initialCall: {
          type: 'object' as const,
          additionalProperties: true,
          description: 'Optional first API call to run after access is ready. Includes method, path, query, headers, body, idempotencyKey, and allowPaidUsage.',
        },
      },
      required: ['capability', 'subjectRef'],
    },
  },
  {
    name: 'agentpay_read_authority_bootstrap',
    description: capabilityToolDescriptions.authorityRead,
    inputSchema: {
      type: 'object' as const,
      properties: {
        principalId: { type: 'string', description: 'Human principal whose authority state should be read.' },
        subjectType: { type: 'string', enum: ['merchant', 'principal', 'agent', 'workspace'], description: 'Optional scoped subject type.' },
        subjectRef: { type: 'string', description: 'Optional scoped subject reference.' },
        workbenchId: { type: 'string', description: 'Optional workbench ID for continuity state.' },
      },
      required: ['principalId'],
    },
  },
  {
    name: 'agentpay_update_authority_bootstrap',
    description: capabilityToolDescriptions.authorityUpdate,
    inputSchema: {
      type: 'object' as const,
      properties: {
        principalId: { type: 'string', description: 'Human principal who owns funding and spend authority.' },
        operatorId: { type: 'string', description: 'Agent or operator setting the authority defaults.' },
        workbenchId: { type: 'string', description: 'Workbench ID these defaults are being set from.' },
        contactEmail: { type: 'string', description: 'Email for OTP, receipts, recovery, or auth links.' },
        contactName: { type: 'string', description: 'Human-readable principal name.' },
        customerPhone: { type: 'string', description: 'Phone hint for OTP or future push notification hooks.' },
        preferredFundingRail: { type: 'string', description: 'Preferred funding rail, such as card, link, upi, or wallet.' },
        notificationChannel: { type: 'string', enum: ['terminal', 'phone', 'both'], description: 'Preferred HITL channel; terminal remains fallback.' },
        autoApproveUsd: { type: 'number', description: 'Auto-approve paid actions below this USD amount.' },
        perActionUsd: { type: 'number', description: 'Per-action spend limit in USD.' },
        dailyUsd: { type: 'number', description: 'Daily spend limit in USD.' },
        monthlyUsd: { type: 'number', description: 'Monthly spend limit in USD.' },
        otpEveryPaidAction: { type: 'boolean', description: 'Require OTP for every paid action.' },
      },
      required: ['principalId'],
    },
  },
  {
    name: 'agentpay_get_terminal_control_plane',
    description: capabilityToolDescriptions.controlPlane,
    inputSchema: {
      type: 'object' as const,
      properties: {
        principalId: { type: 'string', description: 'Optional principal ID to include authority and lease state.' },
        workbenchId: { type: 'string', description: 'Optional workbench ID for local continuity state.' },
      },
      required: [],
    },
  },
  {
    name: 'agentpay_execute_with_workbench_lease',
    description: capabilityToolDescriptions.leaseExecute,
    inputSchema: {
      type: 'object' as const,
      properties: {
        leaseToken: { type: 'string', description: 'Opaque lease token returned by agentpay_buy_api or access-resolve.' },
        workbenchId: { type: 'string', description: 'Workbench ID bound to the lease.' },
        method: { type: 'string', description: 'HTTP method for the proxied external API call.', default: 'GET' },
        path: { type: 'string', description: 'Path relative to the connected capability base URL.', default: '/' },
        query: { ...arbitraryObjectSchema('Optional query-string object forwarded upstream.') },
        headers: { ...arbitraryObjectSchema('Optional non-auth headers forwarded upstream.') },
        body: { ...arbitraryObjectSchema('Optional JSON body forwarded upstream.') },
        allowPaidUsage: { type: 'boolean', description: 'Set true only after human approval or policy allows paid usage.', default: false },
        principalId: { type: 'string', description: 'Principal used for authority and funding checks.' },
        operatorId: { type: 'string', description: 'Agent/operator initiating execution.' },
        customerPhone: { type: 'string', description: 'Phone hint for OTP or mobile hooks.' },
        customerEmail: { type: 'string', description: 'Email hint for OTP or receipts.' },
        idempotencyKey: { type: 'string', description: 'Stable key so repeated calls reuse the same blocked execution attempt.' },
      },
      required: ['leaseToken', 'workbenchId'],
    },
  },
  {
    name: 'agentpay_list_workbench_leases',
    description: capabilityToolDescriptions.leaseList,
    inputSchema: {
      type: 'object' as const,
      properties: {
        principalId: { type: 'string', description: 'Optional principal owner filter.' },
        workbenchId: { type: 'string', description: 'Optional workbench filter.' },
        status: { type: 'string', enum: ['active', 'revoked', 'expired'], description: 'Optional lease status filter.' },
      },
      required: [],
    },
  },
  {
    name: 'agentpay_revoke_workbench_lease',
    description: capabilityToolDescriptions.leaseRevoke,
    inputSchema: {
      type: 'object' as const,
      properties: {
        leaseId: { type: 'string', description: 'Lease ID to revoke.' },
        reason: { type: 'string', description: 'Audit reason such as lost_device, rotated_access, or operator_removed.' },
      },
      required: ['leaseId'],
    },
  },
  {
    name: 'agentpay_execute_with_resume_token',
    description: capabilityToolDescriptions.resume,
    inputSchema: {
      type: 'object' as const,
      properties: {
        resumeToken: {
          type: 'string',
          description: 'Token returned in nextAction.agentResume.resumeToken. capresume_* checks exact-call execution; apsetup_* checks hosted setup/action state.',
        },
      },
      required: ['resumeToken'],
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
    name: 'agentpay_get_capability_connect_session',
    description: capabilityToolDescriptions.connectStatus,
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string', description: 'Capability connect session ID returned by agentpay_request_capability_connect' },
      },
      required: ['sessionId'],
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
        query: { ...arbitraryObjectSchema('Optional query-string object forwarded to the upstream API') },
        headers: { ...arbitraryObjectSchema('Optional non-auth headers forwarded to the upstream API') },
        body: { ...arbitraryObjectSchema('Optional JSON body forwarded upstream') },
        allowPaidUsage: {
          type: 'boolean',
          description: 'Set true only after the human has approved spending beyond the free-call allowance',
          default: false,
        },
        principalId: { type: 'string', description: 'Principal used for authority and funding checks when paid usage requires a human step.' },
        operatorId: { type: 'string', description: 'Agent/operator initiating execution.' },
        customerPhone: { type: 'string', description: 'Phone hint for OTP or mobile hooks.' },
        customerEmail: { type: 'string', description: 'Email hint for OTP or receipts.' },
        requestId: { type: 'string', description: 'Host request ID for tracing.' },
        idempotencyKey: { type: 'string', description: 'Stable key so repeated calls reuse the same blocked execution attempt.' },
      },
      required: ['capabilityId'],
    },
  },
  {
    name: 'agentpay_get_action_session',
    description: actionToolDescriptions.get,
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string', description: 'Hosted action session ID returned inside nextAction.actionSession or actionSession' },
      },
      required: ['sessionId'],
    },
  },

  // ── Setup micro-agent ──────────────────────────────────────────────────────
  {
    name: 'agentpay_setup_scan',
    description:
      'Scan the MCP server\'s local environment for known API keys that can be vaulted with AgentPay. ' +
      'Returns detected providers (found in process.env) and undetected ones (missing). ' +
      'No keys are transmitted — this is read-only. ' +
      'Call this first, then agentpay_vault_env_keys with the providers the developer wants to vault. ' +
      'After a single 6-digit OTP confirmation, those keys are stored encrypted and usable by agents ' +
      'via agentpay_execute_capability — the developer never manages them again.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'agentpay_vault_env_keys',
    description:
      'Vault API keys detected in the local environment into AgentPay\'s encrypted capability vault. ' +
      'Keys are encrypted in transit and at rest (AES-256-GCM). Agents call them through the proxy ' +
      'and never see raw values. ' +
      'Sends a 6-digit OTP to the developer\'s registered email. ' +
      'Complete with agentpay_confirm_vault. ' +
      'After confirmation, agents can call agentpay_execute_capability with the returned capabilityIds — ' +
      'no more API key management, no more dashboard logins.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        providers: {
          type: 'array' as const,
          items: { type: 'string' },
          description: 'Provider names from agentpay_setup_scan detected list, e.g. ["firecrawl", "perplexity", "exa"]',
        },
      },
      required: ['providers'],
    },
  },
  {
    name: 'agentpay_confirm_vault',
    description:
      'Confirm vault setup with the 6-digit OTP sent to the registered email. ' +
      'On success, each key is committed to the encrypted vault and a capabilityId is returned. ' +
      'Agents can immediately call agentpay_execute_capability with those IDs — zero further setup required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'The vault session ID from agentpay_vault_env_keys.' },
        otp: { type: 'string', description: 'The 6-digit confirmation code from the developer\'s email.' },
      },
      required: ['session_id', 'otp'],
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
          ...arbitraryObjectSchema('Optional execution constraints such as budgetMax or service preferences'),
        },
        mandate: {
          ...arbitraryObjectSchema('Optional mandate policy including amountPence, currency, autoApproveAmountPence, and approvalMethod'),
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

const BASE_TOOLS: Tool[] = RAW_TOOLS.map((tool) => (
  READ_ONLY_TOOL_NAMES.has(tool.name)
    ? ({ ...tool, annotations: { readOnlyHint: true } } as Tool)
    : tool
));

export const TOOLS: Tool[] = [...BASE_TOOLS, ...ACE_TOOLS];

export const SAFE_TOOLS: Tool[] = TOOLS.filter((tool) => READ_ONLY_TOOL_NAMES.has(tool.name));

type ToolResponse = CallToolResult;

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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function shortFingerprint(secret: string): Promise<string> {
  const encoded = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function redactSecret(secret: string): string {
  if (secret.length <= 12) return '[redacted]';
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

async function scanForLeakedSecrets(text: string) {
  const findings: Array<{
    provider: string;
    label: string;
    severity: 'critical' | 'high';
    keyClass: string;
    redacted: string;
    fingerprint: string;
    index: number;
    recommendedAction: 'kill_agent_session' | 'rotate_and_vault' | 'vault_and_manual_rotate';
    autoVaultAllowed: boolean;
    autoRotateAllowed: boolean;
    reason: string;
    rotation: string;
  }> = [];
  const vaultable: Array<{
    provider: string;
    label: string;
    baseUrl: string;
    authScheme: string;
    credentialKind: string;
    headerName?: string;
    keyValue: string;
  }> = [];
  const seen = new Set<string>();

  for (const detector of SECRET_LEAK_PATTERNS) {
    detector.pattern.lastIndex = 0;
    for (const match of text.matchAll(detector.pattern)) {
      const keyValue = match[0];
      const fingerprint = await shortFingerprint(keyValue);
      const dedupeKey = `${detector.provider}:${fingerprint}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const policy = classifySecretLeak(detector.provider, keyValue);
      findings.push({
        provider: detector.provider,
        label: detector.label,
        severity: policy.severity,
        keyClass: policy.keyClass,
        redacted: redactSecret(keyValue),
        fingerprint,
        index: match.index ?? -1,
        recommendedAction: policy.recommendedAction,
        autoVaultAllowed: policy.autoVaultAllowed,
        autoRotateAllowed: policy.autoRotateAllowed,
        reason: policy.reason,
        rotation: detector.rotation,
      });
      if (policy.autoVaultAllowed) {
        vaultable.push({
          provider: detector.provider,
          label: detector.label,
          baseUrl: detector.baseUrl,
          authScheme: detector.authScheme,
          credentialKind: detector.credentialKind,
          ...('headerName' in detector && detector.headerName ? { headerName: detector.headerName } : {}),
          keyValue,
        });
      }
    }
  }

  return { findings, vaultable };
}

function classifySecretLeak(provider: string, keyValue: string): {
  severity: 'critical' | 'high';
  keyClass: string;
  recommendedAction: 'kill_agent_session' | 'rotate_and_vault' | 'vault_and_manual_rotate';
  autoVaultAllowed: boolean;
  autoRotateAllowed: boolean;
  reason: string;
} {
  if (provider === 'stripe') {
    if (keyValue.startsWith('sk_live_')) {
      return {
        severity: 'critical',
        keyClass: 'stripe_live_master_key',
        recommendedAction: 'kill_agent_session',
        autoVaultAllowed: false,
        autoRotateAllowed: false,
        reason: 'Stripe live master keys are too privileged for automatic handling. Kill the agent session and rotate manually in Stripe.',
      };
    }
    if (keyValue.startsWith('rk_live_')) {
      return {
        severity: 'critical',
        keyClass: 'stripe_live_restricted_key',
        recommendedAction: 'rotate_and_vault',
        autoVaultAllowed: true,
        autoRotateAllowed: true,
        reason: 'Restricted live keys are eligible for adapter-driven replacement when Stripe rotation credentials are configured.',
      };
    }
    return {
      severity: 'high',
      keyClass: 'stripe_test_key',
      recommendedAction: 'rotate_and_vault',
      autoVaultAllowed: true,
      autoRotateAllowed: true,
      reason: 'Stripe test keys can be replaced safely in configured non-production contexts.',
    };
  }

  if (provider === 'aws' && keyValue.startsWith('ASIA')) {
    return {
      severity: 'high',
      keyClass: 'aws_temporary_access_key',
      recommendedAction: 'vault_and_manual_rotate',
      autoVaultAllowed: false,
      autoRotateAllowed: false,
      reason: 'Temporary AWS credentials should expire or be revoked by the issuing session instead of being vaulted as long-term authority.',
    };
  }

  return {
    severity: provider === 'google' ? 'high' : 'critical',
    keyClass: `${provider}_api_key`,
    recommendedAction: 'rotate_and_vault',
    autoVaultAllowed: true,
    autoRotateAllowed: false,
    reason: 'AgentPay can vault replacement access and guide rotation now; provider-side automatic rotation requires a configured admin adapter.',
  };
}

function inferProviderForCapability(capability: unknown, priority: unknown): string | null {
  const value = typeof capability === 'string' ? capability.toLowerCase().trim() : '';
  const preference = typeof priority === 'string' ? priority.toLowerCase().trim() : '';
  if (!value) return null;

  if (['web_scraping_high_stealth', 'browser_automation', 'stealth_browser'].includes(value)) {
    return 'browserbase';
  }
  if (['web_scraping', 'crawl', 'crawler', 'page_extract', 'website_to_markdown'].includes(value)) {
    return preference === 'latency' ? 'firecrawl' : 'firecrawl';
  }
  if (['market_data', 'financial_data', 'quant_data', 'ticks', 'historical_market_data'].includes(value)) {
    return 'databento';
  }
  if (['search', 'web_search', 'research_search', 'content_retrieval'].includes(value)) {
    return preference === 'cost' ? 'tavily' : 'exa';
  }
  if (['ai_search', 'answer_engine', 'citation_search'].includes(value)) {
    return 'perplexity';
  }
  if (['maps', 'geocoding', 'places', 'routing'].includes(value)) {
    return 'google_maps';
  }
  if (['events', 'ticketing', 'event_discovery'].includes(value)) {
    return 'ticketmaster';
  }
  if (['generic_api', 'rest_api', 'paid_api'].includes(value)) {
    return 'generic_rest_api';
  }

  return null;
}

function withAgentResume(data: unknown): unknown {
  const record = asRecord(data);
  if (!Object.keys(record).length) return data;

  const executionAttempt = asRecord(record.executionAttempt);
  const attemptId = typeof executionAttempt.attemptId === 'string'
    ? executionAttempt.attemptId
    : typeof executionAttempt.id === 'string'
      ? executionAttempt.id
      : null;
  if (attemptId) {
    const resume = {
      resumeToken: `capresume_${attemptId}`,
      resumeTool: 'agentpay_execute_with_resume_token',
      mode: 'server_side_exact_call_resume',
      instruction: 'After the human step completes, call the resume tool with this token. AgentPay resumes the stored call server-side; the agent never receives the provider secret.',
    };
    return {
      ...record,
      agentResume: resume,
      nextAction: {
        ...asRecord(record.nextAction),
        agentResume: resume,
      },
    };
  }

  const actionSession = asRecord(record.actionSession);
  const sessionId = typeof actionSession.sessionId === 'string'
    ? actionSession.sessionId
    : typeof record.sessionId === 'string'
      ? record.sessionId
      : null;
  if (sessionId) {
    const resume = {
      resumeToken: `apsetup_${sessionId}`,
      resumeTool: 'agentpay_execute_with_resume_token',
      mode: 'hosted_human_step_status',
      instruction: 'Poll this token after the human finishes setup, funding, OTP, or approval. If this was provider setup, rerun agentpay_buy_api with the same arguments to reuse governed access.',
    };
    return {
      ...record,
      agentResume: resume,
      nextAction: {
        ...asRecord(record.nextAction),
        agentResume: resume,
      },
    };
  }

  return data;
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

    case 'agentpay_scan_for_leaked_secrets': {
      const text = typeof args.text === 'string' ? args.text : '';
      const { findings } = await scanForLeakedSecrets(text);
      let vaultSession: unknown = null;
      let serverLeakGuard: unknown = null;
      const requestedMode = typeof args.mode === 'string'
        ? args.mode
        : args.autoVault === true
          ? 'vault'
          : 'scan';
      if ((requestedMode === 'vault' || requestedMode === 'auto_heal' || args.autoVault === true) && findings.length > 0) {
        serverLeakGuard = await apiFetch(`${CAPABILITIES_BASE_PATH}/leak-guard/events`, {
          method: 'POST',
          body: JSON.stringify({
            text,
            mode: requestedMode === 'scan' ? 'vault' : requestedMode,
            source: args.source ?? 'leak_guard',
            subjectType: args.subjectType ?? 'workspace',
            subjectRef: args.subjectRef,
          }),
        }, resolved);
        vaultSession = asRecord(serverLeakGuard).vaultSession ?? null;
      }

      const result = {
        status: findings.length > 0 ? 'leak_detected' : 'clean',
        source: args.source ?? null,
        findingCount: findings.length,
        findings,
        scrubbedText: findings.length > 0
          ? findings.reduce((scrubbed, finding) => {
              const redacted = typeof finding.redacted === 'string' ? finding.redacted : '[redacted]';
              return scrubbed.replace(redacted, '[AGENTPAY_VAULTED_SECRET]');
            }, '[scrubbed_by_agentpay]')
          : text,
        autoVaultRequested: args.autoVault === true,
        vaultSession,
        serverLeakGuard,
        immediateAction: findings.length > 0
          ? findings.some((finding) => finding.recommendedAction === 'kill_agent_session')
            ? 'Kill the agent session. A live master key or non-vaultable authority was exposed and must be rotated manually.'
            : 'Treat the exposed key as compromised. Complete Leak Guard vaulting/rotation, then use AgentPay leases or scoped proxy execution instead of raw secrets.'
          : 'No supported API key pattern was detected.',
        supportedProviders: SECRET_LEAK_PATTERNS.map((pattern) => pattern.provider),
        secretHandling: {
          rawSecretsReturned: false,
          agentReceives: 'redacted fingerprints, rotation plan, optional OTP vault session',
          agentMustNotDo: 'Do not ask the human to paste the raw secret again.',
        },
      };

      return finalizeToolResult(name, result, resolved);
    }

    case 'agentpay_buy_api': {
      const inferredProvider = args.provider ?? inferProviderForCapability(args.capability, args.priority);
      const body: Record<string, unknown> = {
        capability: args.capability,
        provider: inferredProvider,
        requestedProviderName: args.requestedProviderName ?? args.capability,
        priority: args.priority,
        maxBudgetUsd: args.maxBudgetUsd,
        subjectType: args.subjectType ?? 'workspace',
        subjectRef: args.subjectRef,
        principalId: args.principalId,
        operatorId: args.operatorId,
        workbenchId: args.workbenchId,
        workbenchLabel: args.workbenchLabel,
        issueWorkbenchLease: args.issueWorkbenchLease ?? true,
        customerPhone: args.customerPhone,
        customerEmail: args.customerEmail,
        notificationChannel: args.notificationChannel ?? (args.customerPhone ? 'phone' : 'terminal'),
        requestedBaseUrl: args.requestedBaseUrl,
        allowedHosts: args.allowedHosts,
        authScheme: args.authScheme,
        credentialKind: args.credentialKind,
        metadata: {
          source: 'agentpay_buy_api',
          capability: args.capability,
          priority: args.priority,
          maxBudgetUsd: args.maxBudgetUsd,
          notificationChannel: args.notificationChannel ?? (args.customerPhone ? 'phone' : 'terminal'),
        },
      };

      const resolvedAccess = await apiFetch(`${CAPABILITIES_BASE_PATH}/access-resolve`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved) as Record<string, unknown>;

      const initialCall = asRecord(args.initialCall);
      const capability = asRecord(resolvedAccess.capability);
      const workbenchLease = asRecord(resolvedAccess.workbenchLease);
      const leaseToken = typeof workbenchLease.token === 'string' ? workbenchLease.token : null;
      const workbenchId = typeof args.workbenchId === 'string' ? args.workbenchId : null;
      const capabilityId = typeof capability.id === 'string' ? capability.id : null;

      if (resolvedAccess.status === 'ready' && Object.keys(initialCall).length > 0) {
        const executeBody: Record<string, unknown> = {
          method: initialCall.method ?? 'GET',
          path: initialCall.path ?? '/',
          query: initialCall.query,
          headers: initialCall.headers,
          body: initialCall.body,
          allowPaidUsage: initialCall.allowPaidUsage ?? false,
          requestId: initialCall.requestId,
          idempotencyKey: initialCall.idempotencyKey ?? initialCall.requestId,
          principalId: args.principalId,
          operatorId: args.operatorId,
          customerPhone: args.customerPhone,
          customerEmail: args.customerEmail,
          rail: args.preferredFundingRail,
          hostContext: {
            source: 'agentpay_buy_api',
            capability: args.capability,
            priority: args.priority,
            workbenchId: args.workbenchId,
          },
          guardrailContext: {
            maxBudgetUsd: args.maxBudgetUsd,
            notificationChannel: args.notificationChannel ?? (args.customerPhone ? 'phone' : 'terminal'),
          },
        };

        const execution = leaseToken && workbenchId
          ? await apiFetch(`${CAPABILITIES_BASE_PATH}/lease-execute`, {
              method: 'POST',
              body: JSON.stringify({
                ...executeBody,
                leaseToken,
                workbenchId,
              }),
            }, resolved)
          : capabilityId
            ? await apiFetch(`${CAPABILITIES_BASE_PATH}/${encodeURIComponent(capabilityId)}/execute`, {
                method: 'POST',
                body: JSON.stringify(executeBody),
              }, resolved)
            : null;

        return finalizeToolResult(name, withAgentResume({
          status: execution ? 'executed' : resolvedAccess.status,
          access: withAgentResume(resolvedAccess),
          execution: withAgentResume(execution),
        }), resolved);
      }

      return finalizeToolResult(name, withAgentResume(resolvedAccess), resolved);
    }

    case 'agentpay_read_authority_bootstrap': {
      const qs = new URLSearchParams();
      qs.set('principalId', String(args.principalId));
      if (args.subjectType) qs.set('subjectType', String(args.subjectType));
      if (args.subjectRef) qs.set('subjectRef', String(args.subjectRef));
      if (args.workbenchId) qs.set('workbenchId', String(args.workbenchId));
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/authority-bootstrap?${qs}`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_update_authority_bootstrap': {
      const body: Record<string, unknown> = {
        principalId: args.principalId,
        operatorId: args.operatorId,
        workbenchId: args.workbenchId,
        contactEmail: args.contactEmail,
        contactName: args.contactName,
        customerPhone: args.customerPhone,
        preferredFundingRail: args.preferredFundingRail,
        notificationChannel: args.notificationChannel ?? (args.customerPhone ? 'phone' : 'terminal'),
        autoApproveUsd: args.autoApproveUsd,
        perActionUsd: args.perActionUsd,
        dailyUsd: args.dailyUsd,
        monthlyUsd: args.monthlyUsd,
        otpEveryPaidAction: args.otpEveryPaidAction,
      };
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/authority-bootstrap`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_get_terminal_control_plane': {
      const qs = new URLSearchParams();
      if (args.principalId) qs.set('principalId', String(args.principalId));
      if (args.workbenchId) qs.set('workbenchId', String(args.workbenchId));
      const suffix = qs.toString() ? `?${qs}` : '';
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/terminal/control-plane${suffix}`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_execute_with_workbench_lease': {
      const body: Record<string, unknown> = {
        leaseToken: args.leaseToken,
        workbenchId: args.workbenchId,
        method: args.method ?? 'GET',
        path: args.path ?? '/',
        query: args.query,
        headers: args.headers,
        body: args.body,
        allowPaidUsage: args.allowPaidUsage ?? false,
        principalId: args.principalId,
        operatorId: args.operatorId,
        customerPhone: args.customerPhone,
        customerEmail: args.customerEmail,
        idempotencyKey: args.idempotencyKey,
      };
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/lease-execute`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, withAgentResume(data), resolved);
    }

    case 'agentpay_list_workbench_leases': {
      const qs = new URLSearchParams();
      if (args.principalId) qs.set('principalId', String(args.principalId));
      if (args.workbenchId) qs.set('workbenchId', String(args.workbenchId));
      if (args.status) qs.set('status', String(args.status));
      const suffix = qs.toString() ? `?${qs}` : '';
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/leases${suffix}`, {}, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_revoke_workbench_lease': {
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/leases/${encodeURIComponent(args.leaseId as string)}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason: args.reason }),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    case 'agentpay_execute_with_resume_token': {
      const resumeToken = String(args.resumeToken ?? '');
      if (resumeToken.startsWith('capresume_')) {
        const attemptId = resumeToken.slice('capresume_'.length);
        const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/execution-attempts/${encodeURIComponent(attemptId)}`, {}, resolved);
        return finalizeToolResult(name, withAgentResume(data), resolved);
      }
      if (resumeToken.startsWith('apsetup_')) {
        const sessionId = resumeToken.slice('apsetup_'.length);
        const data = await apiFetch(`${ACTIONS_BASE_PATH}/${encodeURIComponent(sessionId)}`, {}, resolved);
        return finalizeToolResult(name, withAgentResume(data), resolved);
      }
      throw new Error('resumeToken must start with capresume_ or apsetup_');
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

    case 'agentpay_get_capability_connect_session': {
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/connect-sessions/${encodeURIComponent(args.sessionId as string)}`, {}, resolved);
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
        principalId: args.principalId,
        operatorId: args.operatorId,
        customerPhone: args.customerPhone,
        customerEmail: args.customerEmail,
        requestId: args.requestId,
        idempotencyKey: args.idempotencyKey,
      };
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/${encodeURIComponent(args.capabilityId as string)}/execute`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, resolved);
      return finalizeToolResult(name, withAgentResume(data), resolved);
    }

    case 'agentpay_get_action_session': {
      const data = await apiFetch(`${ACTIONS_BASE_PATH}/${encodeURIComponent(args.sessionId as string)}`, {}, resolved);
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

    case 'ace_whoami':
    case 'ace_plan_travel':
    case 'ace_request_booking_payment':
    case 'ace_poll_payment':
    case 'ace_charge_saved':
    case 'ace_confirm_saved_charge':
    case 'ace_book_travel':
    case 'ace_get_trip_status':
    case 'agentpay_pay_subscription':
      return handleAceTool(name, args, asAceRuntime(resolved));

    case 'agentpay_setup_scan': {
      const detected = KNOWN_ENV_PROVIDERS
        .filter(e => Boolean(process.env[e.envVar]))
        .map(e => ({ provider: e.provider, label: e.label, envVar: e.envVar }));
      const missing = KNOWN_ENV_PROVIDERS
        .filter(e => !process.env[e.envVar])
        .map(e => ({ provider: e.provider, label: e.label, envVar: e.envVar }));
      return json({
        detected,
        missing,
        _instruction: detected.length
          ? `Found ${detected.length} API key(s) in your environment. Call agentpay_vault_env_keys with providers=[${detected.map(e => `"${e.provider}"`).join(', ')}] to vault them behind a single OTP confirmation.`
          : 'No known API keys found in the environment. Set one or more of the listed env vars and call agentpay_setup_scan again.',
      });
    }

    case 'agentpay_vault_env_keys': {
      const requestedProviders = Array.isArray(args.providers) ? args.providers as string[] : [];
      const credentials: Array<{ provider: string; label: string; envVar: string; keyValue: string; baseUrl: string; authScheme: string; credentialKind: string }> = [];
      const skipped: Array<{ provider: string; reason: string }> = [];

      for (const providerName of requestedProviders) {
        const entry = KNOWN_ENV_PROVIDERS.find(e => e.provider === providerName);
        if (!entry) {
          skipped.push({ provider: providerName, reason: 'unknown_provider' });
          continue;
        }
        const keyValue = process.env[entry.envVar];
        if (!keyValue) {
          skipped.push({ provider: providerName, reason: `${entry.envVar} not set in environment` });
          continue;
        }
        credentials.push({
          provider: entry.provider,
          label: entry.label,
          envVar: entry.envVar,
          keyValue,
          baseUrl: entry.baseUrl,
          authScheme: entry.authScheme,
          credentialKind: entry.credentialKind,
        });
      }

      if (credentials.length === 0) {
        return json({
          error: 'no_credentials_found',
          skipped,
          _instruction: 'None of the requested providers had env vars set. Check agentpay_setup_scan to see what is available.',
        });
      }

      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/vault-from-env`, {
        method: 'POST',
        body: JSON.stringify({ credentials }),
      }, resolved);
      return finalizeToolResult(name, { ...data as object, skipped }, resolved);
    }

    case 'agentpay_confirm_vault': {
      const sessionId = args.session_id as string;
      const otp = args.otp as string;
      const data = await apiFetch(`${CAPABILITIES_BASE_PATH}/vault-from-env/${encodeURIComponent(sessionId)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ otp }),
      }, resolved);
      return finalizeToolResult(name, data, resolved);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createAgentPayMcpServer(
  runtime?: AgentPayMcpRuntime,
  options?: {
    tools?: Tool[];
    serverName?: string;
  },
): Server {
  const tools = options?.tools ?? TOOLS;
  const allowedToolNames = new Set(tools.map((tool) => tool.name));
  const server = new Server(
    { name: options?.serverName ?? 'agentpay', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    if (!allowedToolNames.has(name)) {
      return {
        content: [{ type: 'text' as const, text: `Error: Tool "${name}" is not available on this AgentPay MCP surface.` }],
        isError: true,
      };
    }
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

