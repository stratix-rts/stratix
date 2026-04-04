/**
 * Retry Policy Engine
 * Handles retry logic with exponential backoff, jitter, and source-aware behavior
 */

import type {
  RetryConfig,
  RetryContext,
  RetryAttempt,
} from './types';
import {
  CannotRetryError,
  DEFAULT_RETRY_CONFIG,
} from './types';

export class RetryPolicyEngine {
  private attempts: RetryAttempt[] = [];

  /**
   * Execute a request with retry logic
   */
  async executeWithRetry<T>(
    request: () => Promise<T>,
    config?: Partial<RetryConfig>,
    context?: RetryContext
  ): Promise<T> {
    const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    const source = context?.source ?? 'foreground';

    this.attempts = [];
    let lastError: Error | undefined;

    for (let attemptNumber = 1; attemptNumber <= fullConfig.maxRetries + 1; attemptNumber++) {
      const delayMs = this.calculateDelay(attemptNumber, fullConfig, context);

      if (delayMs > 0 && attemptNumber > 1) {
        await this.sleep(delayMs);
      }

      try {
        const result = await request();
        this.attempts.push({ attemptNumber, delayMs, result });
        return result;
      } catch (error) {
        lastError = error as Error;
        this.attempts.push({ attemptNumber, delayMs, error: lastError });

        // Determine if we can retry
        const retryDecision = this.shouldRetry(lastError, fullConfig, attemptNumber, source);

        if (!retryDecision.shouldRetry) {
          console.error(
            `RetryPolicyEngine: Cannot retry - ${retryDecision.reason}`,
            { attemptNumber, error: lastError.message }
          );

          if (retryDecision.error) {
            throw retryDecision.error;
          }
          throw new CannotRetryError('fatal', retryDecision.reason ?? 'Unknown fatal error');
        }

        console.warn(
          `RetryPolicyEngine: Attempt ${attemptNumber} failed, retrying in ${delayMs}ms`,
          { error: lastError.message, reason: retryDecision.reason }
        );
      }
    }

    throw new CannotRetryError('fatal', 'Max retries exceeded');
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(
    attemptNumber: number,
    config: RetryConfig,
    context?: RetryContext
  ): number {
    if (attemptNumber <= 1) {
      return 0;
    }

    const source = context?.source ?? 'foreground';
    let delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber - 2);

    // Apply source-specific multipliers
    switch (source) {
      case 'foreground':
        delay *= 0.5; // Shorter delays for foreground
        break;
      case 'background':
        delay *= 1.0; // Normal delays for background
        break;
      case 'unattended':
        delay *= 1.5; // Longer delays for unattended (less urgent)
        break;
    }

    // Cap at max delay
    delay = Math.min(delay, config.maxDelayMs);

    // Add jitter (0.8 to 1.2 range)
    const jitter = 0.8 + Math.random() * 0.4;
    delay = delay * jitter;

    return Math.floor(delay);
  }

  /**
   * Determine if a request should be retried
   */
  private shouldRetry(
    error: Error,
    config: RetryConfig,
    attemptNumber: number,
    source: RetryContext['source']
  ): { shouldRetry: boolean; reason?: string; error?: CannotRetryError } {
    // Check for CannotRetryError
    if (error instanceof CannotRetryError) {
      return { shouldRetry: false, reason: error.reason, error };
    }

    // Extract status code from error if available
    const statusCode = this.extractStatusCode(error as Error);

    // Handle auth errors (401/403) - never retry
    if (statusCode === 401 || statusCode === 403) {
      return {
        shouldRetry: false,
        reason: 'auth_revoked',
        error: new CannotRetryError('auth_revoked', `Auth error: ${error.message}`),
      };
    }

    // Handle context overflow - try reducing scope
    if (this.isContextOverflow(error)) {
      if (attemptNumber <= Math.ceil(config.maxRetries / 2)) {
        console.warn(`RetryPolicyEngine: Context overflow, will retry with reduced scope`);
        return { shouldRetry: true, reason: 'context_overflow_retry' };
      }
      return {
        shouldRetry: false,
        reason: 'context_overflow',
        error: new CannotRetryError('context_overflow', 'Context overflow and cannot reduce further'),
      };
    }

    // Handle 429 - longer backoff
    if (statusCode === 429) {
      // For 429, we always retry with longer delay
      const maxRetries = source === 'unattended' ? config.maxRetries + 2 : config.maxRetries;
      if (attemptNumber <= maxRetries + 1) {
        return { shouldRetry: true, reason: 'rate_limited' };
      }
      return { shouldRetry: false, reason: 'rate_limited_exhausted' };
    }

    // Check if status is retryable
    if (statusCode && config.retryableStatuses.includes(statusCode)) {
      return { shouldRetry: true, reason: `retryable_status_${statusCode}` };
    }

    // For network errors or unknown errors, allow retry
    if (!statusCode) {
      return { shouldRetry: true, reason: 'network_error' };
    }

    // Non-retryable status
    return { shouldRetry: false, reason: `non_retryable_status_${statusCode}` };
  }

  /**
   * Extract HTTP status code from error
   */
  private extractStatusCode(error: Error): number | undefined {
    // Check common error shapes - use unknown first to avoid type assertion errors
    if ('status' in error && typeof (error as unknown as { status: unknown }).status === 'number') {
      return (error as unknown as { status: number }).status;
    }
    if ('statusCode' in error && typeof (error as unknown as { statusCode: unknown }).statusCode === 'number') {
      return (error as unknown as { statusCode: number }).statusCode;
    }
    if ('response' in error && typeof error.response === 'object') {
      const response = error.response as { status?: unknown };
      if (typeof response.status === 'number') {
        return response.status;
      }
    }

    // Try parsing from message
    const statusMatch = error.message.match(/\b(4\d{2}|5\d{2})\b/);
    if (statusMatch) {
      return parseInt(statusMatch[1], 10);
    }

    return undefined;
  }

  /**
   * Check if error is a context overflow error
   */
  private isContextOverflow(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('context') &&
      (message.includes('overflow') ||
        message.includes('exceed') ||
        message.includes('limit') ||
        message.includes('too long'))
    );
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get all retry attempts
   */
  getAttempts(): readonly RetryAttempt[] {
    return this.attempts;
  }

  /**
   * Create default config tuned for specific source
   */
  static createDefaultConfig(source: RetryContext['source']): Partial<RetryConfig> {
    switch (source) {
      case 'foreground':
        // Foreground: fewer retries, shorter delays (user waiting)
        return {
          maxRetries: 2,
          initialDelayMs: 500,
          maxDelayMs: 10000,
          backoffMultiplier: 2,
        };
      case 'background':
        // Background: normal retries
        return {
          maxRetries: 3,
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          backoffMultiplier: 2,
        };
      case 'unattended':
        // Unattended: more retries, longer delays (no user waiting)
        return {
          maxRetries: 5,
          initialDelayMs: 2000,
          maxDelayMs: 60000,
          backoffMultiplier: 2.5,
        };
    }
  }
}

// Singleton instance
export const retryPolicyEngine = new RetryPolicyEngine();
