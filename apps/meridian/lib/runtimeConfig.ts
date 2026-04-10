const DEFAULT_AGENTPAY_API_BASE = 'https://api.agentpay.so';
const MISSING_BRO_KEY_ERROR_NAME = 'MissingBroKeyError';
const MISSING_BRO_KEY_MESSAGE =
  'Ace needs a quick update before it can handle live trips. Install the latest Ace build and try again.';

export const AGENTPAY_API_BASE = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_AGENTPAY_API_BASE;
export const BRO_CLIENT_KEY = process.env.EXPO_PUBLIC_BRO_KEY ?? '';

export function hasBroClientKey(): boolean {
  return BRO_CLIENT_KEY.trim().length > 0;
}

export function missingBroKeyMessage(): string {
  return MISSING_BRO_KEY_MESSAGE;
}

export function createMissingBroKeyError(): Error {
  const error = new Error(MISSING_BRO_KEY_MESSAGE);
  error.name = MISSING_BRO_KEY_ERROR_NAME;
  return error;
}

export function isMissingBroKeyError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === MISSING_BRO_KEY_ERROR_NAME || error.message === MISSING_BRO_KEY_MESSAGE);
}
