// ============================================
// Sources Module - Barrel Export
// Phase 3: P3-06
// ============================================

// Types
export type {
  ExternalSource,
  SourceConfig,
  SourceType,
  SourceStatus,
  RawInput,
  ContentType,
  DeduplicationResult,
  ClassificationResult,
  ClassifiedInput,
  SourceManagerConfig,
  SourceRecord,
  RawInputRecord,
} from './types';

export { DEFAULT_SOURCE_MANAGER_CONFIG } from './types';

// SourceManager
export { SourceManager } from './SourceManager';
export type { IRSSAdapter, IAPIPollingAdapter, IWebhookAdapter, SourceInput } from './SourceManager';
export { default } from './SourceManager';

// Deduplicator
export { Deduplicator } from './Deduplicator';

// Adapters
export { RSSAdapter } from './adapters/RSSAdapter';
export type { RSSConfig, ParsedItem, ParsedFeed } from './adapters/RSSAdapter';

export { APIPollingAdapter } from './adapters/APIPollingAdapter';
export type { APIPollConfig, RequestConfig } from './adapters/APIPollingAdapter';

export { WebhookAdapter } from './adapters/WebhookAdapter';
export type { WebhookPayload } from './adapters/WebhookAdapter';
