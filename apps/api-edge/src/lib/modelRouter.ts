/**
 * Model Router — picks the best LLM for a given task type.
 *
 * Cost tiers (cheapest first):
 *   FREE  — CF Workers AI Llama 3.3 70B (included in Workers plan)
 *   FREE  — Gemini 1.5 Flash (Google AI Studio: 1,500 req/day free)
 *   CHEAP — Claude Haiku 4.5  ($0.80/$4 per 1M — simple turns)
 *   CHEAP — GPT-4o-mini       ($0.15/$0.60 per 1M — extraction)
 *   FULL  — Claude Opus 4.6   ($15/$75 per 1M — complex reasoning only)
 *   FULL  — GPT-4o            ($5/$15 per 1M — structured extraction)
 *
 * Routing strategy:
 *   classify  → CF Workers AI Llama (free) → GPT-4o-mini fallback
 *   followup  → Claude Haiku (cheap: ~$0.002/turn)
 *   extract   → GPT-4o-mini or Gemini Flash (cheap/free)
 *   reason    → Claude Opus (full power, only for booking decisions)
 *   code      → GPT-4o (best for structured output)
 *
 * Usage:
 *   const result = await routeToModel(c.env, 'extract', system, user);
 */

import type { Env } from '../types';

export type TaskType = 'reason' | 'followup' | 'extract' | 'classify' | 'code';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL    = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL    = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// ── Claude call ───────────────────────────────────────────────────────────────

async function callClaude(
  apiKey: string,
  system: string,
  user: string,
  maxTokens = 1024,
  model: 'claude-opus-4-6' | 'claude-haiku-4-5-20251001' = 'claude-opus-4-6',
): Promise<string> {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const data = (await resp.json()) as any;
  return data?.content?.[0]?.text ?? '';
}

// ── CF Workers AI call (free — included in Workers plan) ─────────────────────

async function callWorkersAI(
  ai: Ai,
  system: string,
  user: string,
): Promise<string> {
  const result = await (ai as any).run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 256,
  }) as { response?: string };
  return result?.response ?? '';
}

// ── Gemini Flash call (free tier: 1,500 req/day) ──────────────────────────────

async function callGemini(
  apiKey: string,
  system: string,
  user: string,
  maxTokens = 512,
): Promise<string> {
  const resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  const data = (await resp.json()) as any;
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ── OpenAI call ───────────────────────────────────────────────────────────────

async function callOpenAI(
  apiKey: string,
  system: string,
  user: string,
  model: 'gpt-4o' | 'gpt-4o-mini' = 'gpt-4o',
  maxTokens = 1024,
): Promise<string> {
  const resp = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const data = (await resp.json()) as any;
  return data?.choices?.[0]?.message?.content ?? '';
}

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Route a prompt to the appropriate model based on task type.
 *
 * Cost order per task:
 *   classify  → Workers AI Llama (free) → GPT-4o-mini → Claude Haiku
 *   followup  → Claude Haiku (~$0.002) → Claude Opus fallback
 *   extract   → Gemini Flash (free) → GPT-4o-mini → Claude Haiku
 *   code      → GPT-4o → Claude Opus fallback
 *   reason    → Claude Opus (no substitute for complex booking logic)
 */
export async function routeToModel(
  env: Env,
  task: TaskType,
  system: string,
  user: string,
  opts: { maxTokens?: number } = {},
): Promise<{ model: string; output: string }> {
  const maxTokens = opts.maxTokens ?? 1024;

  switch (task) {

    // ── FREE: Workers AI Llama for classification ────────────────────────────
    case 'classify': {
      if (env.AI) {
        try {
          const output = await callWorkersAI(env.AI, system, user);
          if (output) return { model: 'llama-3.3-70b (workers-ai)', output };
        } catch { /* fall through */ }
      }
      if (env.OPENAI_API_KEY) {
        const output = await callOpenAI(env.OPENAI_API_KEY, system, user, 'gpt-4o-mini', 32);
        return { model: 'gpt-4o-mini', output };
      }
      if (env.ANTHROPIC_API_KEY) {
        const output = await callClaude(env.ANTHROPIC_API_KEY, system, user, 32, 'claude-haiku-4-5-20251001');
        return { model: 'claude-haiku-4-5', output };
      }
      throw new Error('No model available for classify');
    }

    // ── CHEAP: Claude Haiku for simple followup turns ────────────────────────
    case 'followup': {
      if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
      const output = await callClaude(env.ANTHROPIC_API_KEY, system, user, maxTokens, 'claude-haiku-4-5-20251001');
      return { model: 'claude-haiku-4-5', output };
    }

    // ── FREE→CHEAP: Gemini Flash → GPT-4o-mini for extraction ───────────────
    case 'extract': {
      if (env.GEMINI_API_KEY) {
        try {
          const output = await callGemini(env.GEMINI_API_KEY, system, user, maxTokens);
          if (output) return { model: 'gemini-1.5-flash', output };
        } catch { /* fall through */ }
      }
      if (env.OPENAI_API_KEY) {
        const output = await callOpenAI(env.OPENAI_API_KEY, system, user, 'gpt-4o-mini', maxTokens);
        return { model: 'gpt-4o-mini', output };
      }
      if (env.ANTHROPIC_API_KEY) {
        const output = await callClaude(env.ANTHROPIC_API_KEY, system, user, maxTokens, 'claude-haiku-4-5-20251001');
        return { model: 'claude-haiku-4-5 (fallback)', output };
      }
      throw new Error('No model available for extract');
    }

    // ── FULL: GPT-4o for code generation ────────────────────────────────────
    case 'code': {
      if (env.OPENAI_API_KEY) {
        const output = await callOpenAI(env.OPENAI_API_KEY, system, user, 'gpt-4o', maxTokens);
        return { model: 'gpt-4o', output };
      }
      if (!env.ANTHROPIC_API_KEY) throw new Error('Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY set');
      const output = await callClaude(env.ANTHROPIC_API_KEY, system, user, maxTokens);
      return { model: 'claude-opus-4-6 (fallback)', output };
    }

    // ── FULL: Claude Opus for complex booking reasoning ──────────────────────
    case 'reason': {
      if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
      const output = await callClaude(env.ANTHROPIC_API_KEY, system, user, maxTokens);
      return { model: 'claude-opus-4-6', output };
    }

    default:
      throw new Error(`Unknown task type: ${task}`);
  }
}

/**
 * Classify a user utterance into a task category.
 * Used at the start of /api/concierge/intent to pick the best model for the full response.
 *
 * Returns: "book_train" | "query_info" | "followup" | "cancel" | "other"
 */
export async function classifyIntent(env: Env, transcript: string): Promise<string> {
  if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY) return 'other';

  const { output } = await routeToModel(
    env,
    'classify',
    'You classify travel booking requests. Reply with exactly one word: book_train, query_info, followup, cancel, or other.',
    transcript,
    { maxTokens: 10 },
  );
  return output.trim().toLowerCase().replace(/[^a-z_]/g, '') || 'other';
}
