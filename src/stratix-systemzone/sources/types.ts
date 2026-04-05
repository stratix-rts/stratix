// ============================================
// External Sources 类型定义 - Phase 3
// ============================================

// ------------------------------------------------
// 信息源类型
// ------------------------------------------------

export type SourceType = 'rss' | 'webhook' | 'api_poll' | 'file_watcher';
export type SourceStatus = 'active' | 'paused' | 'error' | 'disabled';
export type ContentType = 'article' | 'changelog' | 'release' | 'issue' | 'commit' | 'tweet' | 'other';

// ------------------------------------------------
// 信息源配置
// ------------------------------------------------

export interface ExternalSource {
  id: string;
  name: string;
  type: SourceType;
  status: SourceStatus;
  url: string;
  config: SourceConfig;
  ownerId: string;
  createdAt: Date;
  lastFetchedAt: Date | null;
  lastError: string | null;
  fetchCount: number;
  errorCount: number;
}

export interface SourceConfig {
  // RSS
  rss?: {
    feedUrl: string;
    refreshInterval: number;     // ms
    maxItems: number;
  };
  // Webhook
  webhook?: {
    secret: string;
    allowedEvents: string[];
  };
  // API Polling
  apiPoll?: {
    endpoint: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    refreshInterval: number;
    responsePath?: string;       // JSON path to extract items
  };
}

// ------------------------------------------------
// 原始信息
// ------------------------------------------------

export interface RawInput {
  id: string;
  sourceId: string;
  sourceType: SourceType;
  title: string;
  content: string;
  url?: string;
  author?: string;
  publishedAt?: Date;
  fetchedAt: Date;
  contentType: ContentType;
  metadata?: Record<string, unknown>;
  hash: string;                  // 用于去重
}

// ------------------------------------------------
// 去重结果
// ------------------------------------------------

export interface DeduplicationResult {
  unique: RawInput[];
  duplicates: RawInput[];
  duplicateCount: number;
  similarityMap: Map<string, string[]>; // hash → similar hashes
}

// ------------------------------------------------
// 分类结果
// ------------------------------------------------

export interface ClassificationResult {
  inputs: ClassifiedInput[];
  categories: Map<string, number>;
}

export interface ClassifiedInput extends RawInput {
  category: string;
  relevanceScore: number;        // 0-1
  tags: string[];
}

// ------------------------------------------------
// Source Manager 配置
// ------------------------------------------------

export interface SourceManagerConfig {
  maxSources: number;            // 最大信息源数量
  defaultRefreshInterval: number; // 默认刷新间隔 ms
  maxConcurrentFetches: number;
  deduplicationWindow: number;   // 去重时间窗口 ms
  maxItemsPerSource: number;
  enableAutoClassify: boolean;
}

export const DEFAULT_SOURCE_MANAGER_CONFIG: SourceManagerConfig = {
  maxSources: 50,
  defaultRefreshInterval: 3_600_000, // 1 hour
  maxConcurrentFetches: 5,
  deduplicationWindow: 86_400_000,    // 24 hours
  maxItemsPerSource: 100,
  enableAutoClassify: true,
};

// ------------------------------------------------
// Deduplicator 配置
// ------------------------------------------------

export interface DeduplicatorConfig {
  deduplicationWindow?: number;   // 时间窗口 ms (default: 24 hours)
  similarityThreshold?: number;   // 相似度阈值 0-1 (default: 0.85)
  hashAlgorithm?: string;         // 哈希算法 (default: sha256)
}

// ------------------------------------------------
// 数据库表类型
// ------------------------------------------------

export interface SourceRecord {
  id: string;
  name: string;
  type: SourceType;
  status: SourceStatus;
  url: string;
  config: string;                // JSON string
  owner_id: string;
  created_at: string;
  last_fetched_at: string | null;
  last_error: string | null;
  fetch_count: number;
  error_count: number;
}

export interface RawInputRecord {
  id: string;
  source_id: string;
  source_type: SourceType;
  title: string;
  content: string;
  url: string | null;
  author: string | null;
  published_at: string | null;
  fetched_at: string;
  content_type: ContentType;
  metadata: string;              // JSON string
  hash: string;
  category: string | null;
  relevance_score: number | null;
  tags: string;                  // JSON string
}
