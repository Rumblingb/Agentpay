import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env, Variables } from '../src/types';
import {
  compileCommerceDecision,
  signCommerceCompilation,
  type CommerceCompilationPacket,
} from '../src/lib/commerceDecisionCompiler';
import { discoverProducts } from '../src/lib/productDiscovery';
import { commerceRouter } from '../src/routes/commerce';

const now = new Date('2026-07-18T12:00:00.000Z');
const product = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  merchantId: `merchant_${id}`,
  merchantName: `Merchant ${id}`,
  title: `Product ${id}`,
  priceMinor: 7_500,
  currency: 'GBP',
  availability: 'in_stock',
  checkoutUrl: `https://merchant.example/checkout/${id}`,
  imageUrl: `https://merchant.example/images/${id}.png`,
  deliveryDays: 2,
  returnWindowDays: 45,
  catalogUpdatedAt: new Date(now.getTime() - 10 * 60_000).toISOString(),
  truthScore: 95,
  qualityScore: 90,
  needSignals: [{ need: 'rain-ready-commute', score: 90 }],
  sponsored: false,
  ...overrides,
});

const request = {
  need: 'rain-ready-commute',
  budgetMinor: 15_000,
  currency: 'GBP',
  maxDeliveryDays: 3,
  minReturnDays: 30,
  maxEvidenceAgeMinutes: 60,
  products: [
    product('alpha'),
    product('beta', { needSignals: [{ need: 'rain-ready-commute', score: 84 }] }),
  ],
};

const context = { budgetMinor: 15_000, currency: 'GBP', maxDeliveryDays: 3, minReturnDays: 30 };

afterEach(() => vi.unstubAllGlobals());

function responseFor(output: unknown) {
  return new Response(JSON.stringify({
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('GPT-5.6 commerce decision compiler', () => {
  it('accepts only a closed-world ranking over policy-eligible candidates', async () => {
    const report = discoverProducts(request, now);
    let requestBody = '';
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return responseFor({
        selectedCandidateRef: 'candidate_2',
        alternateCandidateRef: 'candidate_1',
        confidence: 'medium',
        ranking: [
          { candidateRef: 'candidate_2', rationaleCodes: ['balanced_choice', 'budget_fit'] },
          { candidateRef: 'candidate_1', rationaleCodes: ['strongest_need_fit'] },
        ],
      });
    });

    const result = await compileCommerceDecision(report, context, {
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_COMMERCE_MODEL: 'gpt-5.6',
    } as Env, { fetchImpl });

    expect(result).toMatchObject({
      source: 'gpt-5.6-verified',
      model: 'gpt-5.6',
      selectedProductId: 'beta',
      fallbackReason: null,
    });
    const payload = JSON.parse(requestBody);
    expect(payload.store).toBe(false);
    expect(payload.text.format).toMatchObject({ type: 'json_schema', strict: true });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('checkout/');
    expect(serialized).not.toContain('sponsored');
    expect(serialized).not.toContain('Merchant alpha');
    expect(serialized).not.toContain('Product alpha');
    expect(serialized).not.toContain('merchant_alpha');
    expect(serialized).not.toContain('"alpha"');
  });

  it('rejects invented products and falls back to deterministic order', async () => {
    const report = discoverProducts(request, now);
    const result = await compileCommerceDecision(report, context, { OPENAI_API_KEY: 'test-openai-key' } as Env, {
      fetchImpl: vi.fn(async () => responseFor({
        selectedCandidateRef: 'candidate_404',
        alternateCandidateRef: 'candidate_1',
        confidence: 'high',
        ranking: [
          { candidateRef: 'candidate_404', rationaleCodes: ['balanced_choice'] },
          { candidateRef: 'candidate_1', rationaleCodes: ['strongest_need_fit'] },
        ],
      })),
    });

    expect(result).toMatchObject({
      source: 'deterministic',
      selectedProductId: 'alpha',
      fallbackReason: 'invalid_model_output',
    });
  });

  it('falls back without a provider key or eligible product', async () => {
    const report = discoverProducts(request, now);
    await expect(compileCommerceDecision(report, context, {} as Env)).resolves.toMatchObject({
      source: 'deterministic',
      fallbackReason: 'not_configured',
    });
    const empty = discoverProducts({ ...request, budgetMinor: 100 }, now);
    await expect(compileCommerceDecision(empty, { ...context, budgetMinor: 100 }, {} as Env)).resolves.toMatchObject({
      selectedProductId: null,
      fallbackReason: 'no_eligible_products',
    });
  });

  it('fails safely on provider errors and ignores unsupported model configuration', async () => {
    const report = discoverProducts(request, now);
    let requestBody = '';
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return new Response('upstream detail must stay private', { status: 429 });
    });
    const result = await compileCommerceDecision(report, context, {
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_COMMERCE_MODEL: 'untrusted-model',
    } as Env, { fetchImpl });

    expect(result).toMatchObject({ source: 'deterministic', model: null, fallbackReason: 'provider_error' });
    const payload = JSON.parse(requestBody);
    expect(payload.model).toBe('gpt-5.6');
  });

  it('falls back deterministically when the provider exceeds its deadline', async () => {
    const report = discoverProducts(request, now);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    await expect(compileCommerceDecision(report, context, { OPENAI_API_KEY: 'test-openai-key' } as Env, {
      fetchImpl,
      timeoutMs: 1,
    })).resolves.toMatchObject({
      source: 'deterministic',
      selectedProductId: 'alpha',
      fallbackReason: 'timeout',
    });
  });

  it('signs the complete discovery and compilation packet', async () => {
    const discovery = discoverProducts(request, now);
    const compilation = await compileCommerceDecision(discovery, context, {} as Env);
    const packet: CommerceCompilationPacket = {
      schema: 'agentpay.commerce-compilation-packet/1.0',
      discovery,
      compilation,
    };
    const signature = await signCommerceCompilation(packet, 'commerce-compiler-secret-long-enough');
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('serves an authenticated signed packet through the canonical route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFor({
      selectedCandidateRef: 'candidate_1',
      alternateCandidateRef: 'candidate_2',
      confidence: 'high',
      ranking: [
        { candidateRef: 'candidate_1', rationaleCodes: ['strongest_need_fit'] },
        { candidateRef: 'candidate_2', rationaleCodes: ['budget_fit'] },
      ],
    })));
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.route('/api/commerce', commerceRouter);

    const response = await app.request('/api/commerce/compile', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk_test_sim',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...request, maxEvidenceAgeMinutes: 24 * 60 }),
    }, {
      AGENTPAY_TEST_MODE: 'true',
      OPENAI_API_KEY: 'test-openai-key',
      AGENTPAY_SIGNING_SECRET: 'commerce-route-signing-secret-long-enough',
    } as Env);

    expect(response.status).toBe(200);
    const body = await response.json() as {
      packet: CommerceCompilationPacket;
      signature: { value: string };
    };
    expect(body.packet.compilation).toMatchObject({
      source: 'gpt-5.6-verified',
      selectedProductId: 'alpha',
    });
    expect(body.signature.value).toMatch(/^[a-f0-9]{64}$/);
  });
});
