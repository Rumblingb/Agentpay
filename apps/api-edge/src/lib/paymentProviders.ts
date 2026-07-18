import type { Env } from '../types';

export type PaymentProvider = 'stripe' | 'airwallex' | 'visa_cybersource' | 'x402';
export type PaymentState =
  | 'created'
  | 'requires_action'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type PaymentRequest = {
  provider: PaymentProvider;
  amountMinor: number;
  currency: string;
  merchantId: string;
  agentId: string;
  idempotencyKey: string;
  description: string;
  successUrl?: string;
  cancelUrl?: string;
  network?: string;
  asset?: string;
  recipient?: string;
  metadata?: Record<string, string>;
};

export type PaymentResult = {
  provider: PaymentProvider;
  providerReference: string;
  state: PaymentState;
  amountMinor: number;
  currency: string;
  actionUrl?: string;
  clientSecret?: string;
  paymentRequirements?: {
    scheme: 'x402';
    network: string;
    asset: string;
    recipient: string;
    amountMinor: number;
  };
};

export type PaymentPolicy = {
  enabled: boolean;
  maxAmountMinor: number;
  maxDailyAmountMinor: number;
  allowedProviders: PaymentProvider[];
  allowedCurrencies: string[];
  allowedAgents: string[];
  allowedRedirectHosts: string[];
  allowedRecipients: string[];
  allowedNetworks: string[];
  allowedAssets: string[];
};

export type PolicyContext = {
  dailyAmountMinor: number;
};

export type ProviderStatus = {
  provider: PaymentProvider;
  configured: boolean;
  mode: 'sandbox' | 'live';
  liveEnabled: boolean;
  reason?: string;
};

export class PaymentProviderError extends Error {
  public readonly code:
    | 'INVALID_REQUEST'
    | 'POLICY_DENIED'
    | 'PROVIDER_NOT_CONFIGURED'
    | 'LIVE_MODE_DISABLED'
    | 'PROVIDER_UNAVAILABLE'
    | 'PROVIDER_REJECTED';

  constructor(
    code:
      | 'INVALID_REQUEST'
      | 'POLICY_DENIED'
      | 'PROVIDER_NOT_CONFIGURED'
      | 'LIVE_MODE_DISABLED'
      | 'PROVIDER_UNAVAILABLE'
      | 'PROVIDER_REJECTED',
    message: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
    this.code = code;
  }
}

type Fetcher = typeof fetch;

const CURRENCY_EXPONENTS: Record<string, number> = {
  AUD: 2,
  CAD: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  INR: 2,
  JPY: 0,
  SGD: 2,
  USD: 2,
};

const PROVIDERS: PaymentProvider[] = ['stripe', 'airwallex', 'visa_cybersource', 'x402'];
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_TIMEOUT_MS = 10_000;

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', 'Payment response encryption key must be base64url');
  }
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', 'Payment response encryption key is invalid');
  }
}

function paymentResponseEncryptionBytes(env: Env): Uint8Array {
  const encoded = env.AGENTPAY_PAYMENT_RESPONSE_ENCRYPTION_KEY;
  if (!encoded) {
    throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', 'Payment response encryption key is required');
  }
  const bytes = base64UrlBytes(encoded);
  if (bytes.length !== 32) {
    throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', 'Payment response encryption key must decode to 32 bytes');
  }
  return bytes;
}

function hasPaymentResponseEncryptionKey(env: Env): boolean {
  try {
    paymentResponseEncryptionBytes(env);
    return true;
  } catch {
    return false;
  }
}

async function paymentResponseEncryptionKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    paymentResponseEncryptionBytes(env),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

export type SensitivePaymentResponse = Pick<PaymentResult, 'actionUrl' | 'clientSecret'>;

export async function encryptSensitivePaymentResponse(
  env: Env,
  value: SensitivePaymentResponse,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await paymentResponseEncryptionKey(env),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

export async function decryptSensitivePaymentResponse(
  env: Env,
  value: string,
): Promise<SensitivePaymentResponse> {
  const [encodedIv, encodedPayload, extra] = value.split('.');
  if (!encodedIv || !encodedPayload || extra) {
    throw new PaymentProviderError('PROVIDER_REJECTED', 'Stored payment response is invalid');
  }
  const iv = base64UrlBytes(encodedIv);
  if (iv.length !== 12) {
    throw new PaymentProviderError('PROVIDER_REJECTED', 'Stored payment response nonce is invalid');
  }
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      await paymentResponseEncryptionKey(env),
      base64UrlBytes(encodedPayload),
    );
    const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    const response = parsed as Record<string, unknown>;
    if (
      (response.actionUrl !== undefined && typeof response.actionUrl !== 'string')
      || (response.clientSecret !== undefined && typeof response.clientSecret !== 'string')
    ) {
      throw new Error('unexpected fields');
    }
    return {
      ...(typeof response.actionUrl === 'string' ? { actionUrl: response.actionUrl } : {}),
      ...(typeof response.clientSecret === 'string' ? { clientSecret: response.clientSecret } : {}),
    };
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError('PROVIDER_REJECTED', 'Stored payment response cannot be decrypted');
  }
}

export function paymentReservationLockKeys(
  merchantId: string,
  idempotencyKey: string,
  currency: string,
): { idempotency: string; dailyLimit: string } {
  return {
    idempotency: `payment:idempotency:${merchantId}:${idempotencyKey}`,
    dailyLimit: `payment:daily-limit:${merchantId}:${currency}`,
  };
}

function configuredMode(env: Env): 'sandbox' | 'live' {
  return env.AGENTPAY_PAYMENT_MODE === 'live' ? 'live' : 'sandbox';
}

function stripeKeyMatchesMode(env: Env): boolean {
  const key = env.STRIPE_SECRET_KEY ?? '';
  return configuredMode(env) === 'live'
    ? /^(sk|rk)_live_/.test(key)
    : /^(sk|rk)_test_/.test(key);
}

export function assertPaymentModeAllowed(env: Env): void {
  if (configuredMode(env) === 'live' && env.AGENTPAY_LIVE_PAYMENTS_ENABLED !== 'true') {
    throw new PaymentProviderError('LIVE_MODE_DISABLED', 'Live payments are disabled');
  }
}

function assertHttpsUrl(value: string | undefined, field: string, allowedHosts: string[]): string {
  if (!value) throw new PaymentProviderError('INVALID_REQUEST', `${field} is required`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PaymentProviderError('INVALID_REQUEST', `${field} must be an absolute URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new PaymentProviderError('INVALID_REQUEST', `${field} must be a credential-free HTTPS URL`);
  }
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new PaymentProviderError('POLICY_DENIED', `${field} host is not allowlisted`);
  }
  return parsed.toString();
}

function validateRequest(request: PaymentRequest): void {
  if (!PROVIDERS.includes(request.provider)) {
    throw new PaymentProviderError('INVALID_REQUEST', 'Unsupported provider');
  }
  if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) {
    throw new PaymentProviderError('INVALID_REQUEST', 'amountMinor must be a positive safe integer');
  }
  if (!/^[A-Z]{3}$/.test(request.currency)) {
    throw new PaymentProviderError('INVALID_REQUEST', 'currency must be an uppercase ISO 4217 code');
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(request.idempotencyKey)) {
    throw new PaymentProviderError('INVALID_REQUEST', 'idempotencyKey must be 8-128 safe characters');
  }
  if (!IDENTIFIER_PATTERN.test(request.merchantId) || !IDENTIFIER_PATTERN.test(request.agentId)) {
    throw new PaymentProviderError('INVALID_REQUEST', 'merchantId and agentId must be safe identifiers');
  }
  if (!request.description.trim() || request.description.length > 200) {
    throw new PaymentProviderError('INVALID_REQUEST', 'description must be 1-200 characters');
  }
  const metadataEntries = Object.entries(request.metadata ?? {});
  if (metadataEntries.length > 16) {
    throw new PaymentProviderError('INVALID_REQUEST', 'metadata supports at most 16 entries');
  }
  for (const [key, value] of metadataEntries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(key) || typeof value !== 'string' || value.length > 256) {
      throw new PaymentProviderError('INVALID_REQUEST', 'metadata keys or values exceed safe limits');
    }
  }
}

export async function fingerprintPaymentRequest(request: PaymentRequest): Promise<string> {
  validateRequest(request);
  const metadata = Object.fromEntries(
    Object.entries(request.metadata ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
  const canonical = JSON.stringify({
    provider: request.provider,
    amountMinor: request.amountMinor,
    currency: request.currency,
    merchantId: request.merchantId,
    agentId: request.agentId,
    idempotencyKey: request.idempotencyKey,
    description: request.description,
    successUrl: request.successUrl ?? null,
    cancelUrl: request.cancelUrl ?? null,
    network: request.network ?? null,
    asset: request.asset ?? null,
    recipient: request.recipient ?? null,
    metadata,
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function defaultPaymentPolicy(env: Env): PaymentPolicy {
  const allowedProviders = csv(env.AGENTPAY_ALLOWED_PAYMENT_PROVIDERS)
    .filter((provider): provider is PaymentProvider => PROVIDERS.includes(provider as PaymentProvider));
  return {
    enabled: env.AGENTPAY_PAYMENTS_ENABLED === 'true',
    maxAmountMinor: Number(env.AGENTPAY_MAX_PAYMENT_MINOR ?? '10000'),
    maxDailyAmountMinor: Number(env.AGENTPAY_MAX_DAILY_PAYMENT_MINOR ?? '50000'),
    allowedProviders,
    allowedCurrencies: csv(env.AGENTPAY_ALLOWED_PAYMENT_CURRENCIES).map((value) => value.toUpperCase()),
    allowedAgents: csv(env.AGENTPAY_ALLOWED_PAYMENT_AGENTS),
    allowedRedirectHosts: csv(env.AGENTPAY_ALLOWED_PAYMENT_REDIRECT_HOSTS).map((value) => value.toLowerCase()),
    allowedRecipients: csv(env.AGENTPAY_ALLOWED_CRYPTO_RECIPIENTS),
    allowedNetworks: csv(env.AGENTPAY_ALLOWED_CRYPTO_NETWORKS),
    allowedAssets: csv(env.AGENTPAY_ALLOWED_CRYPTO_ASSETS),
  };
}

export function enforcePaymentPolicy(
  request: PaymentRequest,
  policy: PaymentPolicy,
  context: PolicyContext,
): void {
  validateRequest(request);
  if (!policy.enabled) throw new PaymentProviderError('POLICY_DENIED', 'Payments are disabled by policy');
  if (!Number.isSafeInteger(policy.maxAmountMinor) || request.amountMinor > policy.maxAmountMinor) {
    throw new PaymentProviderError('POLICY_DENIED', 'Per-payment amount limit exceeded');
  }
  if (
    !Number.isSafeInteger(context.dailyAmountMinor)
    || context.dailyAmountMinor < 0
    || !Number.isSafeInteger(policy.maxDailyAmountMinor)
    || context.dailyAmountMinor + request.amountMinor > policy.maxDailyAmountMinor
  ) {
    throw new PaymentProviderError('POLICY_DENIED', 'Daily amount limit exceeded');
  }
  if (!policy.allowedProviders.includes(request.provider)) {
    throw new PaymentProviderError('POLICY_DENIED', 'Provider is not allowlisted');
  }
  if (!policy.allowedCurrencies.includes(request.currency)) {
    throw new PaymentProviderError('POLICY_DENIED', 'Currency is not allowlisted');
  }
  if (policy.allowedAgents.length && !policy.allowedAgents.includes(request.agentId)) {
    throw new PaymentProviderError('POLICY_DENIED', 'Agent is not allowlisted');
  }
  if (request.provider === 'stripe') {
    assertHttpsUrl(request.successUrl, 'successUrl', policy.allowedRedirectHosts);
    assertHttpsUrl(request.cancelUrl, 'cancelUrl', policy.allowedRedirectHosts);
  }
  if (request.provider === 'x402') {
    if (!request.network || !policy.allowedNetworks.includes(request.network)) {
      throw new PaymentProviderError('POLICY_DENIED', 'Crypto network is not allowlisted');
    }
    if (!request.asset || !policy.allowedAssets.includes(request.asset)) {
      throw new PaymentProviderError('POLICY_DENIED', 'Crypto asset is not allowlisted');
    }
    if (!request.recipient || !policy.allowedRecipients.includes(request.recipient)) {
      throw new PaymentProviderError('POLICY_DENIED', 'Crypto recipient is not allowlisted');
    }
  }
}

export function minorToMajor(amountMinor: number, currency: string): string {
  const exponent = CURRENCY_EXPONENTS[currency];
  if (exponent === undefined) {
    throw new PaymentProviderError('INVALID_REQUEST', `Unsupported currency exponent: ${currency}`);
  }
  const divisor = 10 ** exponent;
  const whole = Math.floor(amountMinor / divisor);
  const fraction = amountMinor % divisor;
  return exponent === 0 ? String(whole) : `${whole}.${String(fraction).padStart(exponent, '0')}`;
}

async function fetchWithTimeout(
  fetcher: Fetcher,
  input: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch {
    throw new PaymentProviderError('PROVIDER_UNAVAILABLE', 'Payment provider request failed');
  } finally {
    clearTimeout(timer);
  }
}

async function deterministicRequestUuid(idempotencyKey: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(idempotencyKey)),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function providerStatus(env: Env, provider: PaymentProvider): ProviderStatus {
  const mode = configuredMode(env);
  const liveEnabled = mode === 'live' && env.AGENTPAY_LIVE_PAYMENTS_ENABLED === 'true';
  switch (provider) {
    case 'stripe':
      return {
        provider,
        configured: Boolean(
          env.STRIPE_SECRET_KEY
          && stripeKeyMatchesMode(env)
          && env.STRIPE_PROVIDER_WEBHOOK_SECRET
          && hasPaymentResponseEncryptionKey(env)
          && csv(env.AGENTPAY_ALLOWED_PAYMENT_REDIRECT_HOSTS).length,
        ),
        mode,
        liveEnabled,
        ...(!env.STRIPE_SECRET_KEY || !stripeKeyMatchesMode(env) || !env.STRIPE_PROVIDER_WEBHOOK_SECRET
          || !hasPaymentResponseEncryptionKey(env)
          || !csv(env.AGENTPAY_ALLOWED_PAYMENT_REDIRECT_HOSTS).length
          ? { reason: 'Mode-matched Stripe key, dedicated provider webhook secret, response encryption key, and redirect allowlist are required' }
          : {}),
      };
    case 'airwallex':
      return {
        provider,
        configured: Boolean(
          env.AIRWALLEX_CLIENT_ID
          && env.AIRWALLEX_API_KEY
          && env.AIRWALLEX_PROVIDER_WEBHOOK_SECRET
          && hasPaymentResponseEncryptionKey(env),
        ),
        mode,
        liveEnabled,
        ...(!env.AIRWALLEX_CLIENT_ID || !env.AIRWALLEX_API_KEY || !env.AIRWALLEX_PROVIDER_WEBHOOK_SECRET
          || !hasPaymentResponseEncryptionKey(env)
          ? { reason: 'Airwallex API credentials, dedicated provider webhook secret, and response encryption key are required' }
          : {}),
      };
    case 'visa_cybersource':
      return {
        provider,
        configured: false,
        mode,
        liveEnabled: false,
        reason: 'Visa Acceptance/Cybersource merchant enablement and an approved integration are required',
      };
    case 'x402':
      return {
        provider,
        configured: csv(env.AGENTPAY_ALLOWED_CRYPTO_NETWORKS).length > 0
          && csv(env.AGENTPAY_ALLOWED_CRYPTO_ASSETS).length > 0
          && csv(env.AGENTPAY_ALLOWED_CRYPTO_RECIPIENTS).length > 0,
        mode,
        liveEnabled,
        ...(csv(env.AGENTPAY_ALLOWED_CRYPTO_NETWORKS).length === 0
          ? { reason: 'Crypto network, asset, and recipient allowlists are required' }
          : {}),
      };
    default: {
      const exhaustive: never = provider;
      return exhaustive;
    }
  }
}

export function getPaymentProviderStatuses(env: Env): ProviderStatus[] {
  return PROVIDERS.map((provider) => providerStatus(env, provider));
}

async function createStripePayment(
  env: Env,
  request: PaymentRequest,
  policy: PaymentPolicy,
  fetcher: Fetcher,
): Promise<PaymentResult> {
  if (
    !env.STRIPE_SECRET_KEY
    || !stripeKeyMatchesMode(env)
    || !env.STRIPE_PROVIDER_WEBHOOK_SECRET
    || !hasPaymentResponseEncryptionKey(env)
  ) {
    throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', 'Stripe is not configured');
  }
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': request.currency.toLowerCase(),
    'line_items[0][price_data][product_data][name]': request.description,
    'line_items[0][price_data][unit_amount]': String(request.amountMinor),
    'line_items[0][quantity]': '1',
    success_url: assertHttpsUrl(request.successUrl, 'successUrl', policy.allowedRedirectHosts),
    cancel_url: assertHttpsUrl(request.cancelUrl, 'cancelUrl', policy.allowedRedirectHosts),
    'metadata[merchantId]': request.merchantId,
    'metadata[agentId]': request.agentId,
    'metadata[correlationId]': request.idempotencyKey,
  });
  const response = await fetchWithTimeout(fetcher, 'https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': request.idempotencyKey,
    },
    body,
  });
  if (!response.ok) throw new PaymentProviderError('PROVIDER_REJECTED', 'Stripe rejected the payment request');
  const data = await response.json() as { id?: string; url?: string };
  if (!data.id || !data.url) throw new PaymentProviderError('PROVIDER_REJECTED', 'Stripe returned an invalid response');
  return {
    provider: 'stripe',
    providerReference: data.id,
    state: 'requires_action',
    amountMinor: request.amountMinor,
    currency: request.currency,
    actionUrl: data.url,
  };
}

async function createAirwallexPayment(
  env: Env,
  request: PaymentRequest,
  fetcher: Fetcher,
): Promise<PaymentResult> {
  if (
    !env.AIRWALLEX_CLIENT_ID
    || !env.AIRWALLEX_API_KEY
    || !env.AIRWALLEX_PROVIDER_WEBHOOK_SECRET
    || !hasPaymentResponseEncryptionKey(env)
  ) {
    throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', 'Airwallex is not configured');
  }
  const baseUrl = configuredMode(env) === 'live'
    ? 'https://api.airwallex.com'
    : 'https://api-demo.airwallex.com';
  const authResponse = await fetchWithTimeout(fetcher, `${baseUrl}/api/v1/authentication/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': env.AIRWALLEX_CLIENT_ID,
      'x-api-key': env.AIRWALLEX_API_KEY,
    },
    body: '{}',
  });
  if (!authResponse.ok) throw new PaymentProviderError('PROVIDER_REJECTED', 'Airwallex authentication failed');
  const auth = await authResponse.json() as { token?: string };
  if (!auth.token) throw new PaymentProviderError('PROVIDER_REJECTED', 'Airwallex returned no access token');
  const response = await fetchWithTimeout(fetcher, `${baseUrl}/api/v1/pa/payment_intents/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      request_id: await deterministicRequestUuid(request.idempotencyKey),
      // Airwallex's API contract requires a JSON number in major units.
      // Conversion happens only at this boundary; policy and persistence stay integer-only.
      amount: Number(minorToMajor(request.amountMinor, request.currency)),
      currency: request.currency,
      merchant_order_id: `${request.merchantId}:${request.idempotencyKey}`,
      descriptor: request.description,
      metadata: {
        merchantId: request.merchantId,
        agentId: request.agentId,
        correlationId: request.idempotencyKey,
      },
    }),
  });
  if (!response.ok) throw new PaymentProviderError('PROVIDER_REJECTED', 'Airwallex rejected the payment request');
  const data = await response.json() as { id?: string; client_secret?: string; status?: string };
  if (!data.id || !data.client_secret || !data.status) {
    throw new PaymentProviderError('PROVIDER_REJECTED', 'Airwallex returned an invalid response');
  }
  return {
    provider: 'airwallex',
    providerReference: data.id,
    state: data.status === 'SUCCEEDED' ? 'succeeded' : 'requires_action',
    amountMinor: request.amountMinor,
    currency: request.currency,
    clientSecret: data.client_secret,
  };
}

function createX402Payment(env: Env, request: PaymentRequest): PaymentResult {
  if (!request.network || !request.asset || !request.recipient) {
    throw new PaymentProviderError('INVALID_REQUEST', 'x402 requires network, asset, and recipient');
  }
  const status = providerStatus(env, 'x402');
  if (!status.configured) throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', status.reason ?? 'x402 is not configured');
  return {
    provider: 'x402',
    providerReference: `x402_${request.idempotencyKey}`,
    state: 'requires_action',
    amountMinor: request.amountMinor,
    currency: request.currency,
    paymentRequirements: {
      scheme: 'x402',
      network: request.network,
      asset: request.asset,
      recipient: request.recipient,
      amountMinor: request.amountMinor,
    },
  };
}

export async function createProviderPayment(
  env: Env,
  request: PaymentRequest,
  policy: PaymentPolicy,
  context: PolicyContext,
  fetcher: Fetcher = fetch,
): Promise<PaymentResult> {
  enforcePaymentPolicy(request, policy, context);
  assertPaymentModeAllowed(env);
  switch (request.provider) {
    case 'stripe':
      return createStripePayment(env, request, policy, fetcher);
    case 'airwallex':
      return createAirwallexPayment(env, request, fetcher);
    case 'visa_cybersource':
      throw new PaymentProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'Visa is disabled until a Visa Acceptance/Cybersource merchant account and approved payment product are configured',
      );
    case 'x402':
      return createX402Payment(env, request);
    default: {
      const exhaustive: never = request.provider;
      return exhaustive;
    }
  }
}
