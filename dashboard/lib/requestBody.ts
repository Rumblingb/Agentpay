import { NextRequest } from 'next/server';

export const MAX_JSON_BODY_BYTES = 32 * 1024;

export type JsonBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 413 | 415; error: string };

/**
 * Read a small JSON object without allowing unbounded request bodies or
 * silently accepting a non-JSON content type. Every dashboard API route that
 * accepts JSON should use this helper before inspecting fields.
 */
export async function readJsonBody<T extends Record<string, unknown>>(
  request: NextRequest,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<JsonBodyResult<T>> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { ok: false, status: 415, error: 'Content-Type must be application/json' };
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number.isFinite(Number(declaredLength)) && Number(declaredLength) > maxBytes) {
    return { ok: false, status: 413, error: 'Request body is too large' };
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    return { ok: false, status: 413, error: 'Request body is too large' };
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, status: 400, error: 'JSON body must be an object' };
  }

  return { ok: true, value: value as T };
}

export function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export function isValidEmail(value: string): boolean {
  return value.length <= 320 && !hasControlCharacters(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Safe for a path segment forwarded to an upstream API after URL encoding. */
export function isSafeIdentifier(value: string, maxLength = 160): boolean {
  return value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    && !hasControlCharacters(value);
}

/** Restrict imported text to a small, single-line, control-character-free value. */
export function isBoundedPlainText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && !hasControlCharacters(value);
}
