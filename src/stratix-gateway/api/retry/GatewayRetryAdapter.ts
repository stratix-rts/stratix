/**
 * Gateway Retry Adapter
 * Unified retry adapter wrapping retryPolicyEngine for Gateway HTTP/WebSocket layer
 */

import { retryPolicyEngine, RetryPolicyEngine } from '@/stratix-core/retry';
import type { RetryContext, RetryConfig } from '@/stratix-core/retry/types';

export class GatewayRetryAdapter {
  constructor(private defaultSource: RetryContext['source'] = 'foreground') {}

  /**
   * Execute with retry
   */
  async execute<T>(
    request: () => Promise<T>,
    source?: RetryContext['source'],
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const src = source ?? this.defaultSource;
    const fullConfig: RetryConfig = {
      ...RetryPolicyEngine.createDefaultConfig(src),
      ...config,
    } as RetryConfig;

    return retryPolicyEngine.executeWithRetry(request, fullConfig, { source: src });
  }

  /**
   * Execute fetch with retry
   */
  async fetch<T>(
    url: string,
    options?: RequestInit,
    source?: RetryContext['source']
  ): Promise<T> {
    return this.execute(
      async () => {
        const response = await fetch(url, options);
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`) as Error & { status: number };
          error.status = response.status;
          throw error;
        }
        return response.json() as Promise<T>;
      },
      source
    );
  }
}

export const gatewayRetryAdapter = new GatewayRetryAdapter();