import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routeToModel } from '../src/lib/modelRouter';

describe('modelRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers Ollama for extract and serves repeat calls from cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: '{"from":"Paris","to":"Lyon"}' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = {
      MODEL_ROUTER_POLICY: 'cheap-first',
      LLM_CACHE_TTL_SECONDS: '900',
      OLLAMA_BASE_URL: 'http://ollama.local:11434/v1',
      OLLAMA_EXTRACT_MODEL: 'qwen2.5:7b-instruct',
    } as never;

    const first = await routeToModel(env, 'extract', 'Extract JSON', 'Paris to Lyon tomorrow', { maxTokens: 128 });
    const second = await routeToModel(env, 'extract', 'Extract JSON', 'Paris to Lyon tomorrow', { maxTokens: 128 });

    expect(first.model).toBe('ollama:qwen2.5:7b-instruct');
    expect(second.model).toBe('ollama:qwen2.5:7b-instruct (cache)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to Anthropic reasoning when cheap local inference fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('http://ollama.local:11434')) {
        throw new Error('connection refused');
      }
      if (url === 'https://api.anthropic.com/v1/messages') {
        return {
          json: async () => ({
            content: [{ text: 'Use the hosted fallback for this decision.' }],
          }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = {
      OLLAMA_BASE_URL: 'http://ollama.local:11434/v1',
      OLLAMA_REASON_MODEL: 'qwen2.5:14b-instruct',
      ANTHROPIC_API_KEY: 'test-ant-key',
      ANTHROPIC_REASON_MODEL: 'claude-opus-4-6',
    } as never;

    const result = await routeToModel(env, 'reason', 'Reason carefully', 'What is the best next action?', { maxTokens: 256 });

    expect(result.model).toBe('claude-opus-4-6');
    expect(result.output).toContain('hosted fallback');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses configured OpenAI code model for code tasks', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'export const ok = true;' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = {
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_CODE_MODEL: 'gpt-4o',
    } as never;

    const result = await routeToModel(env, 'code', 'Write code', 'return a boolean constant', { maxTokens: 128 });

    expect(result.model).toBe('gpt-4o');
    expect(result.output).toContain('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
