import {
  AgentPayError,
  AuthError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  NetworkError,
  ServerError,
  PaymentError,
  VerificationError,
} from './errors';

function authHeader(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

export type RequestOpts = {
  apiKey?: string;
  baseUrl?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: any;
  // context hints to select more specific error types
  context?: 'payment' | 'verification' | 'generic';
};

export async function requestJson<T>(opts: RequestOpts): Promise<T> {
  const { apiKey, baseUrl = '', method = 'GET', path, body, context = 'generic' } = opts;
  const url = baseUrl.replace(/\/$/, '') + path;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    Object.assign(headers, authHeader(apiKey));
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err: any) {
    throw new NetworkError(err?.message ?? String(err));
  }

  const text = await res.text();
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch (e) {
    // ignore parse error, keep raw text
  }

  if (res.ok) {
    return json as T;
  }

  const status = res.status;
  const message = (json && json.message) || text || `HTTP ${status}`;

  if (status === 401) throw new AuthError(message, { status, details: json });
  if (status === 404) throw new NotFoundError(message, { status, details: json });
  if (status === 422) throw new ValidationError(message, { status, details: json });
  if (status === 429) throw new RateLimitError(message, { status, details: json });
  if (status >= 500) throw new ServerError(message, { status, details: json });

  // context-specific mapping
  if (context === 'payment') throw new PaymentError(message, { status, details: json });
  if (context === 'verification') throw new VerificationError(message, { status, details: json });

  throw new AgentPayError(message, { status, details: json });
}

export { authHeader };
