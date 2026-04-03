/**
 * Type-safe API client for Stratix Gateway
 *
 * Provides typed request/response handling for all API endpoints.
 * Wraps fetch with standardized error handling and response parsing.
 */

import type { ApiResult, ApiRequestOptions } from './types/api';

const DEFAULT_TIMEOUT = 10000;

export interface ApiClientConfig {
  baseURL?: string;
  timeout?: number;
}

/**
 * Type-safe API client
 *
 * Usage:
 * ```ts
 * const client = new ApiClient({ baseURL: 'http://localhost:7524' });
 *
 * // GET request
 * const result = await client.get<Project[]>('/api/projects');
 * if (result.success) {
 *   console.log(result.data);
 * }
 *
 * // POST request
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
   * Parse response to ApiResult
   */
  private async parseResponse<T>(response: Response): Promise<ApiResult<T>> {
    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

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
   * Make a typed GET request
   */
  async get<T>(path: string, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options?.timeout || this.timeout);

      const response = await fetch(this.buildUrl(path), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return this.parseResponse<T>(response);
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, error: 'Request timeout' };
        }
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Unknown error' };
    }
  }

  /**
   * Make a typed POST request
   */
  async post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options?.timeout || this.timeout);

      const response = await fetch(this.buildUrl(path), {
        method: 'POST',
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
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, error: 'Request timeout' };
        }
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Unknown error' };
    }
  }

  /**
   * Make a typed PUT request
   */
  async put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options?.timeout || this.timeout);

      const response = await fetch(this.buildUrl(path), {
        method: 'PUT',
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
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, error: 'Request timeout' };
        }
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Unknown error' };
    }
  }

  /**
   * Make a typed PATCH request
   */
  async patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options?.timeout || this.timeout);

      const response = await fetch(this.buildUrl(path), {
        method: 'PATCH',
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
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, error: 'Request timeout' };
        }
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Unknown error' };
    }
  }

  /**
   * Make a typed DELETE request
   */
  async delete<T>(path: string, options?: ApiRequestOptions): Promise<ApiResult<T>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options?.timeout || this.timeout);

      const response = await fetch(this.buildUrl(path), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return this.parseResponse<T>(response);
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, error: 'Request timeout' };
        }
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Unknown error' };
    }
  }
}

/** Default API client instance */
export const apiClient = new ApiClient();
