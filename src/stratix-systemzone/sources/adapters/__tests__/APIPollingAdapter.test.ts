// ============================================
// APIPollingAdapter.test.ts
// Phase 3 - P3-04
// ============================================

import { APIPollingAdapter } from '../APIPollingAdapter';
import type { APIPollConfig } from '../APIPollingAdapter';

describe('APIPollingAdapter', () => {
  let adapter: APIPollingAdapter;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    adapter = new APIPollingAdapter();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ============================================
  // computeHash tests
  // ============================================

  describe('computeHash', () => {
    test('computes consistent hash for same object', () => {
      const obj = { name: 'test', value: 123 };
      const hash1 = adapter.computeHash(obj);
      const hash2 = adapter.computeHash(obj);
      expect(hash1).toBe(hash2);
    });

    test('computes different hash for different objects', () => {
      const obj1 = { name: 'test1' };
      const obj2 = { name: 'test2' };
      expect(adapter.computeHash(obj1)).not.toBe(adapter.computeHash(obj2));
    });

    test('computes same hash regardless of key order', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };
      expect(adapter.computeHash(obj1)).toBe(adapter.computeHash(obj2));
    });

    test('computes hash for primitive values', () => {
      const hashStr = adapter.computeHash('hello');
      const hashNum = adapter.computeHash(42);
      expect(hashStr).toBeTruthy();
      expect(hashNum).toBeTruthy();
      expect(hashStr).not.toBe(hashNum);
    });
  });

  // ============================================
  // buildRequest tests
  // ============================================

  describe('buildRequest', () => {
    test('builds GET request correctly', () => {
      const config: APIPollConfig = {
        endpoint: 'https://api.example.com/data',
        method: 'GET',
        refreshInterval: 60000,
      };

      const request = adapter.buildRequest(config);

      expect(request.url).toBe('https://api.example.com/data');
      expect(request.method).toBe('GET');
      expect(request.headers['Content-Type']).toBe('application/json');
      expect(request.signal).toBeDefined();
    });

    test('builds POST request with body', () => {
      const config: APIPollConfig = {
        endpoint: 'https://api.example.com/data',
        method: 'POST',
        body: '{"query":"test"}',
        refreshInterval: 60000,
      };

      const request = adapter.buildRequest(config);

      expect(request.method).toBe('POST');
      expect(request.body).toBe('{"query":"test"}');
    });

    test('preserves custom headers', () => {
      const config: APIPollConfig = {
        endpoint: 'https://api.example.com/data',
        method: 'GET',
        headers: {
          Authorization: 'Bearer token123',
          'X-Custom-Header': 'custom-value',
        },
        refreshInterval: 60000,
      };

      const request = adapter.buildRequest(config);

      expect(request.headers['Authorization']).toBe('Bearer token123');
      expect(request.headers['X-Custom-Header']).toBe('custom-value');
    });
  });

  // ============================================
  // parseResponse tests
  // ============================================

  describe('parseResponse', () => {
    test('returns array as-is when no path specified', () => {
      const data = [{ id: 1 }, { id: 2 }];
      const result = adapter.parseResponse(data);
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    test('wraps non-array in array when no path specified', () => {
      const data = { id: 1 };
      const result = adapter.parseResponse(data);
      expect(result).toEqual([{ id: 1 }]);
    });

    test('parses simple dot notation path', () => {
      const data = { data: { items: [{ id: 1 }, { id: 2 }] } };
      const result = adapter.parseResponse(data, 'data.items');
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    test('parses nested dot notation path', () => {
      const data = { level1: { level2: { items: ['a', 'b', 'c'] } } };
      const result = adapter.parseResponse(data, 'level1.level2.items');
      expect(result).toEqual(['a', 'b', 'c']);
    });

    test('returns empty array for missing path', () => {
      const data = { foo: 'bar' };
      const result = adapter.parseResponse(data, 'nonexistent.path');
      expect(result).toEqual([]);
    });

    test('returns empty array when path leads to null', () => {
      const data = { data: null };
      const result = adapter.parseResponse(data, 'data.items');
      expect(result).toEqual([]);
    });

    test('parses array index access', () => {
      const data = { data: { items: ['first', 'second', 'third'] } };
      const result = adapter.parseResponse(data, 'data.items[1]');
      expect(result).toEqual(['second']);
    });

    test('extracts field from array of objects', () => {
      const data = {
        results: [
          { name: 'item1', value: 100 },
          { name: 'item2', value: 200 },
        ],
      };
      const result = adapter.parseResponse(data, 'results.name');
      expect(result).toEqual(['item1', 'item2']);
    });
  });

  // ============================================
  // mapToRawInput tests
  // ============================================

  describe('mapToRawInput', () => {
    test('maps items with all fields', () => {
      const items = [
        {
          title: 'Article Title',
          content: 'Article content here',
          url: 'https://example.com/article',
          author: 'John Doe',
          publishedAt: '2024-01-15T10:00:00Z',
        },
      ];

      const result = adapter.mapToRawInput(items, 'source-1', 'article');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Article Title');
      expect(result[0].content).toBe('Article content here');
      expect(result[0].url).toBe('https://example.com/article');
      expect(result[0].author).toBe('John Doe');
      expect(result[0].sourceId).toBe('source-1');
      expect(result[0].sourceType).toBe('api_poll');
      expect(result[0].contentType).toBe('article');
      expect(result[0].hash).toBeTruthy();
      expect(result[0].fetchedAt).toBeInstanceOf(Date);
    });

    test('uses name field as title when title not present', () => {
      const items = [{ name: 'Item Name', body: 'Content body' }];

      const result = adapter.mapToRawInput(items, 'source-1', 'other');

      expect(result[0].title).toBe('Item Name');
      expect(result[0].content).toBe('Content body');
    });

    test('handles missing optional fields with defaults', () => {
      const items = [{}];

      const result = adapter.mapToRawInput(items, 'source-1', 'changelog');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Untitled');
      expect(result[0].content).toBe('');
      expect(result[0].url).toBeUndefined();
      expect(result[0].author).toBeUndefined();
    });

    test('filters out null/invalid items', () => {
      const items = [
        { title: 'Valid' },
        null,
        { title: 'Also Valid' },
        'string item',
        undefined,
      ];

      const result = adapter.mapToRawInput(items as any, 'source-1', 'issue');

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Valid');
      expect(result[1].title).toBe('Also Valid');
    });

    test('parses ISO date strings', () => {
      const items = [{ title: 'Test', date: '2024-06-01T12:00:00Z' }];

      const result = adapter.mapToRawInput(items, 'source-1', 'release');

      expect(result[0].publishedAt).toBeInstanceOf(Date);
      expect(result[0].publishedAt?.toISOString()).toContain('2024-06-01');
    });

    test('generates unique IDs for each item', () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];

      const result = adapter.mapToRawInput(items, 'source-1', 'commit');

      const ids = result.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });

    test('stores original item in metadata', () => {
      const items = [{ title: 'Original', customField: 'keep' }];

      const result = adapter.mapToRawInput(items, 'source-1', 'other');

      expect(result[0].metadata?.originalItem).toEqual({ title: 'Original', customField: 'keep' });
    });
  });

  // ============================================
  // poll tests (mocked fetch)
  // ============================================

  describe('poll', () => {
    const mockConfig: APIPollConfig = {
      endpoint: 'https://api.example.com/items',
      method: 'GET',
      refreshInterval: 60000,
    };

    test('returns RawInput array from successful response', async () => {
      const mockResponse = {
        data: {
          items: [{ title: 'Item 1', body: 'Content 1' }],
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.poll(mockConfig, 'source-1', 'article');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Item 1');
      expect(result[0].content).toBe('Content 1');
    });

    test('uses responsePath to extract nested data', async () => {
      const mockResponse = {
        results: [{ title: 'Nested Item' }],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const configWithPath: APIPollConfig = {
        ...mockConfig,
        responsePath: 'results',
      };

      const result = await adapter.poll(configWithPath, 'source-1', 'changelog');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Nested Item');
    });

    test('throws on HTTP error status', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(adapter.poll(mockConfig, 'source-1')).rejects.toThrow('HTTP 500');
    });

    test('throws on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

      await expect(adapter.poll(mockConfig, 'source-1')).rejects.toThrow('Network failure');
    });

    test('retries once on failure', async () => {
      const mockResponse = { items: [{ title: 'Success' }] };

      let attempts = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.reject(new Error('Transient error'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });
      });

      const result = await adapter.poll(mockConfig, 'source-1', 'issue');

      expect(attempts).toBe(2);
      expect(result).toHaveLength(1);
    });

    test('sends POST with body correctly', async () => {
      const postConfig: APIPollConfig = {
        endpoint: 'https://api.example.com/search',
        method: 'POST',
        body: JSON.stringify({ query: 'test' }),
        headers: { 'Content-Type': 'application/json' },
        refreshInterval: 30000,
      };

      let capturedRequest: RequestInit | undefined;
      global.fetch = jest.fn().mockImplementation((url, init) => {
        capturedRequest = init;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ results: [] }),
        });
      });

      await adapter.poll(postConfig, 'source-1');

      expect(capturedRequest?.method).toBe('POST');
      expect(capturedRequest?.body).toBe(JSON.stringify({ query: 'test' }));
    });
  });
});
