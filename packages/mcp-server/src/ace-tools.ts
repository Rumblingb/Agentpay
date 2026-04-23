/**
 * ace-tools.ts — Ace travel concierge tools for the AgentPay MCP server.
 *
 * These tools expose the Ace AI travel concierge (flights, UK/India/EU rail,
 * hotels, restaurants) as MCP tool calls. Any agent that can connect to the
 * AgentPay MCP server can plan and book travel through Ace.
 *
 * MERGE GUIDE (for Codex / index.ts maintainer):
 *   1. import { ACE_TOOLS, handleAceTool } from './ace-tools.js';
 *   2. Spread ACE_TOOLS into the TOOLS array: [...EXISTING_TOOLS, ...ACE_TOOLS]
 *   3. Add to handleTool switch (before the default throw):
 *        case 'ace_plan_travel':
 *        case 'ace_book_travel':
 *        case 'ace_get_trip_status':
 *        case 'ace_whoami':
 *        case 'ace_request_booking_payment':
 *        case 'ace_poll_payment':
 *          return handleAceTool(name, args, runtime);
 */

import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface AceRuntime {
  apiUrl: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}

export type { CallToolResult as ToolResponse };

function json(data: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

async function aceFetch(
  path: string,
  options: RequestInit,
  runtime: AceRuntime,
): Promise<unknown> {
  const url = `${runtime.apiUrl}${path}`;
  const res = await runtime.fetchImpl(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Ace API error ${res.status}: ${text}`);
  return data;
}

export const ACE_TOOLS: Tool[] = [
  // ── Identity ─────────────────────────────────────────────────────────────
  {
    name: 'ace_whoami',
    description:
      'Resolve the current API token to a user profile — name, hirer ID, and payment readiness. ' +
      'Call this FIRST before any booking flow so you know who is paying and whether a saved ' +
      'payment method exists (avoiding the manual payment step for returning users).\n\n' +
      'Returns: hirerId, displayName, hasPaymentMethod, defaultCurrency, savedMethods[].',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  // ── Planning ──────────────────────────────────────────────────────────────
  {
    name: 'ace_plan_travel',
    description:
      'Ask Ace (AgentPay\'s AI travel concierge) to plan a trip from a natural-language request. ' +
      'Returns Ace\'s narration and a plan array with pricing. No booking is made — call ace_book_travel to execute.\n\n' +
      'Covers: flights (global via Duffel), UK rail (live fares), Indian rail, EU rail, hotels, restaurants, London TfL.\n\n' +
      'Examples:\n' +
      '  "fly me to Tokyo next Friday, return Sunday, economy"\n' +
      '  "next train from Manchester to London, cheapest"\n' +
      '  "hotel in Edinburgh for Saturday night, under £120"\n' +
      '  "Delhi to Agra tomorrow morning by train"',
    inputSchema: {
      type: 'object' as const,
      properties: {
        request: {
          type: 'string',
          description:
            'Natural language travel request. Be as specific or as open-ended as you like — ' +
            'Ace will ask for clarification if needed.',
        },
        hirer_id: {
          type: 'string',
          description:
            'AgentPay user ID of the person travelling and paying. ' +
            'Required for personalised results and to execute payment in ace_book_travel. ' +
            'If omitted, defaults to the API key holder.',
        },
        currency: {
          type: 'string',
          description:
            'Preferred display currency code, e.g. GBP, USD, EUR, INR. Defaults to GBP.',
        },
        home_station: {
          type: 'string',
          description: 'User\'s home station (helps Ace suggest routes without asking).',
        },
        work_station: {
          type: 'string',
          description: 'User\'s work station (helps Ace suggest commute routes).',
        },
      },
      required: ['request'],
    },
  },

  // ── Payment bridge ────────────────────────────────────────────────────────
  {
    name: 'ace_request_booking_payment',
    description:
      'Create a Stripe checkout link for a travel booking when the user has NO saved card. ' +
      'Use ONLY when ace_whoami returns hasPaymentMethod: false.\n\n' +
      'If hasPaymentMethod: true — call ace_charge_saved instead (6-digit OTP, no browser required).\n\n' +
      'Returns payment_url. Show it to the user: "Pay £84 to confirm your Edinburgh train: <url>". ' +
      'Then call ace_poll_payment, then ace_book_travel. ' +
      'The card is saved automatically after this checkout so future bookings use ace_charge_saved.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hirer_id: {
          type: 'string',
          description: 'The hirerId from ace_whoami.',
        },
        amount: {
          type: 'number',
          description: 'Total booking amount (from ace_plan_travel planPrice).',
        },
        currency: {
          type: 'string',
          description: 'Currency code, e.g. GBP, USD, INR.',
        },
        description: {
          type: 'string',
          description: 'Short description shown on the payment page, e.g. "London to Edinburgh, 09:05 Fri 25 Apr".',
        },
        customer_name: {
          type: 'string',
          description: 'User\'s name for the payment page.',
        },
        customer_email: {
          type: 'string',
          description: 'User\'s email for the receipt.',
        },
      },
      required: ['amount', 'currency', 'description'],
    },
  },
  {
    name: 'ace_poll_payment',
    description:
      'Poll a payment action session until it completes, fails, or expires. ' +
      'Call this after ace_request_booking_payment once you have shown the user the payment URL. ' +
      'Polls up to max_attempts times with a 3-second interval.\n\n' +
      'Returns: status (pending | completed | failed | expired), and paid: true when ready to book.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'The action_session_id from ace_request_booking_payment.',
        },
        max_attempts: {
          type: 'number',
          description: 'Max polling attempts before giving up. Default 40 (2 minutes).',
        },
      },
      required: ['session_id'],
    },
  },

  // ── Saved-card OTP charge ─────────────────────────────────────────────────
  {
    name: 'ace_charge_saved',
    description:
      'Initiate an OTP-gated charge on the user\'s saved card. ' +
      'Use this when ace_whoami returns hasPaymentMethod: true.\n\n' +
      'Sends a 6-digit code to the user\'s registered email. The agent asks the user to enter it ' +
      'in the terminal, then calls ace_confirm_saved_charge — no browser, no checkout page.\n\n' +
      'Returns session_id, last4, brand, otp_sent_to, and an _instruction to show the user.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hirer_id: {
          type: 'string',
          description: 'The hirerId from ace_whoami.',
        },
        amount: {
          type: 'number',
          description: 'Total booking amount.',
        },
        currency: {
          type: 'string',
          description: 'Currency code, e.g. GBP, USD, INR.',
        },
        description: {
          type: 'string',
          description: 'Short description shown in the confirmation email, e.g. "London to Edinburgh, 09:05 Fri 25 Apr".',
        },
        end_user_email: {
          type: 'string',
          description: 'Optional override for who should receive the OTP. If omitted, AgentPay uses the saved payment contact on file.',
        },
      },
      required: ['amount', 'currency', 'description'],
    },
  },
  {
    name: 'ace_confirm_saved_charge',
    description:
      'Confirm the OTP entered by the user and fire the off-session Stripe charge. ' +
      'Call this after ace_charge_saved once the user provides the 6-digit code.\n\n' +
      'On success returns charged: true and payment_intent_id — then call ace_book_travel immediately.\n' +
      'On wrong code returns attempts_remaining. On 3 failures the session is locked.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'The session_id from ace_charge_saved.',
        },
        otp: {
          type: 'string',
          description: 'The 6-digit code the user entered.',
        },
      },
      required: ['session_id', 'otp'],
    },
  },

  // ── AI CLI subscription top-up ───────────────────────────────────────────
  {
    name: 'agentpay_pay_subscription',
    description:
      'Charge the user\'s saved card for an AI CLI subscription renewal — Claude Pro, OpenAI Plus, Gemini Advanced, etc. ' +
      'Use this when an agent or user hits a usage limit and wants to top up without opening a browser.\n\n' +
      'Sends a 6-digit OTP to the user\'s email. After they confirm, the charge fires. ' +
      'Returns next_step with the billing URL so the user can apply the payment.\n\n' +
      'Known plans and amounts:\n' +
      '  claude_pro: $20/mo (USD) — claude.ai/settings\n' +
      '  openai_plus: $20/mo (USD) — platform.openai.com/billing\n' +
      '  gemini_advanced: $19.99/mo (USD) — one.google.com\n' +
      '  anthropic_api: variable — console.anthropic.com/billing\n' +
      '  openai_api: variable — platform.openai.com/billing\n\n' +
      'After charge, show the user next_step and instruct them to apply the payment on that page.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        service: {
          type: 'string',
          enum: ['claude_pro', 'openai_plus', 'gemini_advanced', 'anthropic_api', 'openai_api', 'other'],
          description: 'The AI service subscription to pay for.',
        },
        amount: {
          type: 'number',
          description: 'Amount to charge. Required for anthropic_api, openai_api, or other. For known plans the default is used if omitted.',
        },
        currency: {
          type: 'string',
          description: 'Currency code, default USD.',
          default: 'USD',
        },
        hirer_id: {
          type: 'string',
          description: 'The hirerId from ace_whoami. If omitted, uses the API key holder.',
        },
        end_user_email: {
          type: 'string',
          description: 'Optional override for who receives the OTP confirmation.',
        },
      },
      required: ['service'],
    },
  },

  // ── Booking ───────────────────────────────────────────────────────────────
  {
    name: 'ace_book_travel',
    description:
      'Execute a travel booking that Ace planned with ace_plan_travel.\n\n' +
      'FULL END-TO-END FLOW:\n' +
      '  1. ace_whoami → get hirerId + check hasPaymentMethod\n' +
      '  2. ace_plan_travel → get options + price\n' +
      '  3a. hasPaymentMethod: true  → ace_charge_saved → user enters OTP → ace_confirm_saved_charge → ace_book_travel\n' +
      '  3b. hasPaymentMethod: false → ace_request_booking_payment → ace_poll_payment → ace_book_travel\n\n' +
      'Only call this after payment is confirmed (charged: true or poll status: completed).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        request: {
          type: 'string',
          description: 'The original travel request, identical to what was passed to ace_plan_travel.',
        },
        hirer_id: {
          type: 'string',
          description: 'AgentPay user ID of the person paying. Required.',
        },
        plan: {
          type: 'array' as const,
          description: 'The plan array from ace_plan_travel. Pass it back unchanged.',
          items: { type: 'object' as const, additionalProperties: true },
        },
        currency: {
          type: 'string',
          description: 'Currency code used in ace_plan_travel, e.g. GBP.',
        },
      },
      required: ['request', 'hirer_id', 'plan'],
    },
  },
  {
    name: 'ace_get_trip_status',
    description:
      'Check the live status of a trip booking made by ace_book_travel. ' +
      'Returns the current booking state (ticketed, live, completed, disrupted), ' +
      'the agent handling it, and any real-time journey updates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        intent_id: {
          type: 'string',
          description: 'The intent ID returned by ace_book_travel.',
        },
      },
      required: ['intent_id'],
    },
  },
];

export async function handleAceTool(
  name: string,
  args: Record<string, unknown>,
  runtime: AceRuntime,
): Promise<CallToolResult> {
  switch (name) {

    case 'ace_whoami': {
      // Resolve the token holder's profile and payment readiness in one call.
      const [statsRaw, methodsRaw] = await Promise.allSettled([
        aceFetch('/api/merchants/stats', {}, runtime),
        aceFetch('/api/payments/methods/me', {}, runtime),
      ]);

      const stats = statsRaw.status === 'fulfilled' ? statsRaw.value as Record<string, unknown> : {};
      const methodsData = methodsRaw.status === 'fulfilled' ? methodsRaw.value as Record<string, unknown> : {};
      const methods = Array.isArray(methodsData.methods) ? methodsData.methods : [];

      const profile = {
        hirerId: (stats.merchantId ?? stats.id ?? stats.agentId ?? null) as string | null,
        displayName: (stats.name ?? stats.displayName ?? null) as string | null,
        defaultCurrency: (stats.currency ?? 'GBP') as string,
        hasPaymentMethod: methods.length > 0,
        savedMethods: methods.map((m: Record<string, unknown>) => ({
          id: m.id,
          type: m.type ?? m.brand,
          last4: m.last4,
          contactEmailMasked: m.contactEmailMasked ?? null,
          isDefault: m.isDefault ?? false,
        })),
        paymentContactEmailMasked: (methods[0] as Record<string, unknown> | undefined)?.contactEmailMasked ?? null,
        _note: 'If hirerId is null, set AGENTPAY_MERCHANT_ID in your MCP server env.',
      };

      return json(profile);
    }

    case 'ace_request_booking_payment': {
      const body: Record<string, unknown> = {
        rail: 'card',
        description: args.description as string,
        amount: args.amount,
        currency: args.currency,
      };
      if (args.hirer_id) body.principalId = args.hirer_id;
      if (args.customer_name) body.customerName = args.customer_name;
      if (args.customer_email) body.customerEmail = args.customer_email;

      const data = await aceFetch('/api/payments/funding-request', {
        method: 'POST',
        body: JSON.stringify(body),
      }, runtime) as Record<string, unknown>;

      // Surface the payment URL and session ID clearly so the LLM can present it
      const nextAction = data.nextAction as Record<string, unknown> | undefined;
      return json({
        payment_url: nextAction?.url ?? nextAction?.checkoutUrl ?? data.url ?? null,
        action_session_id: nextAction?.actionSession ?? data.actionSession ?? data.sessionId ?? null,
        amount: args.amount,
        currency: args.currency,
        description: args.description,
        _instruction: 'Show payment_url to the user. Then call ace_poll_payment with action_session_id.',
        raw: data,
      });
    }

    case 'ace_poll_payment': {
      const sessionId = args.session_id as string;
      const maxAttempts = typeof args.max_attempts === 'number' ? args.max_attempts : 40;
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      for (let i = 0; i < maxAttempts; i++) {
        const data = await aceFetch(
          `/api/actions/${encodeURIComponent(sessionId)}`,
          {},
          runtime,
        ) as Record<string, unknown>;

        const status = (data.status ?? data.state ?? 'pending') as string;
        if (status === 'completed' || status === 'paid' || status === 'success') {
          return json({ status: 'completed', paid: true, attempt: i + 1, raw: data });
        }
        if (status === 'failed' || status === 'expired' || status === 'cancelled') {
          return json({ status, paid: false, attempt: i + 1, raw: data });
        }
        if (i < maxAttempts - 1) await delay(3000);
      }

      return json({ status: 'timeout', paid: false, attempts: maxAttempts,
        _note: 'User may still complete payment. Try ace_poll_payment again or call ace_book_travel if payment was completed out of band.' });
    }

    case 'ace_charge_saved': {
      const body: Record<string, unknown> = {
        amount: args.amount,
        currency: args.currency,
        description: args.description,
      };
      if (args.hirer_id) body.principalId = args.hirer_id;
      if (args.end_user_email) body.end_user_email = args.end_user_email;
      const data = await aceFetch('/api/payments/charge-saved', {
        method: 'POST',
        body: JSON.stringify(body),
      }, runtime) as Record<string, unknown>;
      return json(data);
    }

    case 'ace_confirm_saved_charge': {
      const sessionId = args.session_id as string;
      const data = await aceFetch(`/api/payments/charge-saved/${encodeURIComponent(sessionId)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ otp: args.otp }),
      }, runtime) as Record<string, unknown>;
      return json(data);
    }

    case 'agentpay_pay_subscription': {
      const KNOWN_PLANS: Record<string, { amount: number; currency: string; label: string; billingUrl: string }> = {
        claude_pro:        { amount: 20,    currency: 'USD', label: 'Claude Pro',         billingUrl: 'https://claude.ai/settings' },
        openai_plus:       { amount: 20,    currency: 'USD', label: 'ChatGPT Plus',       billingUrl: 'https://platform.openai.com/billing' },
        gemini_advanced:   { amount: 19.99, currency: 'USD', label: 'Gemini Advanced',    billingUrl: 'https://one.google.com' },
        anthropic_api:     { amount: 0,     currency: 'USD', label: 'Anthropic API',      billingUrl: 'https://console.anthropic.com/billing' },
        openai_api:        { amount: 0,     currency: 'USD', label: 'OpenAI API',         billingUrl: 'https://platform.openai.com/billing' },
        other:             { amount: 0,     currency: 'USD', label: 'AI subscription',    billingUrl: '' },
      };

      const service = args.service as string;
      const plan = KNOWN_PLANS[service] ?? KNOWN_PLANS.other;
      const amount = (typeof args.amount === 'number' && args.amount > 0) ? args.amount : plan.amount;
      const currency = (typeof args.currency === 'string' && args.currency.trim()) ? args.currency.trim().toUpperCase() : plan.currency;

      if (!amount || amount <= 0) {
        return json({ error: 'amount is required for this service', service });
      }

      const chargeBody: Record<string, unknown> = {
        amount,
        currency,
        description: `${plan.label} subscription renewal`,
      };
      if (args.hirer_id) chargeBody.principalId = args.hirer_id;
      if (args.end_user_email) chargeBody.end_user_email = args.end_user_email;

      const data = await aceFetch('/api/payments/charge-saved', {
        method: 'POST',
        body: JSON.stringify(chargeBody),
      }, runtime) as Record<string, unknown>;

      return json({
        ...data,
        service,
        next_step: plan.billingUrl
          ? `After confirming the OTP, visit ${plan.billingUrl} to apply the payment to your account.`
          : 'After confirming the OTP, apply the payment at the service billing page.',
        _instruction: data._instruction ?? `A 6-digit code will be sent to your registered email. Call ace_confirm_saved_charge with session_id and the code.`,
      });
    }

    case 'ace_plan_travel': {
      const travelProfile: Record<string, unknown> = {};
      if (args.currency) travelProfile.currency = args.currency;
      if (args.home_station) travelProfile.homeStation = args.home_station;
      if (args.work_station) travelProfile.workStation = args.work_station;

      const body: Record<string, unknown> = {
        transcript: args.request as string,
        hirerId: (args.hirer_id as string | undefined) ?? 'mcp-guest',
        confirmed: false,
      };
      if (Object.keys(travelProfile).length > 0) body.travelProfile = travelProfile;

      const data = await aceFetch('/api/concierge/intent', {
        method: 'POST',
        body: JSON.stringify(body),
      }, runtime);

      return json(data);
    }

    case 'ace_book_travel': {
      const body: Record<string, unknown> = {
        transcript: args.request as string,
        hirerId: args.hirer_id as string,
        plan: args.plan,
        confirmed: true,
      };
      if (args.currency) {
        body.travelProfile = { currency: args.currency };
      }

      const data = await aceFetch('/api/concierge/confirm', {
        method: 'POST',
        body: JSON.stringify(body),
      }, runtime);

      return json(data);
    }

    case 'ace_get_trip_status': {
      const data = await aceFetch(
        `/api/intent/${encodeURIComponent(args.intent_id as string)}`,
        {},
        runtime,
      );
      return json(data);
    }

    default:
      throw new Error(`Unknown Ace tool: ${name}`);
  }
}
