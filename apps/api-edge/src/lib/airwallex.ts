const AIRWALLEX_BASE = 'https://api.airwallex.com';
const AIRWALLEX_DEMO_BASE = 'https://api-demo.airwallex.com';

type AirwallexAuthResponse = {
  token?: string;
  expires_at?: string;
};

type AirwallexCreateIntentResponse = {
  id?: string;
  status?: string;
  client_secret?: string;
};

type AirwallexConfirmIntentResponse = {
  status?: string;
  next_action?: {
    url?: string;
  };
};

type AirwallexPaymentIntentResponse = {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, string>;
};

export type AirwallexCreatePaymentIntentParams = {
  amount: number;
  currency: 'INR' | 'GBP' | 'USD' | 'EUR';
  descriptor: string;
  orderId: string;
  returnUrl: string;
};

export type AirwallexConfirmPaymentMethod = {
  type: 'upi';
  upiId?: string;
};

export class AirwallexClient {
  private readonly clientId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private _token: string | null = null;
  private _tokenExpiry = 0;

  constructor(clientId: string, apiKey: string, sandbox = false) {
    this.clientId = clientId;
    this.apiKey = apiKey;
    this.baseUrl = sandbox ? AIRWALLEX_DEMO_BASE : AIRWALLEX_BASE;
  }

  private async getToken(): Promise<string | null> {
    if (this._token && Date.now() < this._tokenExpiry - 60_000) {
      return this._token;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/authentication/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': this.clientId,
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        this._token = null;
        this._tokenExpiry = 0;
        return null;
      }

      const data = await response.json<AirwallexAuthResponse>();
      if (!data.token) {
        this._token = null;
        this._tokenExpiry = 0;
        return null;
      }

      const expiresAt = data.expires_at ? Date.parse(data.expires_at) : Number.NaN;
      this._token = data.token;
      this._tokenExpiry = Number.isFinite(expiresAt) ? expiresAt : Date.now() + 30 * 60 * 1000;
      return this._token;
    } catch {
      this._token = null;
      this._tokenExpiry = 0;
      return null;
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T | null> {
    const token = await this.getToken();
    if (!token) return null;

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });

      if (!response.ok) return null;
      return await response.json<T>();
    } catch {
      return null;
    }
  }

  async createPaymentIntent(
    params: AirwallexCreatePaymentIntentParams,
  ): Promise<{ id: string; clientSecret: string; status: string } | null> {
    const data = await this.request<AirwallexCreateIntentResponse>('/api/v1/pa/payment_intents/create', {
      method: 'POST',
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        amount: params.amount,
        currency: params.currency,
        merchant_order_id: params.orderId,
        descriptor: params.descriptor,
        return_url: params.returnUrl,
      }),
    });

    if (!data?.id || !data.client_secret || !data.status) return null;

    return {
      id: data.id,
      clientSecret: data.client_secret,
      status: data.status,
    };
  }

  async confirmPaymentIntent(
    intentId: string,
    paymentMethod: AirwallexConfirmPaymentMethod,
  ): Promise<{ status: string; nextAction?: { url: string } } | null> {
    const data = await this.request<AirwallexConfirmIntentResponse>(`/api/v1/pa/payment_intents/${intentId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        payment_method: {
          type: paymentMethod.type,
          ...(paymentMethod.upiId ? { upi_id: paymentMethod.upiId } : {}),
        },
      }),
    });

    if (!data?.status) return null;

    return {
      status: data.status,
      ...(data.next_action?.url ? { nextAction: { url: data.next_action.url } } : {}),
    };
  }

  async getPaymentIntent(
    intentId: string,
  ): Promise<{ id: string; status: string; amount: number; currency: string; metadata?: Record<string, string> } | null> {
    const data = await this.request<AirwallexPaymentIntentResponse>(`/api/v1/pa/payment_intents/${intentId}`, {
      method: 'GET',
    });

    if (!data?.id || !data.status || typeof data.amount !== 'number' || !data.currency) return null;

    return {
      id: data.id,
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      ...(data.metadata ? { metadata: data.metadata } : {}),
    };
  }
}

/**
 * Poll or confirm a payment intent by ID — standalone function (no class instance required).
 *
 * Used by the webhook handler and any ad-hoc status check that only has
 * clientId + apiKey available (e.g. cron reconciler).
 *
 * @returns { status, id } on success, or null on auth/network error.
 */
export async function getPaymentIntentStatus(
  intentId: string,
  apiKey: string,
  clientId: string,
): Promise<{ status: string; id: string } | null> {
  // Authenticate
  let token: string | null = null;
  try {
    const authResp = await fetch(`${AIRWALLEX_BASE}/api/v1/authentication/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
        'x-api-key': apiKey,
      },
      body: JSON.stringify({}),
    });
    if (!authResp.ok) return null;
    const authData = await authResp.json<AirwallexAuthResponse>();
    token = authData.token ?? null;
  } catch {
    return null;
  }

  if (!token) return null;

  // Fetch intent
  try {
    const resp = await fetch(`${AIRWALLEX_BASE}/api/v1/pa/payment_intents/${intentId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json<AirwallexPaymentIntentResponse>();
    if (!data?.id || !data.status) return null;
    return { id: data.id, status: data.status };
  } catch {
    return null;
  }
}

export function formatAirwallexStatus(status: string): 'pending' | 'succeeded' | 'failed' {
  switch (status) {
    case 'SUCCEEDED':
      return 'succeeded';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'failed';
    case 'REQUIRES_PAYMENT_METHOD':
    case 'REQUIRES_CAPTURE':
    default:
      return 'pending';
  }
}
