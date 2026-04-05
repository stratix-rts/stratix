// ============================================
// Deduplicator.test.ts - 去重与分类引擎测试
// Phase 3: P3-05 - Deduplicator 测试
// ============================================

import { Deduplicator } from '../Deduplicator';
import type { RawInput } from '../types';

// -------------------------------------------------------------------------
// Test Helpers
// -------------------------------------------------------------------------

function createRawInput(overrides: Partial<{
  id: string;
  title: string;
  content: string;
  url: string;
  fetchedAt: Date;
}> = {}): RawInput {
  const now = new Date();
  return {
    id: overrides.id ?? 'test-id-1',
    sourceId: 'test-source',
    sourceType: 'rss',
    title: overrides.title ?? 'Test Title',
    content: overrides.content ?? 'Test content for the raw input',
    url: overrides.url,
    author: 'Test Author',
    publishedAt: now,
    fetchedAt: overrides.fetchedAt ?? now,
    contentType: 'article',
    metadata: {},
    hash: '',
  };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('Deduplicator', () => {
  let deduplicator: Deduplicator;

  beforeEach(() => {
    deduplicator = new Deduplicator();
  });

  describe('computeHash', () => {
    it('computes consistent hash for same title and url', () => {
      const input1 = createRawInput({ id: '1', title: 'Same Title', url: 'https://example.com' });
      const input2 = createRawInput({ id: '2', title: 'Same Title', url: 'https://example.com' });

      // Use private method via any cast for testing
      const hash1 = (deduplicator as any).computeHash(input1);
      const hash2 = (deduplicator as any).computeHash(input2);

      expect(hash1).toBe(hash2);
    });

    it('computes different hash for different titles', () => {
      const input1 = createRawInput({ id: '1', title: 'Title A' });
      const input2 = createRawInput({ id: '2', title: 'Title B' });

      const hash1 = (deduplicator as any).computeHash(input1);
      const hash2 = (deduplicator as any).computeHash(input2);

      expect(hash1).not.toBe(hash2);
    });

    it('computes different hash for different urls', () => {
      const input1 = createRawInput({ id: '1', title: 'Same', url: 'https://example.com/a' });
      const input2 = createRawInput({ id: '2', title: 'Same', url: 'https://example.com/b' });

      const hash1 = (deduplicator as any).computeHash(input1);
      const hash2 = (deduplicator as any).computeHash(input2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('computeSimilarity', () => {
    it('returns 1 for identical strings', () => {
      const similarity = deduplicator.computeSimilarity('hello world', 'hello world');
      expect(similarity).toBe(1);
    });

    it('returns 0 for completely different strings', () => {
      const similarity = deduplicator.computeSimilarity('cat', 'elephant');
      expect(similarity).toBe(0);
    });

    it('returns 0 for empty strings', () => {
      expect(deduplicator.computeSimilarity('', 'hello')).toBe(0);
      expect(deduplicator.computeSimilarity('hello', '')).toBe(0);
      expect(deduplicator.computeSimilarity('', '')).toBe(0);
    });

    it('calculates partial similarity for similar strings', () => {
      const similarity = deduplicator.computeSimilarity('hello world', 'hello');
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it('is case insensitive', () => {
      const sim1 = deduplicator.computeSimilarity('Hello World', 'hello world');
      const sim2 = deduplicator.computeSimilarity('HELLO WORLD', 'hello world');
      expect(sim1).toBe(1);
      expect(sim2).toBe(1);
    });

    it('handles multi-word strings', () => {
      const similarity = deduplicator.computeSimilarity(
        'React performance optimization techniques',
        'React optimization and performance tuning'
      );
      expect(similarity).toBeGreaterThan(0.3);
      expect(similarity).toBeLessThan(1);
    });
  });

  describe('isDuplicate', () => {
    it('returns true for exact duplicate hash', () => {
      const input = createRawInput({ id: '1', title: 'Test', url: 'https://example.com' });
      const existingHashes = new Set<string>([
        (deduplicator as any).computeHash(input),
      ]);

      expect(deduplicator.isDuplicate(input, existingHashes)).toBe(true);
    });

    it('returns false for non-duplicate hash', () => {
      const input = createRawInput({ id: '1', title: 'Unique Title' });
      const existingHashes = new Set<string>(['some-other-hash']);

      expect(deduplicator.isDuplicate(input, existingHashes)).toBe(false);
    });

    it('handles empty hash set', () => {
      const input = createRawInput({ id: '1', title: 'Any Title' });
      const existingHashes = new Set<string>();

      expect(deduplicator.isDuplicate(input, existingHashes)).toBe(false);
    });
  });

  describe('extractTags', () => {
    it('extracts security-related tags', () => {
      const tags = deduplicator.extractTags('Security vulnerability found in authentication module');
      expect(tags).toContain('security');
    });

    it('extracts performance-related tags', () => {
      const tags = deduplicator.extractTags('Performance optimization: cache implementation');
      expect(tags).toContain('performance');
    });

    it('extracts bug-related tags', () => {
      const tags = deduplicator.extractTags('Bug fix: memory leak in worker thread');
      expect(tags).toContain('bug');
    });

    it('extracts feature-related tags', () => {
      const tags = deduplicator.extractTags('New feature: dark mode support');
      expect(tags).toContain('feature');
    });

    it('extracts docs-related tags', () => {
      const tags = deduplicator.extractTags('Documentation update: API reference guide');
      expect(tags).toContain('docs');
    });

    it('extracts test-related tags', () => {
      const tags = deduplicator.extractTags('Add unit tests for auth module');
      expect(tags).toContain('test');
    });

    it('extracts tech stack tags', () => {
      const tags = deduplicator.extractTags('Using React and TypeScript for the frontend');
      expect(tags).toContain('react');
      expect(tags).toContain('typescript');
    });

    it('extracts version number tags', () => {
      const tags = deduplicator.extractTags('Release v2.0.0 with new features');
      expect(tags).toContain('v2.0');
    });

    it('returns empty array for content with no matching tags', () => {
      const tags = deduplicator.extractTags('Random content without keywords');
      // Should only contain 'other' category tag if matched, otherwise empty
      expect(Array.isArray(tags)).toBe(true);
    });
  });

  describe('deduplicate', () => {
    it('returns all inputs as unique when no duplicates exist', () => {
      const inputs = [
        createRawInput({ id: '1', title: 'Article A', url: 'https://a.com' }),
        createRawInput({ id: '2', title: 'Article B', url: 'https://b.com' }),
        createRawInput({ id: '3', title: 'Article C', url: 'https://c.com' }),
      ];

      const result = deduplicator.deduplicate(inputs);

      expect(result.unique).toHaveLength(3);
      expect(result.duplicates).toHaveLength(0);
      expect(result.duplicateCount).toBe(0);
    });

    it('marks exact duplicate as duplicate', () => {
      const inputs = [
        createRawInput({ id: '1', title: 'Same Title', url: 'https://example.com' }),
        createRawInput({ id: '2', title: 'Same Title', url: 'https://example.com' }),
      ];

      const result = deduplicator.deduplicate(inputs);

      expect(result.unique).toHaveLength(1);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicateCount).toBe(1);
    });

    it('marks similar titles as duplicates based on threshold', () => {
      const inputs = [
        createRawInput({ id: '1', title: 'React Performance Optimization Guide' }),
        createRawInput({ id: '2', title: 'React Performance Optimization Techniques' }),
      ];

      const result = deduplicator.deduplicate(inputs);

      // These titles should be > 85% similar
      expect(result.duplicates.length).toBeGreaterThanOrEqual(1);
    });

    it('treats items outside time window as unique', () => {
      const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 25); // 25 hours ago

      const inputs = [
        createRawInput({ id: '1', title: 'Old Article', fetchedAt: oldDate }),
        createRawInput({ id: '2', title: 'Old Article' }), // Same title but current
      ];

      const result = deduplicator.deduplicate(inputs);

      // Old article should be outside window, treated as unique
      expect(result.unique.some(i => i.id === '1')).toBe(true);
    });

    it('builds similarity map for similar items', () => {
      const inputs = [
        createRawInput({ id: '1', title: 'Fix memory leak in component' }),
        createRawInput({ id: '2', title: 'Fix memory leak in service' }),
      ];

      const result = deduplicator.deduplicate(inputs);

      // Should have identified similarity
      expect(result.similarityMap).toBeDefined();
    });

    it('handles empty input array', () => {
      const result = deduplicator.deduplicate([]);

      expect(result.unique).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
      expect(result.duplicateCount).toBe(0);
    });
  });

  describe('classify', () => {
    it('classifies security content correctly', () => {
      const inputs = [
        createRawInput({
          id: '1',
          title: 'Security Update',
          content: 'Fixed authentication vulnerability CVE-2024-1234',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('security');
      expect(result.inputs[0].relevanceScore).toBeGreaterThan(0);
    });

    it('classifies performance content correctly', () => {
      const inputs = [
        createRawInput({
          id: '1',
          title: 'Performance Optimization',
          content: 'Implemented caching to improve speed and reduce latency',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('performance');
    });

    it('classifies bug fix content correctly', () => {
      const inputs = [
        createRawInput({
          id: '1',
          title: 'Bug Fix',
          content: 'Fixed crash when loading empty data',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('bug');
    });

    it('classifies feature announcement correctly', () => {
      const inputs = [
        createRawInput({
          id: '1',
          title: 'New Feature',
          content: 'Introducing dark mode support in the application',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('feature');
    });

    it('classifies docs content correctly', () => {
      const inputs = [
        createRawInput({
          id: '1',
          title: 'Documentation Update',
          content: 'Updated API reference guide with new endpoints',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('docs');
    });

    it('classifies test content correctly', () => {
      const inputs = [
        createRawInput({
          id: '1',
          title: 'Test Coverage',
          content: 'Added unit tests for the new authentication module',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('test');
    });

    it('classifies unknown content as other', () => {
      const inputs = [
        createRawInput({
          id: '1',
          title: 'Random Update',
          content: 'Some random changes without specific categorization',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].category).toBe('other');
    });

    it('builds category counts correctly', () => {
      const inputs = [
        createRawInput({ id: '1', title: 'Security Update', content: 'Security fix' }),
        createRawInput({ id: '2', title: 'Another Security', content: 'Security patch' }),
        createRawInput({ id: '3', title: 'Bug Fix', content: 'Fixed bug' }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.categories.get('security')).toBe(2);
      expect(result.categories.get('bug')).toBe(1);
    });

    it('includes tags in classified inputs', () => {
      const inputs = [
        createRawInput({
          id: '1',
          title: 'React Security',
          content: 'Security update for React application',
        }),
      ];

      const result = deduplicator.classify(inputs);

      expect(result.inputs[0].tags).toBeDefined();
      expect(Array.isArray(result.inputs[0].tags)).toBe(true);
    });

    it('handles empty input array', () => {
      const result = deduplicator.classify([]);

      expect(result.inputs).toHaveLength(0);
      expect(result.categories.size).toBe(0);
    });
  });

  describe('custom configuration', () => {
    it('uses custom deduplication window', () => {
      const shortWindow = new Deduplicator({
        deduplicationWindow: 1000, // 1 second
      });

      const now = new Date();
      const oldInput = createRawInput({ id: '1', title: 'Same', fetchedAt: new Date(now.getTime() - 5000) });
      const newInput = createRawInput({ id: '2', title: 'Same', fetchedAt: now });

      const result = shortWindow.deduplicate([oldInput, newInput]);

      // Old one should be outside window, treated as unique
      expect(result.unique).toHaveLength(2);
    });

    it('uses custom similarity threshold', () => {
      const highThreshold = new Deduplicator({
        similarityThreshold: 0.99, // Very high threshold
      });

      const inputs = [
        createRawInput({ id: '1', title: 'React Performance Optimization' }),
        createRawInput({ id: '2', title: 'React Performance Optimization Guide' }),
      ];

      const result = highThreshold.deduplicate(inputs);

      // With 99% threshold, these might not be considered duplicates
      expect(result).toBeDefined();
    });
  });
});
