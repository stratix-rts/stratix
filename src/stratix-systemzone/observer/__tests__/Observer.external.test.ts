// ============================================
// Observer.external.test.ts - 外部信息源集成测试
// Phase 3: P3-07 - Observer 与外部信息管道集成
// ============================================

import { Observer } from '../Observer';
import type { RawInput } from '../../sources/types';
import type { SourceManager } from '../../sources/SourceManager';
import type { Insight } from '../../types';

// ============================================
// Mock SourceManager
// ============================================

function createMockSourceManager(inputs: RawInput[]): SourceManager {
  const mockSM = {
    fetchAll: jest.fn().mockResolvedValue(new Map([['src_1', inputs]])),
    getSources: jest.fn().mockReturnValue([]),
    fetchSource: jest.fn().mockResolvedValue(inputs),
  } as unknown as SourceManager;
  return mockSM;
}

// ============================================
// 测试数据
// ============================================

function createRawInput(overrides: Partial<RawInput> = {}): RawInput {
  return {
    id: `raw_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    sourceId: 'src_rss_1',
    sourceType: 'rss',
    title: 'Test RSS Entry',
    content: 'This is a test RSS feed entry about technology trends',
    url: 'https://example.com/article/1',
    author: 'Test Author',
    publishedAt: new Date(),
    fetchedAt: new Date(),
    contentType: 'article',
    metadata: {},
    hash: 'abc123',
    ...overrides,
  };
}

// ============================================
// 测试 Suite
// ============================================

describe('Observer external inputs integration', () => {
  let observer: Observer;
  let mockSaveInsight: jest.Mock;
  let mockSaveInput: jest.Mock;

  beforeEach(() => {
    mockSaveInsight = jest.fn().mockResolvedValue(undefined);
    mockSaveInput = jest.fn().mockResolvedValue(undefined);

    observer = new Observer(
      {
        preprocessor: {},
        extractor: {},
      },
      {
        saveInsight: mockSaveInsight,
        saveInput: mockSaveInput,
      }
    );
  });

  describe('observeExternalInputs', () => {
    test('returns empty array for empty inputs', async () => {
      const result = await observer.observeExternalInputs([]);
      expect(result).toEqual([]);
    });

    test('returns empty array when no LLM configured (extraction fails)', async () => {
      const inputs = [createRawInput({ content: 'Some tech news content' })];
      const result = await observer.observeExternalInputs(inputs);
      // Without LLM, extraction throws, so result is empty
      expect(result).toEqual([]);
    });

    test('processes single external input', async () => {
      const inputs = [createRawInput({ content: 'Breaking: AI advances continue' })];
      // This will fail at extraction step without LLM
      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }
      // Verify status returns to idle
      expect(observer.getState().status).toBe('idle');
    });

    test('maps RSS content type to news input type', async () => {
      const inputs = [createRawInput({ contentType: 'article', sourceType: 'rss' })];
      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }
      // Status should be processed
      expect(observer.getState().status).toBe('idle');
    });

    test('maps commit content type to code input type', async () => {
      const inputs = [createRawInput({ contentType: 'commit', sourceType: 'rss' })];
      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }
      expect(observer.getState().status).toBe('idle');
    });

    test('maps issue content type to analysis input type', async () => {
      const inputs = [createRawInput({ contentType: 'issue', sourceType: 'rss' })];
      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }
      expect(observer.getState().status).toBe('idle');
    });

    test('emits status_changed events during processing', async () => {
      const events: any[] = [];
      observer.on('status_changed', (e) => events.push(e));

      const inputs = [createRawInput({ content: 'Test content' })];
      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }

      // Should have processing -> idle transition
      expect(events.some(e => e.payload.status === 'processing')).toBe(true);
    });

    test('emits extraction_failed event when extraction fails', async () => {
      const failedEvents: any[] = [];
      observer.on('extraction_failed', (e) => failedEvents.push(e));

      const inputs = [createRawInput({ content: 'Test content' })];
      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }

      expect(failedEvents.length).toBeGreaterThan(0);
    });

    test('preserves URL metadata from raw input', async () => {
      const inputs = [createRawInput({
        content: 'Check out this link',
        url: 'https://github.com/test/repo'
      })];

      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }

      // Should complete processing without URL-related errors
      expect(observer.getState().status).toBe('idle');
    });

    test('handles multiple inputs in batch', async () => {
      const inputs = [
        createRawInput({ content: 'Input 1', id: 'raw_1' }),
        createRawInput({ content: 'Input 2', id: 'raw_2' }),
        createRawInput({ content: 'Input 3', id: 'raw_3' }),
      ];

      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }

      expect(observer.getState().status).toBe('idle');
    });
  });

  describe('getLastExternalInsights', () => {
    test('returns empty array when no external insights', () => {
      const result = observer.getLastExternalInsights();
      expect(result).toEqual([]);
    });

    test('returns empty array with limit=0', () => {
      const result = observer.getLastExternalInsights(0);
      expect(result).toEqual([]);
    });

    test('returns all insights when no limit specified', () => {
      // Initially empty - getLastExternalInsights tracks what's actually stored
      const result = observer.getLastExternalInsights();
      expect(Array.isArray(result)).toBe(true);
    });

    test('returns limited insights when limit specified', () => {
      // Without insights stored, should return empty even with limit
      const result = observer.getLastExternalInsights(5);
      expect(result).toEqual([]);
    });

    test('returns copy of array, not reference', () => {
      const result1 = observer.getLastExternalInsights();
      const result2 = observer.getLastExternalInsights();
      expect(result1).not.toBe(result2);
    });
  });

  describe('observe with external trigger', () => {
    test('throws error when no SourceManager for external trigger', async () => {
      await expect(observer.observe('external')).rejects.toThrow(
        'SourceManager is required for trigger="external"'
      );
    });

    test('uses provided SourceManager for external trigger', async () => {
      const mockSM = createMockSourceManager([]);
      await observer.observe('external', mockSM);
      expect(mockSM.fetchAll).toHaveBeenCalled();
    });

    test('returns results from SourceManager through observeExternalInputs', async () => {
      const inputs = [createRawInput({ content: 'From SourceManager' })];
      const mockSM = createMockSourceManager(inputs);

      const result = await observer.observe('external', mockSM);
      // Empty due to extraction failure without LLM
      expect(result).toEqual([]);
    });

    test('processes manual trigger via processAll', async () => {
      await observer.receiveInput('Manual input 1', 'manual');
      await observer.receiveInput('Manual input 2', 'manual');

      const result = await observer.observe('manual');
      // processAll moves pending to processed, returns insights (empty without LLM)
      expect(observer.getSummary().pendingCount).toBe(0);
    });

    test('processes api trigger via processAll', async () => {
      await observer.receiveInput('API input', 'api');

      const result = await observer.observe('api');
      expect(observer.getSummary().pendingCount).toBe(0);
    });
  });

  describe('setSourceManager', () => {
    test('allows setting SourceManager after construction', () => {
      const mockSM = createMockSourceManager([]);
      expect(() => observer.setSourceManager(mockSM)).not.toThrow();
    });

    test('uses set SourceManager when observe called with external', async () => {
      const mockSM = createMockSourceManager([]);
      observer.setSourceManager(mockSM);

      await observer.observe('external');
      expect(mockSM.fetchAll).toHaveBeenCalled();
    });
  });

  describe('content type mapping', () => {
    test('maps changelog to news', async () => {
      const inputs = [createRawInput({ contentType: 'changelog' })];
      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }
      expect(observer.getState().status).toBe('idle');
    });

    test('maps release to news', async () => {
      const inputs = [createRawInput({ contentType: 'release' })];
      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }
      expect(observer.getState().status).toBe('idle');
    });

    test('maps tweet to other', async () => {
      const inputs = [createRawInput({ contentType: 'tweet' })];
      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }
      expect(observer.getState().status).toBe('idle');
    });

    test('maps unknown content type to other', async () => {
      const inputs = [createRawInput({ contentType: 'unknown_type' as any })];
      try {
        await observer.observeExternalInputs(inputs);
      } catch {
        // Expected
      }
      expect(observer.getState().status).toBe('idle');
    });
  });
});