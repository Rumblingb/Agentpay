import type { Context } from 'hono';

type JsonBodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; response: Response };

/**
 * Parse a JSON body safely from a Hono request. Distinguishes three cases:
 *   1. No body present (content-length: 0) → returns an empty object, ok=true.
 *   2. Well-formed JSON → parsed value, ok=true.
 *   3. Malformed JSON → short-circuit 400 response the route should return.
 *
 * This is a replacement for the pattern `try { body = await c.req.json() } catch {}`
 * which silently dropped parse errors and let routes run with empty inputs.
 */
export async function parseJsonBody<T extends Record<string, unknown>>(
  c: Context,
  defaults: T = {} as T,
): Promise<JsonBodyResult<T>> {
  const contentLength = c.req.header('content-length');
  const hasBody = !contentLength || Number.parseInt(contentLength, 10) > 0;
  if (!hasBody) return { ok: true, body: defaults };
  try {
    const parsed = (await c.req.json()) as T;
    return { ok: true, body: { ...defaults, ...parsed } };
  } catch (err) {
    return {
      ok: false,
      response: c.json(
        { error: 'Malformed JSON body', detail: err instanceof Error ? err.message : String(err) },
        400,
      ),
    };
  }
}
