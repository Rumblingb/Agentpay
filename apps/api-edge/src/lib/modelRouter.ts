/**
 * Model Router — picks the best LLM for a given task type.
 *
 * Cost tiers (cheapest first):
 *   FREE  — CF Workers AI Llama 3.3 70B (included in Workers plan, no RPD limit)
 *   PAID  — Gemini 2.0 Flash (opt-in: set GEMINI_API_KEY + enable billing, ~$0.10/1M)
 *   CHEAP — Claude Haiku 4.5  ($0.80/$4 per 1M — simple turns)
 *   CHEAP — GPT-4o-mini       ($0.15/$0.60 per 1M — extraction fallback)
 *   FULL  — Claude Opus 4.6   ($15/$75 per 1M — complex reasoning only)
 *   FULL  — GPT-4o            ($5/$15 per 1M — code generation)
 *
 * Routing strategy (Gemini-free by default — no RPD limits):
 *   classify  → CF Workers AI Llama (free) → GPT-4o-mini → Haiku
 *   followup  → Claude Haiku (~$0.002/turn)
 *   extract   → CF Workers AI Llama (free) → GPT-4o-mini → Haiku
 *   extract-gemini → Gemini 2.0 Flash (opt-in, only if GEMINI_API_KEY set)
 *   reason    → Claude Opus (full power, only for booking decisions)
 *   code      → GPT-4o (best for structured output)
 *
 * Usage:
 *   const result = await routeToModel(c.env, 'extract', system, user);
 */

import type { Env } from '../types';

export type TaskType = 'reason' | 'followup' | 'extract' | 'extract-gemini' | 'classify' | 'code';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL    = 'https://api.openai.com/v1/chat/completions';
// Use gemini-2.0-flash for higher RPM/RPD limits vs 2.5-flash-lite (20 RPD free cap)
const GEMINI_URL    = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_OLLAMA_GENERAL_MODEL = 'qwen2.5:7b-instruct';
const DEFAULT_OLLAMA_REASON_MODEL = 'qwen2.5:14b-instruct';
const DEFAULT_OLLAMA_EXTRACT_MODEL = 'qwen2.5:7b-instruct';
const DEFAULT_OLLAMA_CLASSIFY_MODEL = 'qwen2.5:3b-instruct';
const DEFAULT_OPENAI_MINI_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_CODE_MODEL = 'gpt-4o';
const DEFAULT_ANTHROPIC_HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_ANTHROPIC_REASON_MODEL = 'claude-opus-4-6';
const DEFAULT_ANTHROPIC_CODE_MODEL = 'claude-opus-4-6';
const DEFAULT_KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
const DEFAULT_KIMI_GENERAL_MODEL = 'kimi-k2-0711-preview';
const DEFAULT_KIMI_REASON_MODEL = 'kimi-k2-0711-preview';

type RouterPolicy = 'cheap-first' | 'balanced' | 'quality-first';

type CachedRouteResult = {
  expiresAt: number;
  value: { model: string; output: string };
};

const routeCache = new Map<string, CachedRouteResult>();

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function parseRouterPolicy(value: string | undefined): RouterPolicy {
  if (value === 'balanced' || value === 'quality-first') return value;
  return 'cheap-first';
}

function getCacheTtlMs(env: Env): number {
  const raw = Number(env.LLM_CACHE_TTL_SECONDS ?? '900');
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw * 1000;
}

function shouldCacheTask(task: TaskType): boolean {
  return task === 'classify' || task === 'extract' || task === 'followup';
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildCacheKey(task: TaskType, system: string, user: string, maxTokens: number): string {
  return hashString(JSON.stringify({ task, system, user, maxTokens }));
}

function getCachedRoute(
  env: Env,
  task: TaskType,
  system: string,
  user: string,
  maxTokens: number,
): { model: string; output: string } | null {
  if (env.MODEL_ROUTER_DISABLE_CACHE === 'true' || !shouldCacheTask(task)) return null;
  const cacheKey = buildCacheKey(task, system, user, maxTokens);
  const hit = routeCache.get(cacheKey);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    routeCache.delete(cacheKey);
    return null;
  }
  return hit.value;
}

function setCachedRoute(
  env: Env,
  task: TaskType,
  system: string,
  user: string,
  maxTokens: number,
  value: { model: string; output: string },
): void {
  if (env.MODEL_ROUTER_DISABLE_CACHE === 'true' || !shouldCacheTask(task)) return;
  const ttlMs = getCacheTtlMs(env);
  if (ttlMs <= 0) return;
  routeCache.set(buildCacheKey(task, system, user, maxTokens), {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function getOpenAIMiniModel(env: Env): string {
  return env.OPENAI_MINI_MODEL || DEFAULT_OPENAI_MINI_MODEL;
}

function getOpenAICodeModel(env: Env): string {
  return env.OPENAI_CODE_MODEL || DEFAULT_OPENAI_CODE_MODEL;
}

function getAnthropicHaikuModel(env: Env): string {
  return env.ANTHROPIC_HAIKU_MODEL || DEFAULT_ANTHROPIC_HAIKU_MODEL;
}

function getAnthropicReasonModel(env: Env): string {
  return env.ANTHROPIC_REASON_MODEL || DEFAULT_ANTHROPIC_REASON_MODEL;
}

function getAnthropicCodeModel(env: Env): string {
  return env.ANTHROPIC_CODE_MODEL || DEFAULT_ANTHROPIC_CODE_MODEL;
}

function getOllamaConfig(env: Env): { baseUrl: string; apiKey?: string } | null {
  if (env.OLLAMA_DISABLE === 'true') return null;
  const rawBase = env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  return { baseUrl: normalizeBaseUrl(rawBase), apiKey: env.OLLAMA_API_KEY };
}

function getKimiConfig(env: Env): { baseUrl: string; apiKey: string } | null {
  if (!env.KIMI_API_KEY) return null;
  return {
    baseUrl: normalizeBaseUrl(env.KIMI_BASE_URL || DEFAULT_KIMI_BASE_URL),
    apiKey: env.KIMI_API_KEY,
  };
}

function getMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item && typeof (item as { text?: unknown }).text === 'string') {
          return (item as { text: string }).text;
        }
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

// ── Claude call ───────────────────────────────────────────────────────────────

async function callClaude(
  apiKey: string,
  system: string,
  user: string,
  maxTokens = 1024,
  model = DEFAULT_ANTHROPIC_REASON_MODEL,
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
  maxTokens = 512,
): Promise<string> {
  const result = await (ai as any).run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
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
  model = DEFAULT_OPENAI_CODE_MODEL,
  maxTokens = 1024,
): Promise<string> {
  return callOpenAICompatible({
    baseUrl: 'https://api.openai.com/v1',
    apiKey,
    system,
    user,
    model,
    maxTokens,
  });
}

async function callOpenAICompatible(opts: {
  baseUrl: string;
  apiKey?: string;
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  extraHeaders?: Record<string, string>;
}): Promise<string> {
  const url = `${normalizeBaseUrl(opts.baseUrl)}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.extraHeaders,
  };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  });
  const data = (await resp.json()) as any;
  return getMessageContent(data?.choices?.[0]?.message?.content);
}

async function callOllama(
  env: Env,
  system: string,
  user: string,
  model: string,
  maxTokens: number,
): Promise<string> {
  const config = getOllamaConfig(env);
  if (!config) return '';
  return callOpenAICompatible({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    system,
    user,
    model,
    maxTokens,
  });
}

async function callKimi(
  env: Env,
  system: string,
  user: string,
  model: string,
  maxTokens: number,
): Promise<string> {
  const config = getKimiConfig(env);
  if (!config) return '';
  return callOpenAICompatible({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    system,
    user,
    model,
    maxTokens,
  });
}

async function tryProviders(
  providers: Array<() => Promise<{ model: string; output: string } | null>>,
): Promise<{ model: string; output: string }> {
  let lastError: unknown = null;
  for (const provider of providers) {
    try {
      const result = await provider();
      if (result?.output) return result;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('No model available for task');
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
  const cached = getCachedRoute(env, task, system, user, maxTokens);
  if (cached) return { ...cached, model: `${cached.model} (cache)` };
  const policy = parseRouterPolicy(env.MODEL_ROUTER_POLICY);

  const finish = (result: { model: string; output: string }) => {
    setCachedRoute(env, task, system, user, maxTokens, result);
    return result;
  };

  switch (task) {

    // ── FREE: Workers AI Llama for classification ────────────────────────────
    case 'classify': {
      const providers: Array<() => Promise<{ model: string; output: string } | null>> = [];
      const ollamaModel = env.OLLAMA_CLASSIFY_MODEL || DEFAULT_OLLAMA_CLASSIFY_MODEL;

      if (policy !== 'quality-first') {
        providers.push(async () => {
          const output = await callOllama(env, system, user, ollamaModel, 64);
          return output ? { model: `ollama:${ollamaModel}`, output } : null;
        });
      }
      if (env.AI) {
        providers.push(async () => {
          const output = await callWorkersAI(env.AI!, system, user, 64);
          return output ? { model: 'llama-3.3-70b (workers-ai)', output } : null;
        });
      }
      if (env.KIMI_API_KEY && policy !== 'quality-first') {
        const kimiModel = env.KIMI_GENERAL_MODEL || DEFAULT_KIMI_GENERAL_MODEL;
        providers.push(async () => {
          const output = await callKimi(env, system, user, kimiModel, 64);
          return output ? { model: `kimi:${kimiModel}`, output } : null;
        });
      }
      if (env.OPENAI_API_KEY) {
        const model = getOpenAIMiniModel(env);
        providers.push(async () => {
          const output = await callOpenAI(env.OPENAI_API_KEY!, system, user, model, 32);
          return output ? { model, output } : null;
        });
      }
      if (env.ANTHROPIC_API_KEY) {
        const model = getAnthropicHaikuModel(env);
        providers.push(async () => {
          const output = await callClaude(env.ANTHROPIC_API_KEY!, system, user, 32, model);
          return output ? { model, output } : null;
        });
      }
      return finish(await tryProviders(providers));
    }

    // ── CHEAP: Claude Haiku for simple followup turns ────────────────────────
    case 'followup': {
      const providers: Array<() => Promise<{ model: string; output: string } | null>> = [];
      const ollamaModel = env.OLLAMA_GENERAL_MODEL || DEFAULT_OLLAMA_GENERAL_MODEL;
      if (policy === 'cheap-first') {
        providers.push(async () => {
          const output = await callOllama(env, system, user, ollamaModel, maxTokens);
          return output ? { model: `ollama:${ollamaModel}`, output } : null;
        });
      }
      if (env.KIMI_API_KEY && policy !== 'quality-first') {
        const model = env.KIMI_GENERAL_MODEL || DEFAULT_KIMI_GENERAL_MODEL;
        providers.push(async () => {
          const output = await callKimi(env, system, user, model, maxTokens);
          return output ? { model: `kimi:${model}`, output } : null;
        });
      }
      if (env.ANTHROPIC_API_KEY) {
        const model = getAnthropicHaikuModel(env);
        providers.push(async () => {
          const output = await callClaude(env.ANTHROPIC_API_KEY!, system, user, maxTokens, model);
          return output ? { model, output } : null;
        });
      }
      if (env.OPENAI_API_KEY && policy === 'quality-first') {
        const model = getOpenAIMiniModel(env);
        providers.push(async () => {
          const output = await callOpenAI(env.OPENAI_API_KEY!, system, user, model, maxTokens);
          return output ? { model, output } : null;
        });
      }
      return finish(await tryProviders(providers));
    }

    // ── FREE: CF Workers AI Llama for extraction (no RPD limit) ────────────
    case 'extract': {
      const providers: Array<() => Promise<{ model: string; output: string } | null>> = [];
      const ollamaModel = env.OLLAMA_EXTRACT_MODEL || DEFAULT_OLLAMA_EXTRACT_MODEL;
      if (policy !== 'quality-first') {
        providers.push(async () => {
          const output = await callOllama(env, system, user, ollamaModel, maxTokens);
          return output ? { model: `ollama:${ollamaModel}`, output } : null;
        });
      }
      if (env.AI) {
        providers.push(async () => {
          const output = await callWorkersAI(env.AI!, system, user, maxTokens);
          return output ? { model: 'llama-3.3-70b (workers-ai)', output } : null;
        });
      }
      if (env.KIMI_API_KEY && policy !== 'quality-first') {
        const model = env.KIMI_GENERAL_MODEL || DEFAULT_KIMI_GENERAL_MODEL;
        providers.push(async () => {
          const output = await callKimi(env, system, user, model, maxTokens);
          return output ? { model: `kimi:${model}`, output } : null;
        });
      }
      if (env.OPENAI_API_KEY) {
        const model = getOpenAIMiniModel(env);
        providers.push(async () => {
          const output = await callOpenAI(env.OPENAI_API_KEY!, system, user, model, maxTokens);
          return output ? { model, output } : null;
        });
      }
      if (env.ANTHROPIC_API_KEY) {
        const model = getAnthropicHaikuModel(env);
        providers.push(async () => {
          const output = await callClaude(env.ANTHROPIC_API_KEY!, system, user, maxTokens, model);
          return output ? { model, output } : null;
        });
      }
      return finish(await tryProviders(providers));
    }

    // ── OPT-IN: Gemini 2.0 Flash (paid billing, higher quality extraction) ──
    // Use this task type only after enabling Google AI billing — avoids free-tier RPD limits.
    case 'extract-gemini': {
      if (!env.GEMINI_API_KEY) {
        // Fall back to standard extract if key not set
        return routeToModel(env, 'extract', system, user, opts);
      }
      try {
        const output = await callGemini(env.GEMINI_API_KEY, system, user, maxTokens);
        if (output) return { model: 'gemini-2.0-flash', output };
      } catch { /* fall through */ }
      return routeToModel(env, 'extract', system, user, opts);
    }

    // ── FULL: GPT-4o for code generation ────────────────────────────────────
    case 'code': {
      if (env.OPENAI_API_KEY) {
        const model = getOpenAICodeModel(env);
        const output = await callOpenAI(env.OPENAI_API_KEY, system, user, model, maxTokens);
        return { model, output };
      }
      if (env.ANTHROPIC_API_KEY) {
        const model = getAnthropicCodeModel(env);
        const output = await callClaude(env.ANTHROPIC_API_KEY, system, user, maxTokens, model);
        return { model, output };
      }
      const kimiModel = env.KIMI_REASON_MODEL || DEFAULT_KIMI_REASON_MODEL;
      if (env.KIMI_API_KEY && policy !== 'quality-first') {
        const output = await callKimi(env, system, user, kimiModel, maxTokens);
        return { model: `kimi:${kimiModel}`, output };
      }
      throw new Error('No model available for code');
    }

    // ── FULL: Claude Opus for complex booking reasoning ──────────────────────
    case 'reason': {
      const providers: Array<() => Promise<{ model: string; output: string } | null>> = [];
      if (policy === 'cheap-first' || policy === 'balanced') {
        const ollamaModel = env.OLLAMA_REASON_MODEL || DEFAULT_OLLAMA_REASON_MODEL;
        providers.push(async () => {
          const output = await callOllama(env, system, user, ollamaModel, maxTokens);
          return output ? { model: `ollama:${ollamaModel}`, output } : null;
        });
      }
      if (env.KIMI_API_KEY) {
        const model = env.KIMI_REASON_MODEL || DEFAULT_KIMI_REASON_MODEL;
        providers.push(async () => {
          const output = await callKimi(env, system, user, model, maxTokens);
          return output ? { model: `kimi:${model}`, output } : null;
        });
      }
      if (env.ANTHROPIC_API_KEY) {
        const model = getAnthropicReasonModel(env);
        providers.push(async () => {
          const output = await callClaude(env.ANTHROPIC_API_KEY!, system, user, maxTokens, model);
          return output ? { model, output } : null;
        });
      }
      if (env.OPENAI_API_KEY && policy === 'quality-first') {
        const model = getOpenAICodeModel(env);
        providers.push(async () => {
          const output = await callOpenAI(env.OPENAI_API_KEY!, system, user, model, maxTokens);
          return output ? { model, output } : null;
        });
      }
      return await tryProviders(providers);
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
