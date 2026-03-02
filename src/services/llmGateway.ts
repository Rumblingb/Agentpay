/**
 * LLM Gateway Service
 *
 * Proxy service that accepts a standard "Chat Completion" request, checks the
 * agent's spending policy, forwards to the configured LLM provider
 * (OpenAI / Anthropic / Groq), calculates the cost based on token usage,
 * and charges the agent via an internal PaymentIntent.
 *
 * Merchants can now sell "GPT-4 access" through AgentPay with zero extra code.
 */

import { logger } from '../logger';
import { checkAndIncrementSpending } from './spendingPolicyService';
import { createIntent } from './intentService';
import { enqueueWebhook } from './webhookQueue';
import { query } from '../db/index';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  merchantId: string;
  agentId: string;
  provider: 'openai' | 'anthropic' | 'groq';
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
}

export interface LLMTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  id: string;
  provider: string;
  model: string;
  content: string;
  usage: LLMTokenUsage;
  costUsd: number;
  intentId: string;
  finishReason: string;
}

export interface LLMProviderConfig {
  apiKey: string;
  baseUrl: string;
}

export interface MicropaymentRequest {
  merchantId: string;
  agentId: string;
  amount: number;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface MicropaymentResult {
  approved: boolean;
  intentId?: string;
  amount: number;
  reason?: string;
}

// ── Token Pricing (per 1K tokens in USD) ───────────────────────────────────

const TOKEN_PRICING: Record<string, { prompt: number; completion: number }> = {
  // OpenAI
  'gpt-4': { prompt: 0.03, completion: 0.06 },
  'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
  'gpt-4o': { prompt: 0.005, completion: 0.015 },
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },
  // Anthropic
  'claude-3-opus': { prompt: 0.015, completion: 0.075 },
  'claude-3-sonnet': { prompt: 0.003, completion: 0.015 },
  'claude-3-haiku': { prompt: 0.00025, completion: 0.00125 },
  'claude-3.5-sonnet': { prompt: 0.003, completion: 0.015 },
  // Groq
  'llama-3-70b': { prompt: 0.00059, completion: 0.00079 },
  'llama-3-8b': { prompt: 0.00005, completion: 0.00008 },
  'mixtral-8x7b': { prompt: 0.00024, completion: 0.00024 },
};

// Default pricing for unknown models
const DEFAULT_PRICING = { prompt: 0.01, completion: 0.03 };

// ── Provider Endpoints ─────────────────────────────────────────────────────

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
};

// ── Cost Calculation ───────────────────────────────────────────────────────

/**
 * Calculates cost in USD based on token usage and model pricing.
 */
export function calculateCost(model: string, usage: LLMTokenUsage): number {
  const pricing = TOKEN_PRICING[model] || DEFAULT_PRICING;
  const promptCost = (usage.promptTokens / 1000) * pricing.prompt;
  const completionCost = (usage.completionTokens / 1000) * pricing.completion;
  return parseFloat((promptCost + completionCost).toFixed(6));
}

// ── Provider Request Builders ──────────────────────────────────────────────

function buildOpenAIRequest(req: LLMRequest): { url: string; headers: Record<string, string>; body: unknown } {
  const apiKey = process.env.OPENAI_API_KEY || '';
  return {
    url: PROVIDER_ENDPOINTS.openai,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: {
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.7,
    },
  };
}

function buildAnthropicRequest(req: LLMRequest): { url: string; headers: Record<string, string>; body: unknown } {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const systemMessage = req.messages.find(m => m.role === 'system')?.content;
  const nonSystemMessages = req.messages.filter(m => m.role !== 'system');

  return {
    url: PROVIDER_ENDPOINTS.anthropic,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: req.model,
      max_tokens: req.maxTokens || 1024,
      ...(systemMessage && { system: systemMessage }),
      messages: nonSystemMessages.map(m => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? 0.7,
    },
  };
}

function buildGroqRequest(req: LLMRequest): { url: string; headers: Record<string, string>; body: unknown } {
  const apiKey = process.env.GROQ_API_KEY || '';
  return {
    url: PROVIDER_ENDPOINTS.groq,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: {
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.7,
    },
  };
}

// ── Provider Response Parsers ──────────────────────────────────────────────

function parseOpenAIResponse(data: any): { content: string; usage: LLMTokenUsage; finishReason: string } {
  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    },
    finishReason: data.choices?.[0]?.finish_reason || 'stop',
  };
}

function parseAnthropicResponse(data: any): { content: string; usage: LLMTokenUsage; finishReason: string } {
  return {
    content: data.content?.[0]?.text || '',
    usage: {
      promptTokens: data.usage?.input_tokens || 0,
      completionTokens: data.usage?.output_tokens || 0,
      totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
    finishReason: data.stop_reason || 'end_turn',
  };
}

// ── Core Gateway Logic ─────────────────────────────────────────────────────

/**
 * Processes an LLM completion request through the AgentPay billing pipeline.
 *
 * 1. Validates the merchant exists and is active
 * 2. Checks the agent's spending policy (pre-authorize estimated cost)
 * 3. Forwards the request to the LLM provider
 * 4. Calculates actual cost based on token usage
 * 5. Creates an internal PaymentIntent to charge the agent
 */
export async function processLLMRequest(req: LLMRequest): Promise<LLMResponse> {
  const { merchantId, agentId, provider, model, messages } = req;

  // 1. Validate merchant
  const merchantResult = await query(
    `SELECT id, wallet_address, webhook_url FROM merchants WHERE id = $1 AND is_active = true`,
    [merchantId],
  );

  if (merchantResult.rows.length === 0) {
    throw Object.assign(new Error('Merchant not found or inactive'), { status: 404 });
  }

  // 2. Estimate cost and check spending policy
  const estimatedTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  const estimatedMaxTokens = req.maxTokens || 1024;
  const estimatedUsage: LLMTokenUsage = {
    promptTokens: estimatedTokens,
    completionTokens: estimatedMaxTokens,
    totalTokens: estimatedTokens + estimatedMaxTokens,
  };
  const estimatedCost = calculateCost(model, estimatedUsage);

  try {
    const spendCheck = await checkAndIncrementSpending(agentId, merchantId, estimatedCost);
    if (!spendCheck.allowed) {
      throw Object.assign(
        new Error(`Daily spending limit reached. Spent today: ${spendCheck.spentToday.toFixed(2)}, limit: ${spendCheck.dailyLimit.toFixed(2)}`),
        { status: 429, spentToday: spendCheck.spentToday, dailyLimit: spendCheck.dailyLimit, remaining: spendCheck.remaining },
      );
    }
  } catch (spendErr: any) {
    if (spendErr?.status === 429) throw spendErr;
    // If spending_policies table doesn't exist, allow the request
    if (spendErr?.message?.includes('relation') && spendErr?.message?.includes('does not exist')) {
      logger.warn('spending_policies table not found, skipping policy check for LLM request');
    } else {
      throw spendErr;
    }
  }

  // 3. Build and forward request to LLM provider
  let providerReq: { url: string; headers: Record<string, string>; body: unknown };
  switch (provider) {
    case 'openai':
      providerReq = buildOpenAIRequest(req);
      break;
    case 'anthropic':
      providerReq = buildAnthropicRequest(req);
      break;
    case 'groq':
      providerReq = buildGroqRequest(req);
      break;
    default:
      throw Object.assign(new Error(`Unsupported provider: ${provider}`), { status: 400 });
  }

  const response = await fetch(providerReq.url, {
    method: 'POST',
    headers: providerReq.headers,
    body: JSON.stringify(providerReq.body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('LLM provider error', { provider, status: response.status, error: errorText });
    throw Object.assign(
      new Error(`LLM provider returned ${response.status}`),
      { status: 502 },
    );
  }

  const data = await response.json();

  // 4. Parse response based on provider
  let parsed: { content: string; usage: LLMTokenUsage; finishReason: string };
  if (provider === 'anthropic') {
    parsed = parseAnthropicResponse(data);
  } else {
    // OpenAI and Groq share the same response format
    parsed = parseOpenAIResponse(data);
  }

  // 5. Calculate actual cost and create billing intent
  const actualCost = calculateCost(model, parsed.usage);

  const intent = await createIntent({
    merchantId,
    amount: actualCost,
    currency: 'USDC',
    metadata: {
      agentId,
      type: 'llm_inference',
      provider,
      model,
      promptTokens: parsed.usage.promptTokens,
      completionTokens: parsed.usage.completionTokens,
      totalTokens: parsed.usage.totalTokens,
      ...(req.metadata || {}),
    },
  });

  // 6. Emit webhook if merchant has one configured
  const merchant = merchantResult.rows[0];
  if (merchant.webhook_url) {
    try {
      await enqueueWebhook(
        merchant.webhook_url,
        {
          event: 'llm.completion',
          merchantId,
          transactionId: intent.intentId,
          timestamp: new Date().toISOString(),
          agentId,
          provider,
          model,
          costUsd: actualCost,
          tokenUsage: parsed.usage,
        },
        merchantId,
        intent.intentId,
      );
    } catch (webhookErr) {
      logger.warn('Failed to enqueue LLM completion webhook', { err: webhookErr });
    }
  }

  logger.info('LLM request processed', {
    intentId: intent.intentId,
    merchantId,
    agentId,
    provider,
    model,
    costUsd: actualCost,
    tokens: parsed.usage.totalTokens,
  });

  return {
    id: intent.intentId,
    provider,
    model,
    content: parsed.content,
    usage: parsed.usage,
    costUsd: actualCost,
    intentId: intent.intentId,
    finishReason: parsed.finishReason,
  };
}

// ── Micropayment Logic ─────────────────────────────────────────────────────

/**
 * Processes a micropayment (e.g., $0.01 "boost" or "upvote").
 * Auto-approves small payments within the agent's daily spending policy limit.
 */
export async function processMicropayment(req: MicropaymentRequest): Promise<MicropaymentResult> {
  const { merchantId, agentId, amount, description, metadata } = req;

  // Validate merchant
  const merchantResult = await query(
    `SELECT id FROM merchants WHERE id = $1 AND is_active = true`,
    [merchantId],
  );

  if (merchantResult.rows.length === 0) {
    return { approved: false, amount, reason: 'Merchant not found or inactive' };
  }

  // Check spending policy
  try {
    const spendCheck = await checkAndIncrementSpending(agentId, merchantId, amount);
    if (!spendCheck.allowed) {
      return {
        approved: false,
        amount,
        reason: `Daily spending limit reached. Remaining: ${spendCheck.remaining.toFixed(2)} USDC`,
      };
    }
  } catch (spendErr: any) {
    if (spendErr?.message?.includes('relation') && spendErr?.message?.includes('does not exist')) {
      // No policy table — allow
    } else {
      throw spendErr;
    }
  }

  // Create billing intent
  const intent = await createIntent({
    merchantId,
    amount,
    currency: 'USDC',
    metadata: {
      agentId,
      type: 'micropayment',
      description,
      ...(metadata || {}),
    },
  });

  logger.info('Micropayment processed', {
    intentId: intent.intentId,
    merchantId,
    agentId,
    amount,
    description,
  });

  return {
    approved: true,
    intentId: intent.intentId,
    amount,
  };
}

// ── Supported Models ───────────────────────────────────────────────────────

/**
 * Returns the list of supported models with their pricing information.
 */
export function getSupportedModels(): Array<{
  provider: string;
  model: string;
  promptPricePer1k: number;
  completionPricePer1k: number;
}> {
  return Object.entries(TOKEN_PRICING).map(([model, pricing]) => {
    let provider = 'openai';
    if (model.startsWith('claude')) provider = 'anthropic';
    else if (model.startsWith('llama') || model.startsWith('mixtral')) provider = 'groq';

    return {
      provider,
      model,
      promptPricePer1k: pricing.prompt,
      completionPricePer1k: pricing.completion,
    };
  });
}

export default {
  processLLMRequest,
  processMicropayment,
  calculateCost,
  getSupportedModels,
};
