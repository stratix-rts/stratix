/**
 * Retry Policy Engine Types
 */

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatuses: number[];
}

export interface RetryContext {
  source: 'foreground' | 'background' | 'unattended';
  provider?: string;
  model?: string;
}

export interface RetryAttempt {
  attemptNumber: number;
  delayMs: number;
  error?: Error;
  result?: unknown;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  totalAttempts: number;
  totalDelayMs: number;
  lastError?: Error;
}

export class CannotRetryError extends Error {
  public readonly reason: 'fatal' | 'context_overflow' | 'auth_revoked' | 'budget_exceeded';

  constructor(
    reason: CannotRetryError['reason'],
    message: string
  ) {
    super(message);
    this.name = 'CannotRetryError';
    this.reason = reason;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableStatuses: [429, 500, 502, 503, 529],
};
