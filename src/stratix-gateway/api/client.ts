/**
 * Type-safe API client for Stratix Gateway
 *
 * Provides typed request/response handling for all API endpoints.
 * Wraps fetch with standardized error handling, response parsing,
 * and RetryPolicyEngine for automatic retry on failure.
 */

import { retryPolicyEngine, RetryPolicyEngine } from '@/stratix-core/retry';
import type { RetryContext } from '@/stratix-core/retry/types';
import type { ApiResult, ApiRequestOptions } from './types/api';

const DEFAULT_TIMEOUT = 10000;

export interface ApiClientConfig {
  baseURL?: string;
  timeout?: number;
}

/**
 * Type-safe API client with built-in retry support via RetryPolicyEngine.
 *
 * Usage:
 * ```ts
 * const client = new ApiClient({ baseURL: 'http://localhost:7524' });
 *
 * // GET request (with automatic retry)
 * const result = await client.get<Project[]>('/api/projects');
 * if (result.success) {
 *   console.log(result.data);
 * }
 *
 * // POST request (with automatic retry)
 * const createResult = await client.post<Project>('/api/projects', { config, zoneConfig });
 * if (createResult.success) {
 *   console.log(createResult.data.id);
 * }
 * ```
 */
export class ApiClient {
  private baseURL: string;
  private timeout: number;

  constructor(config: ApiClientConfig = {}) {
    this.baseURL = config.baseURL || 'http://localhost:7524';
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
  }

  /**
   * Build full URL from path
   */
  private buildUrl(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    return `${this.baseURL}${path}`;
  }

  /**
   * Parse response - throws on HTTP errors for retry engine to catch.
   */
  private async parseResponse<T>(response: Response): Promise<ApiResult<T>> {
    if (!response.ok) {
      // Throw with status for retry engine
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & { status: number };
      error.status = response.status;
      throw error;
    }
    return this.buildSuccessResult<T>(response);
  }

  /**
   * Build success result from response
   */
  private async buildSuccessResult<T>(response: Response): Promise<ApiResult<T>> {
    const data = await response.json();

    // Handle our standard { success, ... } format
    if (typeof data.success === 'boolean') {
      if (data.success) {
        // Extract the actual data (everything except success)
        const { success, ...rest } = data;
        // If there's only one key besides success, use that value; otherwise use the whole object
        const keys = Object.keys(rest);
        if (keys.length === 1) {
          return {
            success: true,
            data: rest[keys[0]] as T
          };
        }
        return {
          success: true,
          data: rest as T
        };
      } else {
        return {
          success: false,
          error: data.error || 'Unknown error'
        };
      }
    }

    // Fallback: treat as success with raw data
    return {
      success: true,
      data: data as T
    };
  }

  /**
   * Execute request with retry
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options?: ApiRequestOptions,
    source: RetryContext['source'] = 'foreground'
  ): Promise<ApiResult<T>> {
    const retryConfig = RetryPolicyEngine.createDefaultConfig(source);

    return retryPolicyEngine.executeWithRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options?.timeout || this.timeout);

        try {
          const response = await fetch(this.buildUrl(path), {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...options?.headers
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
          });

          clearTimeout(timeoutId);
          return this.parseResponse<T>(response);
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof Error) {
            if (error.name === 'AbortError') {
              return { success: false, error: 'Request timeout' };
            }
            // Network errors are thrown for retry engine to handle
            const networkError = new Error(`network_error: ${error.message}`) as Error & { status?: number };
            networkError.status = (error as Error & { status?: number }).status;
            throw networkError;
          }
          throw error;
        }
      },
      retryConfig,
      { source }
    );
  }

  /**
   * Make a typed GET request (with automatic retry)
   */
  async get<T>(path: string, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.request<T>('GET', path, undefined, options, 'foreground');
  }

  /**
   * Make a typed POST request (with automatic retry)
   */
  async post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.request<T>('POST', path, body, options, 'foreground');
  }

  /**
   * Make a typed PUT request (with automatic retry)
   */
  async put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.request<T>('PUT', path, body, options, 'foreground');
  }

  /**
   * Make a typed PATCH request (with automatic retry)
   */
  async patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.request<T>('PATCH', path, body, options, 'foreground');
  }

  /**
   * Make a typed DELETE request (with automatic retry)
   */
  async delete<T>(path: string, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    return this.request<T>('DELETE', path, undefined, options, 'foreground');
  }
}

/** Default API client instance */
export const apiClient = new ApiClient();