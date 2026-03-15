export enum ErrorCode {
  UNKNOWN = 'UNKNOWN',
  LLM_CONNECTION_FAILED = 'LLM_CONNECTION_FAILED',
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  LLM_RATE_LIMITED = 'LLM_RATE_LIMITED',
  INVALID_CONFIG = 'INVALID_CONFIG',
  SKILL_NOT_FOUND = 'SKILL_NOT_FOUND',
  SKILL_NOT_ENABLED = 'SKILL_NOT_ENABLED',
  SKILL_EXECUTION_FAILED = 'SKILL_EXECUTION_FAILED',
  MEMORY_LOAD_FAILED = 'MEMORY_LOAD_FAILED',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
}

export class StratixAgentError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'StratixAgentError';
  }
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: ErrorCode[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    ErrorCode.LLM_CONNECTION_FAILED,
    ErrorCode.LLM_TIMEOUT,
    ErrorCode.LLM_RATE_LIMITED,
  ],
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (error instanceof StratixAgentError) {
        if (!config.retryableErrors.includes(error.code)) {
          throw error;
        }
      } else if (attempt === config.maxRetries) {
        throw lastError;
      }

      const delay = Math.min(
        config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
        config.maxDelayMs
      );

      console.log(`Retry attempt ${attempt + 1} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}
