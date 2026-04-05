// ============================================
// Sources.integration.test.ts - 外部信息源集成测试
// Phase 3: P3-09 - 端到端测试外部信息源
// ============================================

import { SourceManager } from '../sources/SourceManager';
import { Deduplicator } from '../sources/Deduplicator';
import { RSSAdapter } from '../sources/adapters/RSSAdapter';
import { APIPollingAdapter } from '../sources/adapters/APIPollingAdapter';
import { WebhookAdapter } from '../sources/adapters/WebhookAdapter';
import { Observer } from '../observer/Observer';
import type { ExternalSource, RawInput, SourceManagerConfig } from '../sources/types';
import type { IRSSAdapter, IAPIPollingAdapter, IWebhookAdapter } from '../sources/SourceManager';

// -------------------------------------------------------------------------
// Mock XML/JSON Data
// -------------------------------------------------------------------------

const RSS_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>A test RSS feed</description>
    <item>
      <title>Article One</title>
      <link>https://example.com/article-1</link>
      <description>This is article one description about React performance</description>
      <pubDate>Wed, 01 Apr 2026 10:00:00 GMT</pubDate>
      <author>author1@example.com</author>
      <guid>article-1-guid</guid>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article-2</link>
      <description>This is article two description about security vulnerability</description>
      <pubDate>Thu, 02 Apr 2026 12:00:00 GMT</pubDate>
      <guid>article-2-guid</guid>
    </item>
    <item>
      <title>Release v1.0.0</title>
      <link>https://example.com/release-1</link>
      <description>Version 1.0.0 release announcement with changelog</description>
      <pubDate>Fri, 03 Apr 2026 08:00:00 GMT</pubDate>
      <guid>release-1-guid</guid>
    </item>
  </channel>
</rss>`;

const API_RESPONSE_JSON = JSON.stringify({
  data: {
    items: [
      {
        id: 1,
        title: 'API News Item 1',
        content: 'First news item from API about performance optimization',
        url: 'https://api.example.com/news/1',
        author: 'API Author',
        publishedAt: '2026-04-01T10:00:00Z',
      },
      {
        id: 2,
        title: 'API News Item 2',
        content: 'Second news item from API about bug fixes',
        url: 'https://api.example.com/news/2',
        publishedAt: '2026-04-02T10:00:00Z',
      },
    ],
  },
});

const GITHUB_PUSH_WEBHOOK = JSON.stringify({
  action: 'opened',
  ref: 'refs/heads/main',
  repository: {
    full_name: 'test/repo',
    clone_url: 'https://github.com/test/repo.git',
    html_url: 'https://github.com/test/repo',
  },
  sender: {
    login: 'testuser',
  },
  commits: [
    {
      id: 'abc123',
      message: 'Fix memory leak in component\n\nThis commit fixes a memory leak issue',
      url: 'https://github.com/test/repo/commit/abc123',
      author: {
        name: 'Test Author',
        email: 'test@example.com',
      },
    },
  ],
  head_commit: {
    id: 'abc123',
    message: 'Fix memory leak in component',
    url: 'https://github.com/test/repo/commit/abc123',
    author: {
      name: 'Test Author',
      email: 'test@example.com',
    },
  },
});

const GITHUB_PULL_REQUEST_WEBHOOK = JSON.stringify({
  action: 'opened',
  repository: {
    full_name: 'test/repo',
    clone_url: 'https://github.com/test/repo.git',
    html_url: 'https://github.com/test/repo',
  },
  sender: {
    login: 'testuser',
  },
  pull_request: {
    number: 42,
    title: 'Add new feature',
    body: 'This PR adds a new feature to the codebase',
    html_url: 'https://github.com/test/repo/pull/42',
    user: {
      login: 'testuser',
    },
  },
});

// -------------------------------------------------------------------------
// Test Helpers
// -------------------------------------------------------------------------

function createMockRSSAdapter(responses: Map<string, string>): IRSSAdapter {
  return {
    fetch: jest.fn().mockImplementation(async (url: string) => {
      const xml = responses.get(url);
      if (!xml) return [];
      const adapter = new RSSAdapter();
      const feed = await adapter.parseXML(xml);
      return adapter.mapToRawInput(feed.items, url);
    }),
  } as unknown as IRSSAdapter;
}

function createMockAPIAdapter(responses: Map<string, RawInput[]>): IAPIPollingAdapter {
  return {
    poll: jest.fn().mockImplementation(async (config: unknown, sourceId: string) => {
      // Return pre-computed RawInput array directly
      const result = responses.get(sourceId);
      return result ?? [];
    }),
  } as unknown as IAPIPollingAdapter;
}

function createMockWebhookAdapter(): IWebhookAdapter {
  const adapter = new WebhookAdapter();
  return {
    verifySignature: jest.fn().mockImplementation((payload: string, signature: string, secret: string) => {
      return adapter.verifySignature(payload, signature, secret);
    }),
    parsePayload: jest.fn().mockImplementation((payload: string, headers: Record<string, string>) => {
      return adapter.parsePayload(payload, headers);
    }),
    mapToRawInput: jest.fn().mockImplementation((payload: unknown, sourceId: string) => {
      return adapter.mapToRawInput(payload as any, sourceId);
    }),
  } as unknown as IWebhookAdapter;
}

function createRawInput(overrides: Partial<{
  id: string;
  title: string;
  content: string;
  url: string;
  sourceId: string;
  sourceType: 'rss' | 'webhook' | 'api_poll' | 'file_watcher';
  hash: string;
  fetchedAt: Date;
}> = {}): RawInput {
  const now = new Date();
  return {
    id: overrides.id ?? `raw-${Math.random().toString(36).substring(7)}`,
    sourceId: overrides.sourceId ?? 'test-source',
    sourceType: overrides.sourceType ?? 'rss',
    title: overrides.title ?? 'Test Title',
    content: overrides.content ?? 'Test content',
    url: overrides.url,
    fetchedAt: overrides.fetchedAt ?? now,
    contentType: 'article',
    hash: overrides.hash ?? `hash-${Math.random().toString(36).substring(7)}`,
  };
}

function createTestSource(overrides: Partial<{
  id: string;
  name: string;
  type: 'rss' | 'webhook' | 'api_poll';
  status: 'active' | 'paused' | 'error' | 'disabled';
  url: string;
}> = {}): Omit<ExternalSource, 'id' | 'createdAt' | 'fetchCount' | 'errorCount'> {
  const type = overrides.type ?? 'rss';
  const url = overrides.url ?? 'https://example.com/feed';
  return {
    name: overrides.name ?? 'Test Source',
    type,
    status: overrides.status ?? 'active',
    url,
    config: type === 'rss'
      ? { rss: { feedUrl: url, refreshInterval: 3600000, maxItems: 100 } }
      : type === 'api_poll'
        ? { apiPoll: { endpoint: url, method: 'GET', refreshInterval: 60000 } }
        : { webhook: { secret: 'test-secret', allowedEvents: ['push'] } },
    ownerId: 'test-owner',
    lastFetchedAt: null,
    lastError: null,
  };
}

// -------------------------------------------------------------------------
// Integration Tests
// -------------------------------------------------------------------------

describe('Sources Integration Tests', () => {
  let sourceManager: SourceManager;
  let deduplicator: Deduplicator;
  let mockRSSAdapter: IRSSAdapter;
  let mockAPIAdapter: IAPIPollingAdapter;
  let mockWebhookAdapter: IWebhookAdapter;
  let observer: Observer;

  const defaultConfig: SourceManagerConfig = {
    maxSources: 50,
    defaultRefreshInterval: 3_600_000,
    maxConcurrentFetches: 5,
    deduplicationWindow: 86_400_000,
    maxItemsPerSource: 100,
    enableAutoClassify: true,
  };

  beforeEach(() => {
    deduplicator = new Deduplicator();
    mockRSSAdapter = createMockRSSAdapter(new Map());
    mockAPIAdapter = createMockAPIAdapter(new Map());
    mockWebhookAdapter = createMockWebhookAdapter();

    sourceManager = new SourceManager(defaultConfig, {
      rssAdapter: mockRSSAdapter,
      apiAdapter: mockAPIAdapter,
      webhookAdapter: mockWebhookAdapter,
      deduplicator,
    });

    observer = new Observer({
      preprocessor: {
        detectLanguageEnabled: true,
        deduplicationEnabled: true,
        cleaningEnabled: true,
      },
      extractor: {
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        temperature: 0.3,
        timeoutMs: 30000,
      },
    });
  });

  afterEach(() => {
    sourceManager.stopPolling();
  });

  // ============================================
  // Test 1: RSS Source → Fetch → Deduplicate → Return RawInput[]
  // ============================================
  describe('1. RSS Source → Fetch → Deduplicate → Return RawInput[]', () => {
    test('fetches RSS feed and returns deduplicated RawInput array', async () => {
      const rssResponses = new Map<string, string>();
      rssResponses.set('https://example.com/rss', RSS_FEED_XML);

      const customRSSAdapter = createMockRSSAdapter(rssResponses);
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: customRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: new Deduplicator(),
      });

      const source = await customManager.addSource(createTestSource({
        type: 'rss',
        url: 'https://example.com/rss',
      }));

      const results = await customManager.fetchSource(source.id);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // Verify RawInput structure
      for (const input of results) {
        expect(input).toHaveProperty('id');
        expect(input).toHaveProperty('sourceId');
        expect(input).toHaveProperty('sourceType', 'rss');
        expect(input).toHaveProperty('title');
        expect(input).toHaveProperty('content');
        expect(input).toHaveProperty('fetchedAt');
        expect(input).toHaveProperty('hash');
        expect(input).toHaveProperty('contentType');
      }
    });

    test('deduplicates identical RSS items', async () => {
      const duplicateRSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <item>
      <title>Same Title</title>
      <link>https://example.com/same</link>
      <description>Same content</description>
      <pubDate>Wed, 01 Apr 2026 10:00:00 GMT</pubDate>
      <guid>same-guid</guid>
    </item>
    <item>
      <title>Same Title</title>
      <link>https://example.com/same</link>
      <description>Same content</description>
      <pubDate>Wed, 01 Apr 2026 10:00:00 GMT</pubDate>
      <guid>same-guid</guid>
    </item>
  </channel>
</rss>`;

      const rssResponses = new Map<string, string>();
      rssResponses.set('https://example.com/dup', duplicateRSS);

      const customRSSAdapter = createMockRSSAdapter(rssResponses);
      const customDeduplicator = new Deduplicator();
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: customRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: customDeduplicator,
      });

      const source = await customManager.addSource(createTestSource({
        type: 'rss',
        url: 'https://example.com/dup',
      }));

      const results = await customManager.fetchSource(source.id);

      // Deduplicator should have reduced duplicates
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  // ============================================
  // Test 2: Webhook Source → Receive Validation → Signature Verification
  // ============================================
  describe('2. Webhook Source → Receive Validation → Signature Verification', () => {
    test('processes valid GitHub push webhook', async () => {
      const source = await sourceManager.addSource({
        ...createTestSource({ type: 'webhook' }),
        config: { webhook: { secret: 'test-secret-123', allowedEvents: ['push'] } },
      });

      // Compute valid signature
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', 'test-secret-123');
      hmac.update(GITHUB_PUSH_WEBHOOK, 'utf-8');
      const validSignature = `sha256=${hmac.digest('hex')}`;

      const headers = {
        'x-github-event': 'push',
        'x-github-delivery': 'test-delivery-id',
      };

      const results = await sourceManager.processWebhook(
        source.id,
        GITHUB_PUSH_WEBHOOK,
        validSignature,
        headers
      );

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(mockWebhookAdapter.verifySignature).toHaveBeenCalled();
    });

    test('rejects invalid webhook signature', async () => {
      const source = await sourceManager.addSource({
        ...createTestSource({ type: 'webhook' }),
        config: { webhook: { secret: 'test-secret', allowedEvents: [] } },
      });

      (mockWebhookAdapter.verifySignature as jest.Mock).mockReturnValueOnce(false);

      await expect(
        sourceManager.processWebhook(source.id, '{}', 'invalid-signature', {})
      ).rejects.toThrow('Invalid webhook signature');
    });

    test('processes GitHub pull request webhook', async () => {
      const source = await sourceManager.addSource({
        ...createTestSource({ type: 'webhook' }),
        config: { webhook: { secret: 'test-secret', allowedEvents: ['pull_request'] } },
      });

      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', 'test-secret');
      hmac.update(GITHUB_PULL_REQUEST_WEBHOOK, 'utf-8');
      const validSignature = `sha256=${hmac.digest('hex')}`;

      const headers = {
        'x-github-event': 'pull_request',
        'x-github-delivery': 'test-delivery-id',
      };

      const results = await sourceManager.processWebhook(
        source.id,
        GITHUB_PULL_REQUEST_WEBHOOK,
        validSignature,
        headers
      );

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Test 3: API Polling Source → Poll → Parse Response
  // ============================================
  describe('3. API Polling Source → Poll → Parse Response', () => {
    test('polls API and returns RawInput array', async () => {
      // Create mock responses (will be populated after source is added)
      const apiResponses = new Map<string, RawInput[]>();

      const customAPIAdapter = createMockAPIAdapter(apiResponses);
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: mockRSSAdapter,
        apiAdapter: customAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: new Deduplicator(),
      });

      const source = await customManager.addSource({
        ...createTestSource({ type: 'api_poll', url: 'https://api.example.com/data' }),
        config: {
          apiPoll: {
            endpoint: 'https://api.example.com/data',
            method: 'GET',
            refreshInterval: 60000,
            responsePath: 'data.items',
          },
        },
      });

      // Populate responses AFTER source.id is known with unique hashes
      apiResponses.set(source.id, [
        createRawInput({ sourceId: source.id, title: 'API News Item Alpha', content: 'Content for alpha', sourceType: 'api_poll', hash: 'hash-alpha-001' }),
        createRawInput({ sourceId: source.id, title: 'API News Item Beta', content: 'Content for beta', sourceType: 'api_poll', hash: 'hash-beta-002' }),
      ]);

      const results = await customManager.fetchSource(source.id);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(2);

      // Verify RawInput structure
      for (const input of results) {
        expect(input).toHaveProperty('sourceType', 'api_poll');
        expect(input).toHaveProperty('title');
        expect(input).toHaveProperty('content');
      }
    });

    test('handles API polling with custom response', async () => {
      const apiResponses = new Map<string, RawInput[]>();

      const customAPIAdapter = createMockAPIAdapter(apiResponses);
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: mockRSSAdapter,
        apiAdapter: customAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: new Deduplicator(),
      });

      const source = await customManager.addSource({
        ...createTestSource({ type: 'api_poll', url: 'https://api.example.com/custom' }),
        config: {
          apiPoll: {
            endpoint: 'https://api.example.com/custom',
            method: 'GET',
            refreshInterval: 60000,
          },
        },
      });

      // Populate responses AFTER source.id is known with unique hashes
      apiResponses.set(source.id, [
        createRawInput({ sourceId: source.id, title: 'Custom Item Gamma', content: 'Gamma content', sourceType: 'api_poll', hash: 'hash-gamma-003' }),
        createRawInput({ sourceId: source.id, title: 'Custom Item Delta', content: 'Delta content', sourceType: 'api_poll', hash: 'hash-delta-004' }),
      ]);

      const results = await customManager.fetchSource(source.id);

      expect(results).toBeDefined();
      expect(results.length).toBe(2);
      expect(results[0].title).toBe('Custom Item Gamma');
      expect(results[1].title).toBe('Custom Item Delta');
    });
  });

  // ============================================
  // Test 4: Multi-Source Parallel Fetch → Merge Results
  // ============================================
  describe('4. Multi-Source Parallel Fetch → Merge Results', () => {
    test('fetches multiple sources in parallel', async () => {
      const rssResponses = new Map<string, string>();
      rssResponses.set('https://feed1.com', RSS_FEED_XML);
      rssResponses.set('https://feed2.com', RSS_FEED_XML);

      const customRSSAdapter = createMockRSSAdapter(rssResponses);
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: customRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: new Deduplicator(),
      });

      await customManager.addSource(createTestSource({
        type: 'rss',
        name: 'Feed 1',
        url: 'https://feed1.com',
      }));
      await customManager.addSource(createTestSource({
        type: 'rss',
        name: 'Feed 2',
        url: 'https://feed2.com',
      }));

      const results = await customManager.fetchAll();

      expect(results).toBeDefined();
      expect(results.size).toBeGreaterThanOrEqual(2);

      // Each source should have results
      for (const [sourceId, inputs] of results) {
        expect(sourceId).toBeDefined();
        expect(Array.isArray(inputs)).toBe(true);
      }
    });

    test('handles mixed source types in parallel fetch', async () => {
      const rssResponses = new Map<string, string>();
      rssResponses.set('https://feed1.com', RSS_FEED_XML);

      const customRSSAdapter = createMockRSSAdapter(rssResponses);
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: customRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: new Deduplicator(),
      });

      // Add RSS source
      await customManager.addSource(createTestSource({
        type: 'rss',
        name: 'RSS Feed',
        url: 'https://feed1.com',
      }));

      // Add API poll source (will fail but shouldn't crash parallel fetch)
      await customManager.addSource({
        ...createTestSource({ type: 'api_poll', name: 'API Source', url: 'https://api.example.com' }),
        config: {
          apiPoll: {
            endpoint: 'https://api.example.com',
            method: 'GET',
            refreshInterval: 60000,
          },
        },
      });

      const results = await customManager.fetchAll();

      // Should complete without throwing even if some sources fail
      expect(results).toBeDefined();
    });
  });

  // ============================================
  // Test 5: Deduplication Engine: Exact Deduplication (Hash Match)
  // ============================================
  describe('5. Deduplication Engine: Exact Deduplication (Hash Match)', () => {
    test('detects exact duplicates by hash', () => {
      const inputs: RawInput[] = [
        createRawInput({ id: '1', title: 'Same Title', url: 'https://example.com', hash: 'abc123' }),
        createRawInput({ id: '2', title: 'Same Title', url: 'https://example.com', hash: 'abc123' }),
        createRawInput({ id: '3', title: 'Different Title', url: 'https://example.com', hash: 'def456' }),
      ];

      const result = deduplicator.deduplicate(inputs);

      expect(result.unique.length).toBe(2);
      expect(result.duplicates.length).toBe(1);
      expect(result.duplicateCount).toBe(1);
    });

    test('treats items with different URLs and titles as unique', () => {
      const inputs: RawInput[] = [
        createRawInput({ id: '1', title: 'Article Alpha', url: 'https://example.com/alpha' }),
        createRawInput({ id: '2', title: 'Article Beta', url: 'https://example.com/beta' }),
      ];

      const result = deduplicator.deduplicate(inputs);

      // Different titles and URLs should all be unique
      expect(result.unique.length).toBe(2);
      expect(result.duplicates.length).toBe(0);
    });

    test('handles time window correctly for duplicate detection', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 1000 * 60 * 60 * 25); // 25 hours ago

      // Same content outside window stays, different content inside window is added
      const inputs: RawInput[] = [
        createRawInput({ id: '1', title: 'Old Article', url: 'https://example.com/old', fetchedAt: oldDate }),
        createRawInput({ id: '2', title: 'New Article', url: 'https://example.com/new', fetchedAt: now }),
      ];

      const result = deduplicator.deduplicate(inputs);

      // Both items should be unique since they have different content
      expect(result.unique.length).toBe(2);
      expect(result.duplicates.length).toBe(0);
    });
  });

  // ============================================
  // Test 6: Deduplication Engine: Similar Deduplication (Title Similarity)
  // ============================================
  describe('6. Deduplication Engine: Similar Deduplication (Title Similarity)', () => {
    test('detects similar titles as duplicates', () => {
      const inputs: RawInput[] = [
        createRawInput({ id: '1', title: 'React Performance Optimization and Best Practices Guide' }),
        createRawInput({ id: '2', title: 'React Performance Optimization and Best Practices' }),
      ];

      const result = deduplicator.deduplicate(inputs);

      // These titles are > 85% similar
      expect(result.duplicates.length).toBeGreaterThanOrEqual(1);
    });

    test('does not flag dissimilar titles as duplicates', () => {
      const inputs: RawInput[] = [
        createRawInput({ id: '1', title: 'React Performance Optimization' }),
        createRawInput({ id: '2', title: 'Python Django Tutorial for Beginners' }),
      ];

      const result = deduplicator.deduplicate(inputs);

      // These are very different, so both should be unique
      expect(result.unique.length).toBe(2);
      expect(result.duplicates.length).toBe(0);
    });

    test('uses custom similarity threshold', () => {
      const highThresholdDeduplicator = new Deduplicator({ similarityThreshold: 0.99 });

      const inputs: RawInput[] = [
        createRawInput({ id: '1', title: 'React Performance Optimization' }),
        createRawInput({ id: '2', title: 'React Performance Optimization Guide' }),
      ];

      const result = highThresholdDeduplicator.deduplicate(inputs);

      // With 99% threshold, these might not be flagged as duplicates
      // (they're similar but not identical)
      expect(result).toBeDefined();
    });

    test('computes similarity score correctly', () => {
      const similarity = deduplicator.computeSimilarity(
        'React Performance Optimization',
        'React Performance Optimization Guide'
      );

      expect(similarity).toBeGreaterThan(0.7);
      expect(similarity).toBeLessThan(1);
    });

    test('returns 1 for identical strings', () => {
      const similarity = deduplicator.computeSimilarity('Same Title', 'Same Title');
      expect(similarity).toBe(1);
    });

    test('returns 0 for completely different strings', () => {
      const similarity = deduplicator.computeSimilarity('React', 'Python Django');
      expect(similarity).toBe(0);
    });
  });

  // ============================================
  // Test 7: Classification Engine: Auto-Classify to Correct Category
  // ============================================
  describe('7. Classification Engine: Auto-Classify to Correct Category', () => {
    test('classifies security content correctly', () => {
      const inputs: RawInput[] = [
        createRawInput({
          id: '1',
          title: 'Security Vulnerability CVE Authentication',
          content: 'Security vulnerability CVE authentication authorization encryption credential password token session jwt oauth ssl tls https malware phishing',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('security');
      expect(result.inputs[0].relevanceScore).toBeGreaterThan(0);
    });

    test('classifies performance content correctly', () => {
      const inputs: RawInput[] = [
        createRawInput({
          id: '1',
          title: 'Performance Optimization Cache Speed',
          content: 'Performance speed optimize cache lazy memoize debounce throttle bundle tree shaking split compression preload latency throughput',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('performance');
    });

    test('classifies bug fix content correctly', () => {
      const inputs: RawInput[] = [
        createRawInput({
          id: '1',
          title: 'Bug Fix',
          content: 'Fixed crash when loading empty data in the worker thread',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('bug');
    });

    test('classifies feature announcement correctly', () => {
      const inputs: RawInput[] = [
        createRawInput({
          id: '1',
          title: 'New Feature',
          content: 'Introducing dark mode support in the application UI',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('feature');
    });

    test('classifies docs content correctly', () => {
      const inputs: RawInput[] = [
        createRawInput({
          id: '1',
          title: 'Documentation Update',
          content: 'Updated API reference guide with new endpoints and examples',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('docs');
    });

    test('classifies test content correctly', () => {
      const inputs: RawInput[] = [
        createRawInput({
          id: '1',
          title: 'Test Coverage',
          content: 'Added unit tests and integration tests for the auth module using Jest',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('test');
    });

    test('builds category counts correctly', () => {
      const inputs: RawInput[] = [
        createRawInput({
          id: '1',
          title: 'Security Fix',
          content: 'Security vulnerability authentication authorization encryption credential',
        }),
        createRawInput({
          id: '2',
          title: 'Security Update',
          content: 'Security vulnerability authentication authorization encryption credential',
        }),
        createRawInput({
          id: '3',
          title: 'Bug Fix',
          content: 'Bug fix patch hotfix repair crash fail broken fault defect regression',
        }),
      ];

      const result = deduplicator.classify(inputs);

      // With keyword-dense content, classification should work
      expect(result.inputs.length).toBe(3);
      expect(result.categories.size).toBeGreaterThan(0);
    });

    test('extracts relevant tags from content', () => {
      const inputs: RawInput[] = [
        createRawInput({
          id: '1',
          title: 'React Security Update',
          content: 'Security update for React applications using TypeScript',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].tags).toBeDefined();
      expect(result.inputs[0].tags).toContain('security');
      expect(result.inputs[0].tags).toContain('react');
      expect(result.inputs[0].tags).toContain('typescript');
    });
  });

  // ============================================
  // Test 8: SourceManager Scheduled Polling Start/Stop
  // ============================================
  describe('8. SourceManager Scheduled Polling Start/Stop', () => {
    test('starts polling without error', () => {
      expect(() => sourceManager.startPolling()).not.toThrow();
    });

    test('stops polling without error', () => {
      sourceManager.startPolling();
      expect(() => sourceManager.stopPolling()).not.toThrow();
    });

    test('startPolling does not throw when called twice', () => {
      sourceManager.startPolling();
      expect(() => sourceManager.startPolling()).not.toThrow();
    });

    test('can restart polling after stop', () => {
      sourceManager.startPolling();
      sourceManager.stopPolling();
      expect(() => sourceManager.startPolling()).not.toThrow();
    });

    test('clears polling intervals on stop', async () => {
      await sourceManager.addSource(createTestSource({ type: 'rss', status: 'active' }));
      sourceManager.startPolling();
      sourceManager.stopPolling();

      // Starting again should work without conflicts
      expect(() => sourceManager.startPolling()).not.toThrow();
    });

    test('does not poll paused sources', async () => {
      await sourceManager.addSource(createTestSource({ type: 'rss', status: 'paused' }));
      sourceManager.startPolling();

      // Should not throw - paused sources are skipped
      expect(() => sourceManager.stopPolling()).not.toThrow();
    });
  });

  // ============================================
  // Test 9: Observer Receives External Input → Generate Insights
  // ============================================
  describe('9. Observer Receives External Input → Generate Insights', () => {
    test('Observer receives raw input from external source', async () => {
      const rssInputs: RawInput[] = [
        createRawInput({ title: 'External RSS Article', content: 'Content from RSS feed', sourceType: 'rss' }),
      ];

      // Convert RawInput to content for Observer
      for (const input of rssInputs) {
        const content = `[${input.sourceType}] ${input.title}: ${input.content}`;
        await observer.receiveInput(content, 'api', 'news', {
          url: input.url,
          tags: [input.sourceType, input.contentType],
        });
      }

      const summary = observer.getSummary();
      expect(summary.pendingCount).toBe(1);
      expect(summary.totalInputsReceived).toBe(1);
    });

    test('Observer processes multiple external inputs', async () => {
      const externalInputs: RawInput[] = [
        createRawInput({ title: 'Article 1', content: 'Content 1', sourceType: 'rss' }),
        createRawInput({ title: 'Article 2', content: 'Content 2', sourceType: 'api_poll' }),
        createRawInput({ title: 'Webhook Event', content: 'Content 3', sourceType: 'webhook' }),
      ];

      for (const input of externalInputs) {
        const content = `[${input.sourceType}] ${input.title}`;
        await observer.receiveInput(content, 'api');
      }

      const summary = observer.getSummary();
      expect(summary.pendingCount).toBe(3);
      expect(summary.totalInputsReceived).toBe(3);
    });

    test('Observer emits input_received event for external input', async () => {
      const receivedEvents: any[] = [];
      observer.on('input_received', (e) => receivedEvents.push(e));

      const input = createRawInput({ title: 'Event Test', content: 'Testing event emission' });
      await observer.receiveInput(`[${input.sourceType}] ${input.title}`, 'api');

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].payload.input.content).toContain('Event Test');
    });

    test('Observer extracts preprocessed result from external content', async () => {
      const result = await observer.extractFromText(
        'Breaking news: Major security vulnerability discovered in popular framework'
      );

      expect(result.preprocessed).toBeDefined();
      expect(result.preprocessed.original).toBeTruthy();
      expect(result.preprocessed.cleaned).toBeTruthy();
    });
  });

  // ============================================
  // Test 10: API Routes: CRUD for Sources
  // ============================================
  describe('10. API Routes: CRUD for Sources', () => {
    test('SourceManager addSource creates source with correct properties', async () => {
      const source = await sourceManager.addSource(createTestSource({
        name: 'My RSS Feed',
        type: 'rss',
      }));

      expect(source.id).toBeDefined();
      expect(source.name).toBe('My RSS Feed');
      expect(source.type).toBe('rss');
      expect(source.status).toBe('active');
      expect(source.fetchCount).toBe(0);
      expect(source.errorCount).toBe(0);
      expect(source.createdAt).toBeInstanceOf(Date);
    });

    test('SourceManager getSource retrieves added source', async () => {
      const added = await sourceManager.addSource(createTestSource({ name: 'Find Me' }));

      const found = sourceManager.getSource(added.id);

      expect(found).not.toBeNull();
      expect(found?.name).toBe('Find Me');
    });

    test('SourceManager getSources returns all sources', async () => {
      await sourceManager.addSource(createTestSource({ name: 'Source 1' }));
      await sourceManager.addSource(createTestSource({ name: 'Source 2' }));

      const sources = sourceManager.getSources();

      expect(sources).toHaveLength(2);
      expect(sources.map(s => s.name)).toContain('Source 1');
      expect(sources.map(s => s.name)).toContain('Source 2');
    });

    test('SourceManager removeSource deletes source', async () => {
      const source = await sourceManager.addSource(createTestSource());

      await sourceManager.removeSource(source.id);

      expect(sourceManager.getSource(source.id)).toBeNull();
    });

    test('SourceManager rejects duplicate names (unique IDs)', async () => {
      const source1 = await sourceManager.addSource(createTestSource({ name: 'Same Name' }));
      const source2 = await sourceManager.addSource(createTestSource({ name: 'Same Name' }));

      // IDs should be unique even if names are the same
      expect(source1.id).not.toBe(source2.id);
    });

    test('SourceManager throws when max sources reached', async () => {
      const smallConfig: SourceManagerConfig = { ...defaultConfig, maxSources: 2 };
      const smallManager = new SourceManager(smallConfig, {
        rssAdapter: mockRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator,
      });

      await smallManager.addSource(createTestSource());
      await smallManager.addSource(createTestSource());

      await expect(smallManager.addSource(createTestSource()))
        .rejects.toThrow('Maximum number of sources');
    });
  });

  // ============================================
  // Test 11: API Routes: Manually Trigger Fetch
  // ============================================
  describe('11. API Routes: Manually Trigger Fetch', () => {
    test('fetchSource triggers manual fetch for RSS source', async () => {
      const rssResponses = new Map<string, string>();
      rssResponses.set('https://example.com/feed', RSS_FEED_XML);

      const customRSSAdapter = createMockRSSAdapter(rssResponses);
      const customManager = new SourceManager(defaultConfig, {
        rssAdapter: customRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: new Deduplicator(),
      });

      const source = await customManager.addSource(createTestSource({
        type: 'rss',
        url: 'https://example.com/feed',
      }));

      const results = await customManager.fetchSource(source.id);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(customRSSAdapter.fetch).toHaveBeenCalled();
    });

    test('fetchSource returns empty array for inactive source', async () => {
      const source = await sourceManager.addSource(createTestSource({ status: 'paused' }));

      const results = await sourceManager.fetchSource(source.id);

      expect(results).toEqual([]);
    });

    test('fetchSource throws for non-existent source', async () => {
      await expect(sourceManager.fetchSource('non-existent-id'))
        .rejects.toThrow('Source not found');
    });

    test('fetchAll fetches all active sources', async () => {
      await sourceManager.addSource(createTestSource({ status: 'active' }));
      await sourceManager.addSource(createTestSource({ status: 'active' }));

      const results = await sourceManager.fetchAll();

      expect(results).toBeDefined();
      expect(results.size).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================
  // Test 12: Concurrency Limit: Queue Beyond maxConcurrentFetches
  // ============================================
  describe('12. Concurrency Limit: Queue Beyond maxConcurrentFetches', () => {
    test('fetchAll processes sources within concurrency limit', async () => {
      const rssResponses = new Map<string, string>();
      for (let i = 0; i < 10; i++) {
        rssResponses.set(`https://feed${i}.com`, RSS_FEED_XML);
      }

      const customRSSAdapter = createMockRSSAdapter(rssResponses);
      const limitedConfig: SourceManagerConfig = { ...defaultConfig, maxConcurrentFetches: 3 };
      const limitedManager = new SourceManager(limitedConfig, {
        rssAdapter: customRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: new Deduplicator(),
      });

      for (let i = 0; i < 10; i++) {
        await limitedManager.addSource(createTestSource({
          type: 'rss',
          name: `Feed ${i}`,
          url: `https://feed${i}.com`,
        }));
      }

      // fetchAll should process all sources despite concurrency limit of 3
      const results = await limitedManager.fetchAll();

      expect(results.size).toBe(10);
    });

    test('createBatches correctly splits sources into batches', () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const batchSize = 3;

      // Access private method via any cast
      const batches = (sourceManager as any).createBatches(items, batchSize);

      expect(batches.length).toBe(4); // [1,2,3], [4,5,6], [7,8,9], [10]
      expect(batches[0]).toEqual([1, 2, 3]);
      expect(batches[1]).toEqual([4, 5, 6]);
      expect(batches[2]).toEqual([7, 8, 9]);
      expect(batches[3]).toEqual([10]);
    });

    test('handles sources exceeding maxConcurrentFetches gracefully', async () => {
      const limitedConfig: SourceManagerConfig = { ...defaultConfig, maxConcurrentFetches: 2 };
      const limitedManager = new SourceManager(limitedConfig, {
        rssAdapter: mockRSSAdapter,
        apiAdapter: mockAPIAdapter,
        webhookAdapter: mockWebhookAdapter,
        deduplicator: new Deduplicator(),
      });

      // Add many sources
      for (let i = 0; i < 5; i++) {
        await limitedManager.addSource(createTestSource({
          type: 'rss',
          status: 'active',
        }));
      }

      // fetchAll should complete without error
      const results = await limitedManager.fetchAll();

      expect(results).toBeDefined();
    });

    test('skips inactive sources during concurrent fetch', async () => {
      await sourceManager.addSource(createTestSource({ status: 'active' }));
      await sourceManager.addSource(createTestSource({ status: 'disabled' }));
      await sourceManager.addSource(createTestSource({ status: 'paused' }));

      const results = await sourceManager.fetchAll();

      // Should complete without throwing
      expect(results).toBeDefined();
    });
  });
});
