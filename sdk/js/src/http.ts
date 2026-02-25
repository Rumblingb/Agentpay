import { AgentPayError } from './errors.js';

/** Internal HTTP client wrapping fetch */
export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly timeoutMs: number = 10_000,
  ) {}

  private get defaultHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.defaultHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AgentPayError(
          `Request timed out after ${this.timeoutMs}ms`,
          408,
          'TIMEOUT',
        );
      }
      throw new AgentPayError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        0,
        'NETWORK_ERROR',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let errorBody: { error?: string; message?: string; code?: string } = {};
      try {
        errorBody = (await response.json()) as typeof errorBody;
      } catch {
        // ignore JSON parse errors on error responses
      }
      const message =
        errorBody.error ?? errorBody.message ?? `HTTP ${response.status}`;
      throw new AgentPayError(message, response.status, errorBody.code);
    }

    return response.json() as Promise<T>;
  }
}
