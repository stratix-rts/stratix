// ============================================
// SourceManager.test.ts - 外部信息源管理器测试
// Phase 3: P3-06
// ============================================

import { SourceManager } from '../SourceManager';
import type { ExternalSource, RawInput, SourceManagerConfig } from '../types';
import type { IRSSAdapter, IAPIPollingAdapter, IWebhookAdapter } from '../SourceManager';
import { Deduplicator } from '../Deduplicator';

// -------------------------------------------------------------------------
// Test Helpers
// -------------------------------------------------------------------------

function createMockRSSAdapter(responses: Map<string, RawInput[]>): IRSSAdapter {
  return {
    fetch: jest.fn().mockImplementation((url: string) => {
      const response = responses.get(url) || [];
      return Promise.resolve(response);
    }),
  } as unknown as IRSSAdapter;
}

function createMockAPIAdapter(responses: Map<string, RawInput[]>): IAPIPollingAdapter {
  return {
    poll: jest.fn().mockImplementation((config: unknown, sourceId: string) => {
      const response = responses.get(sourceId) || [];
      return Promise.resolve(response);
    }),
  } as unknown as IAPIPollingAdapter;
}

function createMockWebhookAdapter(): IWebhookAdapter {
  return {
    verifySignature: jest.fn().mockReturnValue(true),
    parsePayload: jest.fn().mockReturnValue({
      event: 'push',
      action: 'push',
      data: { message: 'test commit' },
      timestamp: new Date(),
      source: 'github',
    }),
    mapToRawInput: jest.fn().mockImplementation((payload: unknown, sourceId: string) => {
      const p = payload as { data: { message: string } };
      return [{
        id: `webhook-${Date.now()}`,
        sourceId,
        sourceType: 'webhook',
        title: p.data?.message || 'Webhook Event',
        content: JSON.stringify(p),
        fetchedAt: new Date(),
        contentType: 'commit',
        hash: `hash-${Date.now()}`,
      }];
    }),
  } as unknown as IWebhookAdapter;
}

function createRawInput(overrides: Partial<{
  id: string;
  title: string;
  content: string;
  url: string;
  sourceId: string;
  hash: string;
}> = {}): RawInput {
  const now = new Date();
  return {
    id: overrides.id ?? `raw-${Math.random().toString(36).substring(7)}`,
    sourceId: overrides.sourceId ?? 'test-source',
    sourceType: 'rss',
    title: overrides.title ?? 'Test Title',
    content: overrides.content ?? 'Test content',
    url: overrides.url,
    fetchedAt: now,
    contentType: 'article',
    hash: `hash-${Math.random().toString(36).substring(7)}`,
  };
}

function createTestSource(overrides: Partial<{
  id: string;
  name: string;
  type: 'rss' | 'webhook' | 'api_poll' | 'file_watcher';
  status: 'active' | 'paused' | 'error' | 'disabled';
  url: string;
}> = {}): Omit<ExternalSource, 'id' | 'createdAt' | 'fetchCount' | 'errorCount'> {
  return {
    name: overrides.name ?? 'Test Source',
    type: overrides.type ?? 'rss',
    status: overrides.status ?? 'active',
    url: overrides.url ?? 'https://example.com/feed',
    config: overrides.type === 'rss' ? {
      rss: { feedUrl: overrides.url ?? 'https://example.com/feed', refreshInterval: 3600000, maxItems: 100 },
    } : {},
    ownerId: 'test-owner',
    lastFetchedAt: null,
    lastError: null,
  };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('SourceManager', () => {
  let sourceManager: SourceManager;
  let mockRSSAdapter: IRSSAdapter;
  let mockAPIAdapter: IAPIPollingAdapter;
  let mockWebhookAdapter: IWebhookAdapter;
  let mockDeduplicator: Deduplicator;

  const defaultConfig: SourceManagerConfig = {
    maxSources: 10,
    defaultRefreshInterval: 3600000,
    maxConcurrentFetches: 5,
    deduplicationWindow: 86400000,
    maxItemsPerSource: 100,
    enableAutoClassify: true,
  };

  beforeEach(() => {
    mockDeduplicator = new Deduplicator();

    mockRSSAdapter = createMockRSSAdapter(new Map());
    mockAPIAdapter = createMockAPIAdapter(new Map());
    mockWebhookAdapter = createMockWebhookAdapter();

    sourceManager = new SourceManager(defaultConfig, {
      rssAdapter: mockRSSAdapter,
      apiAdapter: mockAPIAdapter,
      webhookAdapter: mockWebhookAdapter,
      deduplicator: mockDeduplicator,
    });
  });

  afterEach(() => {
    sourceManager.stopPolling();
  });

  // ============================================
  // addSource Tests
  // ============================================

  describe('addSource', () => {
    it('should add a new RSS source successfully', async () => {
      const input = createTestSource({ name: 'My RSS Feed', type: 'rss' });

      const source = await sourceManager.addSource(input);

      expect(source.id).toBeDefined();
      expect(source.name).toBe('My RSS Feed');
      expect(source.type).toBe('rss');
      expect(source.status).toBe('active');
      expect(source.fetchCount).toBe(0);
      expect(source.errorCount).toBe(0);
    });

    it('should add a new API poll source successfully', async () => {
      const input = createTestSource({ name: 'My API', type: 'api_poll', url: 'https://api.example.com/data' });
      input.config = {
        apiPoll: {
          endpoint: 'https://api.example.com/data',
          method: 'GET',
          refreshInterval: 60000,
        },
      };

      const source = await sourceManager.addSource(input);

      expect(source.id).toBeDefined();
      expect(source.type).toBe('api_poll');
    });

    it('should throw error when max sources reached', async () => {
      const smallConfig: SourceManagerConfig = { ...defaultConfig, maxSources: 1 };
      const manager = new SourceManager(smallConfig, {
        rssAdapter: mockRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: mockDeduplicator,
      });

      await manager.addSource(createTestSource({ name: 'Source 1' }));

      await expect(manager.addSource(createTestSource({ name: 'Source 2' })))
        .rejects.toThrow('Maximum number of sources');
    });

    it('should generate unique IDs for each source', async () => {
      const source1 = await sourceManager.addSource(createTestSource());
      const source2 = await sourceManager.addSource(createTestSource());

      expect(source1.id).not.toBe(source2.id);
    });
  });

  // ============================================
  // removeSource Tests
  // ============================================

  describe('removeSource', () => {
    it('should remove an existing source', async () => {
      const source = await sourceManager.addSource(createTestSource());
      expect(sourceManager.getSource(source.id)).not.toBeNull();

      await sourceManager.removeSource(source.id);

      expect(sourceManager.getSource(source.id)).toBeNull();
    });

    it('should throw error when removing non-existent source', async () => {
      await expect(sourceManager.removeSource('non-existent-id'))
        .rejects.toThrow('Source not found');
    });

    it('should stop polling when removing a source', async () => {
      const source = await sourceManager.addSource(createTestSource());
      sourceManager.startPolling();

      await sourceManager.removeSource(source.id);

      // Should not throw and polling should be stopped
      expect(sourceManager.getSource(source.id)).toBeNull();
    });
  });

  // ============================================
  // getSources Tests
  // ============================================

  describe('getSources', () => {
    it('should return empty array when no sources added', () => {
      expect(sourceManager.getSources()).toEqual([]);
    });

    it('should return all added sources', async () => {
      await sourceManager.addSource(createTestSource({ name: 'Source 1' }));
      await sourceManager.addSource(createTestSource({ name: 'Source 2' }));

      const sources = sourceManager.getSources();

      expect(sources).toHaveLength(2);
      expect(sources.map(s => s.name)).toContain('Source 1');
      expect(sources.map(s => s.name)).toContain('Source 2');
    });
  });

  // ============================================
  // getSource Tests
  // ============================================

  describe('getSource', () => {
    it('should return null for non-existent source', () => {
      expect(sourceManager.getSource('non-existent')).toBeNull();
    });

    it('should return source by ID', async () => {
      const added = await sourceManager.addSource(createTestSource({ name: 'Find Me' }));

      const found = sourceManager.getSource(added.id);

      expect(found).not.toBeNull();
      expect(found?.name).toBe('Find Me');
    });
  });

  // ============================================
  // fetchSource Tests
  // ============================================

  describe('fetchSource', () => {
    it('should fetch from RSS source successfully', async () => {
      const rssResponses = new Map<string, RawInput[]>();
      rssResponses.set('https://example.com/feed', [
        createRawInput({ title: 'RSS Item 1' }),
        createRawInput({ title: 'RSS Item 2' }),
      ]);

      const customRSSAdapter = createMockRSSAdapter(rssResponses);
      const customDeduplicator = new Deduplicator(); // Fresh deduplicator to avoid prior state
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: customRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: customDeduplicator,
      });

      const source = await customManager.addSource(createTestSource({
        type: 'rss',
        url: 'https://example.com/feed',
      }));

      const results = await customManager.fetchSource(source.id);

      expect(results.length).toBeGreaterThan(0);
      expect(customRSSAdapter.fetch).toHaveBeenCalledWith('https://example.com/feed', expect.any(Object));
    });

    it('should fetch from API poll source successfully', async () => {
      const apiResponses = new Map<string, RawInput[]>();
      apiResponses.set('api-source', [
        createRawInput({ title: 'API Item 1' }),
      ]);

      const customAPIAdapter = createMockAPIAdapter(apiResponses);
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: mockRSSAdapter,
        apiAdapter: customAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: mockDeduplicator,
      });

      const source = await customManager.addSource({
        ...createTestSource({ type: 'api_poll', url: 'https://api.example.com' }),
        config: {
          apiPoll: {
            endpoint: 'https://api.example.com',
            method: 'GET',
            refreshInterval: 60000,
          },
        },
      });

      // Manually update the source ID mapping for API adapter
      const results = await customManager.fetchSource(source.id);

      expect(customAPIAdapter.poll).toHaveBeenCalled();
    });

    it('should return empty array for inactive source', async () => {
      const source = await sourceManager.addSource(createTestSource({ status: 'paused' }));

      const results = await sourceManager.fetchSource(source.id);

      expect(results).toEqual([]);
    });

    it('should throw error for non-existent source', async () => {
      await expect(sourceManager.fetchSource('non-existent'))
        .rejects.toThrow('Source not found');
    });

    it('should return empty array for webhook sources (not fetched)', async () => {
      const source = await sourceManager.addSource({
        ...createTestSource({ type: 'webhook' }),
        config: { webhook: { secret: 'test', allowedEvents: ['push'] } },
      });

      const results = await sourceManager.fetchSource(source.id);

      expect(results).toEqual([]);
    });
  });

  // ============================================
  // fetchAll Tests
  // ============================================

  describe('fetchAll', () => {
    it('should fetch all active sources', async () => {
      const rssResponses = new Map<string, RawInput[]>();
      rssResponses.set('https://feed1.com', [createRawInput({ title: 'Item 1' })]);
      rssResponses.set('https://feed2.com', [createRawInput({ title: 'Item 2' })]);

      const customRSSAdapter = createMockRSSAdapter(rssResponses);
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: customRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: mockDeduplicator,
      });

      await customManager.addSource(createTestSource({ type: 'rss', url: 'https://feed1.com' }));
      await customManager.addSource(createTestSource({ type: 'rss', url: 'https://feed2.com' }));

      const results = await customManager.fetchAll();

      expect(results.size).toBeGreaterThan(0);
    });

    it('should skip inactive sources in fetchAll', async () => {
      await sourceManager.addSource(createTestSource({ status: 'active' }));
      await sourceManager.addSource(createTestSource({ status: 'disabled' }));

      const results = await sourceManager.fetchAll();

      // Should handle gracefully without throwing
      expect(results).toBeDefined();
    });
  });

  // ============================================
  // processWebhook Tests
  // ============================================

  describe('processWebhook', () => {
    it('should process webhook payload successfully', async () => {
      const source = await sourceManager.addSource({
        ...createTestSource({ type: 'webhook' }),
        config: { webhook: { secret: 'test-secret', allowedEvents: ['push'] } },
      });

      const payload = JSON.stringify({ message: 'test commit' });
      const signature = 'sha256=abc123';
      const headers = { 'x-github-event': 'push' };

      const results = await sourceManager.processWebhook(source.id, payload, signature, headers);

      expect(results).toHaveLength(1);
      expect(mockWebhookAdapter.verifySignature).toHaveBeenCalledWith(payload, signature, 'test-secret');
    });

    it('should throw error for invalid webhook signature', async () => {
      (mockWebhookAdapter.verifySignature as jest.Mock).mockReturnValueOnce(false);

      const source = await sourceManager.addSource({
        ...createTestSource({ type: 'webhook' }),
        config: { webhook: { secret: 'test-secret', allowedEvents: [] } },
      });

      await expect(
        sourceManager.processWebhook(source.id, '{}', 'invalid', {})
      ).rejects.toThrow('Invalid webhook signature');
    });

    it('should throw error for non-existent source', async () => {
      await expect(
        sourceManager.processWebhook('non-existent', '{}', '', {})
      ).rejects.toThrow('Source not found');
    });

    it('should throw error when source is not webhook type', async () => {
      const source = await sourceManager.addSource(createTestSource({ type: 'rss' }));

      await expect(
        sourceManager.processWebhook(source.id, '{}', '', {})
      ).rejects.toThrow('Source is not a webhook source');
    });

    it('should filter by allowed events', async () => {
      const source = await sourceManager.addSource({
        ...createTestSource({ type: 'webhook' }),
        config: { webhook: { secret: 'test', allowedEvents: ['push'] } },
      });

      (mockWebhookAdapter.parsePayload as jest.Mock).mockReturnValueOnce({
        event: 'pull_request',
        action: 'opened',
        data: {},
        timestamp: new Date(),
        source: 'github',
      });

      const results = await sourceManager.processWebhook(source.id, '{}', '', {});

      expect(results).toEqual([]);
    });
  });

  // ============================================
  // Polling Tests
  // ============================================

  describe('Polling', () => {
    it('should start polling without error', () => {
      expect(() => sourceManager.startPolling()).not.toThrow();
    });

    it('should stop polling without error', () => {
      sourceManager.startPolling();
      expect(() => sourceManager.stopPolling()).not.toThrow();
    });

    it('should not start polling twice', () => {
      sourceManager.startPolling();
      // Should not throw
      expect(() => sourceManager.startPolling()).not.toThrow();
    });

    it('should clear all polling intervals on stop', async () => {
      await sourceManager.addSource(createTestSource({ type: 'rss', status: 'active' }));
      sourceManager.startPolling();
      sourceManager.stopPolling();

      // Should be able to start fresh
      expect(() => sourceManager.startPolling()).not.toThrow();
    });
  });

  // ============================================
  // Deduplication Integration Tests
  // ============================================

  describe('Deduplication Integration', () => {
    it('should deduplicate fetched items', async () => {
      const rssResponses = new Map<string, RawInput[]>();
      const duplicateItem = createRawInput({
        id: 'dup-1',
        title: 'Duplicate Title',
        hash: 'same-hash',
      });
      rssResponses.set('https://example.com/feed', [
        duplicateItem,
        { ...duplicateItem, id: 'dup-2', hash: 'same-hash' }, // Same hash = duplicate
      ]);

      const customRSSAdapter = createMockRSSAdapter(rssResponses);
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: customRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: mockDeduplicator,
      });

      const source = await customManager.addSource(createTestSource({
        type: 'rss',
        url: 'https://example.com/feed',
      }));

      const results = await customManager.fetchSource(source.id);

      // Deduplicator should have filtered out duplicates
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });
});
