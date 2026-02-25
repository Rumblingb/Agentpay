/** Base error class for all AgentPay SDK errors */
export class AgentPayError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AgentPayError';
    // Maintain proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when a payment intent has expired before verification completed */
export class IntentExpiredError extends AgentPayError {
  constructor(public readonly intentId: string) {
    super(`Payment intent ${intentId} has expired`, 410, 'INTENT_EXPIRED');
    this.name = 'IntentExpiredError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when verification of a payment intent fails */
export class VerificationFailedError extends AgentPayError {
  constructor(
    public readonly intentId: string,
    reason?: string,
  ) {
    super(
      `Verification failed for intent ${intentId}${reason ? `: ${reason}` : ''}`,
      402,
      'VERIFICATION_FAILED',
    );
    this.name = 'VerificationFailedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when waitForVerification times out */
export class VerificationTimeoutError extends AgentPayError {
  constructor(public readonly intentId: string, timeoutMs: number) {
    super(
      `Verification timed out for intent ${intentId} after ${timeoutMs}ms`,
      408,
      'VERIFICATION_TIMEOUT',
    );
    this.name = 'VerificationTimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
