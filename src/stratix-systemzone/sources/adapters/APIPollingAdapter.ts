// ============================================
// APIPollingAdapter - API轮询适配器
// Phase 3 - P3-04
// ============================================

import type { RawInput, ContentType } from '../types';

// ------------------------------------------------
// 配置类型
// ------------------------------------------------

export interface APIPollConfig {
  endpoint: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  refreshInterval: number;
  responsePath?: string;
}

export interface RequestConfig {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

// ------------------------------------------------
// APIPollingAdapter 类
// ------------------------------------------------

export class APIPollingAdapter {
  private static readonly TIMEOUT_MS = 30_000;
  private static readonly MAX_RETRIES = 1;

  // ============================================
  // 核心方法
  // ============================================

  /**
   * 执行一次 API polling
   */
  async poll(config: APIPollConfig, sourceId: string, contentType: ContentType = 'other'): Promise<RawInput[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= APIPollingAdapter.MAX_RETRIES; attempt++) {
      try {
        const requestConfig = this.buildRequest(config);
        const response = await this.executeRequest(requestConfig);
        const parsed = this.parseResponse(response, config.responsePath);
        return this.mapToRawInput(parsed, sourceId, contentType);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < APIPollingAdapter.MAX_RETRIES) {
          // Brief wait before retry
          await this.delay(100 * (attempt + 1));
        }
      }
    }

    throw lastError ?? new Error('API polling failed');
  }

  /**
   * 构建请求配置
   */
  buildRequest(config: APIPollConfig): RequestConfig {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APIPollingAdapter.TIMEOUT_MS);

    return {
      url: config.endpoint,
      method: config.method,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: config.body,
      signal: controller.signal,
    };
  }

  /**
   * 执行 HTTP 请求
   */
  private async executeRequest(requestConfig: RequestConfig): Promise<unknown> {
    const { url, method, headers, body, signal } = requestConfig;

    const response = await fetch(url, {
      method,
      headers,
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * 解析响应，支持 JSON path 提取
   * 支持简单点号路径如 "data.items", "results", "data[0].name"
   */
  parseResponse(data: unknown, responsePath?: string): unknown[] {
    if (!responsePath) {
      return Array.isArray(data) ? data : [data];
    }

    const parts = responsePath.split('.');
    let current: unknown = data;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return [];
      }

      // Handle array index access like "data[0]"
      const indexMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (indexMatch) {
        const key = indexMatch[1];
        const index = parseInt(indexMatch[2], 10);
        current = (current as Record<string, unknown>)[key];
        if (Array.isArray(current)) {
          current = current[index];
        } else {
          return [];
        }
      } else if (Array.isArray(current)) {
        // If current is array and part is a numeric string, treat as index
        const numIndex = parseInt(part, 10);
        if (!isNaN(numIndex)) {
          current = current[numIndex];
        } else {
          // Flatten extraction across all array elements
          const results: unknown[] = [];
          for (const item of current) {
            if (item && typeof item === 'object') {
              const val = (item as Record<string, unknown>)[part];
              if (val !== undefined) {
                if (Array.isArray(val)) {
                  results.push(...val);
                } else {
                  results.push(val);
                }
              }
            }
          }
          current = results;
        }
      } else if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return [];
      }
    }

    return Array.isArray(current) ? current : [current];
  }

  /**
   * 映射到标准 RawInput 格式
   */
  mapToRawInput(
    items: unknown[],
    sourceId: string,
    contentType: ContentType
  ): RawInput[] {
    return items
      .map((item) => this.itemToRawInput(item, sourceId, contentType))
      .filter((input): input is RawInput => input !== null);
  }

  /**
   * 将单个 item 转换为 RawInput
   */
  private itemToRawInput(
    item: unknown,
    sourceId: string,
    contentType: ContentType
  ): RawInput | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const obj = item as Record<string, unknown>;

    // Extract common fields with fallbacks
    const title = this.extractString(obj, ['title', 'name', 'subject', 'heading']) ?? 'Untitled';
    const content = this.extractString(obj, ['content', 'body', 'description', 'text', 'summary']) ?? '';
    const url = this.extractString(obj, ['url', 'link', 'href', 'source', 'webhookUrl']) ?? undefined;
    const author = this.extractString(obj, ['author', 'by', 'creator', 'user']) ?? undefined;

    // Extract published date
    let publishedAt: Date | undefined;
    const dateStr = this.extractString(obj, ['publishedAt', 'published_at', 'createdAt', 'created_at', 'date', 'timestamp']);
    if (dateStr) {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        publishedAt = parsed;
      }
    }

    const hash = this.computeHash(item);
    const id = `raw_${hash.slice(0, 16)}_${Date.now()}`;

    return {
      id,
      sourceId,
      sourceType: 'api_poll',
      title,
      content,
      url,
      author,
      publishedAt,
      fetchedAt: new Date(),
      contentType,
      metadata: { originalItem: obj },
      hash,
    };
  }

  /**
   * 从对象中提取字符串字段
   */
  private extractString(obj: Record<string, unknown>, fields: string[]): string | null {
    for (const field of fields) {
      const value = obj[field];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
      if (typeof value === 'number') {
        return String(value);
      }
    }
    return null;
  }

  /**
   * 计算数据哈希用于去重
   */
  computeHash(data: unknown): string {
    const str = JSON.stringify(data, Object.keys(data as object).sort());
    return this.hashString(str);
  }

  /**
   * 简单的字符串哈希（不依赖外部库）
   */
  private hashString(str: string): string {
    let hash1 = 5381;
    let hash2 = 5381;

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash1 = ((hash1 << 5) + hash1) ^ char;
      hash2 = ((hash2 << 5) + hash2) ^ char;
    }

    // Convert to positive hex
    const h1 = (hash1 >>> 0).toString(16).padStart(8, '0');
    const h2 = (hash2 >>> 0).toString(16).padStart(8, '0');

    return `${h1}${h2}`;
  }

  /**
   * 延迟工具
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
