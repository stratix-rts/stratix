// ============================================
// SourceManager - 外部信息源管理器
// Phase 3: P3-06
// ============================================

import type {
  ExternalSource,
  RawInput,
  SourceType,
  SourceConfig,
  SourceManagerConfig,
} from './types';
import { Deduplicator } from './Deduplicator';
import { RSSAdapter } from './adapters/RSSAdapter';
import type { RSSConfig } from './adapters/RSSAdapter';
import { APIPollingAdapter } from './adapters/APIPollingAdapter';
import type { APIPollConfig } from './adapters/APIPollingAdapter';
import { WebhookAdapter } from './adapters/WebhookAdapter';

// ------------------------------------------------
// Adapter Interfaces
// ------------------------------------------------

export interface IRSSAdapter {
  fetch(url: string, config?: RSSConfig): Promise<RawInput[]>;
}

export interface IAPIPollingAdapter {
  poll(config: APIPollConfig, sourceId: string, contentType?: string): Promise<RawInput[]>;
}

export interface IWebhookAdapter {
  verifySignature(payload: string, signature: string, secret: string): boolean;
  parsePayload(payload: string, headers: Record<string, string>): unknown;
  mapToRawInput(payload: unknown, sourceId: string): RawInput[];
}

// ------------------------------------------------
// Source Input (without auto-generated fields)
// ------------------------------------------------

export type SourceInput = Omit<ExternalSource, 'id' | 'createdAt' | 'fetchCount' | 'errorCount'>;

// ------------------------------------------------
// SourceManager
// ------------------------------------------------

export class SourceManager {
  private sources: Map<string, ExternalSource> = new Map();
  private pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private deduplicator: Deduplicator;
  private config: Required<SourceManagerConfig>;
  private rssAdapter: IRSSAdapter;
  private apiAdapter: IAPIPollingAdapter;
  private webhookAdapter: IWebhookAdapter;
  private isPolling: boolean = false;

  constructor(
    config: SourceManagerConfig,
    adapters?: {
      rssAdapter?: IRSSAdapter;
      apiAdapter?: IAPIPollingAdapter;
      webhookAdapter?: IWebhookAdapter;
      deduplicator?: Deduplicator;
    }
  ) {
    this.config = {
      maxSources: config.maxSources ?? 50,
      defaultRefreshInterval: config.defaultRefreshInterval ?? 3_600_000,
      maxConcurrentFetches: config.maxConcurrentFetches ?? 5,
      deduplicationWindow: config.deduplicationWindow ?? 86_400_000,
      maxItemsPerSource: config.maxItemsPerSource ?? 100,
      enableAutoClassify: config.enableAutoClassify ?? true,
    };

    // Use provided adapters or create instances
    this.rssAdapter = adapters?.rssAdapter ?? new RSSAdapter() as unknown as IRSSAdapter;
    this.apiAdapter = adapters?.apiAdapter ?? new APIPollingAdapter() as unknown as IAPIPollingAdapter;
    this.webhookAdapter = adapters?.webhookAdapter ?? new WebhookAdapter() as unknown as IWebhookAdapter;
    this.deduplicator = adapters?.deduplicator ?? new Deduplicator();
  }

  // ------------------------------------------------
  // Source Management
  // ------------------------------------------------

  /**
   * 添加信息源
   */
  async addSource(
    input: Omit<ExternalSource, 'id' | 'createdAt' | 'fetchCount' | 'errorCount'>
  ): Promise<ExternalSource> {
    if (this.sources.size >= this.config.maxSources) {
      throw new Error(`Maximum number of sources (${this.config.maxSources}) reached`);
    }

    const id = this.generateId();
    const now = new Date();

    const source: ExternalSource = {
      ...input,
      id,
      createdAt: now,
      lastFetchedAt: null,
      lastError: null,
      fetchCount: 0,
      errorCount: 0,
    };

    this.sources.set(id, source);
    return source;
  }

  /**
   * 移除信息源
   */
  async removeSource(sourceId: string): Promise<void> {
    // Stop polling if active
    this.stopSourcePolling(sourceId);

    if (!this.sources.has(sourceId)) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    this.sources.delete(sourceId);
  }

  /**
   * 获取所有源列表
   */
  getSources(): ExternalSource[] {
    return Array.from(this.sources.values());
  }

  /**
   * 获取单个源
   */
  getSource(sourceId: string): ExternalSource | null {
    return this.sources.get(sourceId) ?? null;
  }

  // ------------------------------------------------
  // Fetching
  // ------------------------------------------------

  /**
   * 抓取单个源
   */
  async fetchSource(sourceId: string): Promise<RawInput[]> {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    if (source.status !== 'active') {
      return [];
    }

    let rawInputs: RawInput[] = [];

    try {
      switch (source.type) {
        case 'rss':
          rawInputs = await this.fetchFromRSS(source);
          break;
        case 'api_poll':
          rawInputs = await this.fetchFromAPI(source);
          break;
        case 'webhook':
          // Webhook sources are triggered externally, not fetched
          return [];
        default:
          throw new Error(`Unsupported source type: ${source.type}`);
      }

      // Deduplicate
      const dedupResult = this.deduplicator.deduplicate(rawInputs);

      // Update source stats
      this.updateSourceStats(sourceId, {
        lastFetchedAt: new Date(),
        fetchCount: source.fetchCount + 1,
        lastError: null,
      });

      return dedupResult.unique;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.updateSourceStats(sourceId, {
        errorCount: source.errorCount + 1,
        lastError: errorMessage,
        status: source.errorCount + 1 >= 5 ? 'error' : source.status,
      });

      throw error;
    }
  }

  /**
   * 抓取所有活跃源
   */
  async fetchAll(): Promise<Map<string, RawInput[]>> {
    const results = new Map<string, RawInput[]>();
    const activeSources = this.getSources().filter(s => s.status === 'active');

    // Process with concurrency control
    const batches = this.createBatches(activeSources, this.config.maxConcurrentFetches);

    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map(source => this.fetchSource(source.id))
      );

      for (let i = 0; i < batch.length; i++) {
        const source = batch[i];
        const result = batchResults[i];

        if (result.status === 'fulfilled') {
          results.set(source.id, result.value);
        } else {
          console.error(`Failed to fetch source ${source.id}:`, result.reason);
          results.set(source.id, []);
        }
      }
    }

    return results;
  }

  // ------------------------------------------------
  // Webhook Processing
  // ------------------------------------------------

  /**
   * 处理 webhook 回调
   */
  async processWebhook(
    sourceId: string,
    payload: string,
    signature: string,
    headers: Record<string, string>
  ): Promise<RawInput[]> {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    if (source.type !== 'webhook') {
      throw new Error(`Source is not a webhook source: ${sourceId}`);
    }

    // Verify signature
    const webhookConfig = source.config.webhook;
    if (webhookConfig?.secret) {
      if (!this.webhookAdapter.verifySignature(payload, signature, webhookConfig.secret)) {
        throw new Error('Invalid webhook signature');
      }
    }

    // Parse payload
    const parsedPayload = this.webhookAdapter.parsePayload(payload, headers);

    // Filter by allowed events
    if (webhookConfig?.allowedEvents?.length) {
      const webhookPayload = parsedPayload as { event: string; action: string };
      const eventKey = `${webhookPayload.event}:${webhookPayload.action}`;
      const isAllowed = webhookConfig.allowedEvents.some(allowed => {
        if (allowed === '*') return true;
        if (allowed === eventKey) return true;
        if (allowed === webhookPayload.event) return true;
        return false;
      });

      if (!isAllowed) {
        return [];
      }
    }

    // Map to RawInput
    const rawInputs = this.webhookAdapter.mapToRawInput(parsedPayload, sourceId);

    // Deduplicate
    const dedupResult = this.deduplicator.deduplicate(rawInputs);

    // Update stats
    this.updateSourceStats(sourceId, {
      lastFetchedAt: new Date(),
      fetchCount: source.fetchCount + 1,
      lastError: null,
    });

    return dedupResult.unique;
  }

  // ------------------------------------------------
  // Polling Control
  // ------------------------------------------------

  /**
   * 启动定时轮询
   */
  startPolling(): void {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;

    for (const source of this.sources.values()) {
      if (source.status === 'active') {
        this.startSourcePolling(source);
      }
    }
  }

  /**
   * 停止定时轮询
   */
  stopPolling(): void {
    this.isPolling = false;

    for (const [sourceId, interval] of this.pollingIntervals) {
      clearInterval(interval);
      this.pollingIntervals.delete(sourceId);
    }
  }

  // ------------------------------------------------
  // Private Helpers
  // ------------------------------------------------

  private async fetchFromRSS(source: ExternalSource): Promise<RawInput[]> {
    const rssConfig = source.config.rss;
    if (!rssConfig) {
      throw new Error('RSS config not found');
    }

    return this.rssAdapter.fetch(rssConfig.feedUrl, {
      feedUrl: rssConfig.feedUrl,
      maxItems: rssConfig.maxItems ?? this.config.maxItemsPerSource,
      refreshInterval: rssConfig.refreshInterval,
    });
  }

  private async fetchFromAPI(source: ExternalSource): Promise<RawInput[]> {
    const apiConfig = source.config.apiPoll;
    if (!apiConfig) {
      throw new Error('API poll config not found');
    }

    return this.apiAdapter.poll(
      {
        endpoint: apiConfig.endpoint,
        method: apiConfig.method,
        headers: apiConfig.headers,
        body: apiConfig.body,
        refreshInterval: apiConfig.refreshInterval,
        responsePath: apiConfig.responsePath,
      },
      source.id,
      'article'
    );
  }

  private startSourcePolling(source: ExternalSource): void {
    if (this.pollingIntervals.has(source.id)) {
      return;
    }

    let interval: number;

    switch (source.type) {
      case 'rss':
        interval = source.config.rss?.refreshInterval ?? this.config.defaultRefreshInterval;
        break;
      case 'api_poll':
        interval = source.config.apiPoll?.refreshInterval ?? this.config.defaultRefreshInterval;
        break;
      default:
        return; // Webhook and file_watcher don't poll
    }

    const timerId = setInterval(async () => {
      try {
        await this.fetchSource(source.id);
      } catch (error) {
        console.error(`Polling error for source ${source.id}:`, error);
      }
    }, interval);

    this.pollingIntervals.set(source.id, timerId);
  }

  private stopSourcePolling(sourceId: string): void {
    const timerId = this.pollingIntervals.get(sourceId);
    if (timerId) {
      clearInterval(timerId);
      this.pollingIntervals.delete(sourceId);
    }
  }

  private updateSourceStats(
    sourceId: string,
    updates: Partial<Pick<ExternalSource, 'lastFetchedAt' | 'fetchCount' | 'errorCount' | 'lastError' | 'status'>>
  ): void {
    const source = this.sources.get(sourceId);
    if (!source) return;

    Object.assign(source, updates);
  }

  private generateId(): string {
    return `src_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
}

export default SourceManager;
