export class AgentPayError extends Error {
  code?: string;
  status?: number;
  details?: any;
  constructor(message?: string, opts?: { code?: string; status?: number; details?: any }) {
    super(message ?? 'AgentPayError');
    this.name = 'AgentPayError';
    this.code = opts?.code;
    this.status = opts?.status;
    this.details = opts?.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthError extends AgentPayError {
  constructor(message = 'Authentication error', opts?: any) {
    super(message, { ...opts });
    this.name = 'AuthError';
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

export class NotFoundError extends AgentPayError {
  constructor(message = 'Not found', opts?: any) {
    super(message, { ...opts });
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ValidationError extends AgentPayError {
  constructor(message = 'Validation error', opts?: any) {
    super(message, { ...opts });
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class PaymentError extends AgentPayError {
  constructor(message = 'Payment error', opts?: any) {
    super(message, { ...opts });
    this.name = 'PaymentError';
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
}

export class VerificationError extends AgentPayError {
  constructor(message = 'Verification error', opts?: any) {
    super(message, { ...opts });
    this.name = 'VerificationError';
    Object.setPrototypeOf(this, VerificationError.prototype);
  }
}

export class RateLimitError extends AgentPayError {
  constructor(message = 'Rate limit exceeded', opts?: any) {
    super(message, { ...opts });
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class NetworkError extends AgentPayError {
  constructor(message = 'Network error', opts?: any) {
    super(message, { ...opts });
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export class ServerError extends AgentPayError {
  constructor(message = 'Server error', opts?: any) {
    super(message, { ...opts });
    this.name = 'ServerError';
    Object.setPrototypeOf(this, ServerError.prototype);
  }
}
