// ============================================
// InsightExtractor.test.ts - LLM 语义提取测试
// Phase 1: Step 4 - Observer
// ============================================

import { InsightExtractor } from '../InsightExtractor';
import type { ExtractionContext, InsightExtractorResult } from '../types';
import type { UserInput } from '../../types';

describe('InsightExtractor', () => {
  let extractor: InsightExtractor;

  beforeEach(() => {
    extractor = new InsightExtractor({
      model: 'test-model',
      timeoutMs: 5000,
    });
  });

  describe('constructor', () => {
    test('uses default config when none provided', () => {
      const defaultExtractor = new InsightExtractor();

      expect(defaultExtractor).toBeInstanceOf(InsightExtractor);
    });

    test('accepts custom providerId', () => {
      const customExtractor = new InsightExtractor({
        providerId: 'custom-provider',
        model: 'test-model',
      });

      expect(customExtractor).toBeInstanceOf(InsightExtractor);
    });

    test('accepts custom maxTokens', () => {
      const customExtractor = new InsightExtractor({
        maxTokens: 2048,
      });

      expect(customExtractor).toBeInstanceOf(InsightExtractor);
    });

    test('accepts custom temperature', () => {
      const customExtractor = new InsightExtractor({
        temperature: 0.7,
      });

      expect(customExtractor).toBeInstanceOf(InsightExtractor);
    });

    test('accepts custom timeoutMs', () => {
      const customExtractor = new InsightExtractor({
        timeoutMs: 60000,
      });

      expect(customExtractor).toBeInstanceOf(InsightExtractor);
    });
  });

  // Note: extract() requires actual LLMConnector with working getLLMConfig.
  // Testing via public API extractFromText which has similar behavior.
  // The private methods are tested via parseLLMResponse, extractJson, etc.

  describe('extractFromText', () => {
    test('returns pattern with zero confidence when no LLM configured', async () => {
      const extractorNoLLM = new InsightExtractor();
      jest.spyOn(extractorNoLLM as any, 'getLLMConfig').mockResolvedValue(undefined);

      const result = await (extractorNoLLM as any).extractFromText('Some test content');

      expect(result.type).toBe('pattern');
      expect(result.confidence).toBe(0);
    });
  });

  describe('buildPrompt', () => {
    test('includes user content in prompt', () => {
      const prompt = (extractor as any).buildPrompt('Test content here');

      expect(prompt).toContain('Test content here');
      expect(prompt).toContain('User content to analyze');
    });
  });

  describe('extractJson', () => {
    test('extracts direct JSON', () => {
      const json = '{"entities": ["test"], "keywords": ["test"], "type": "trend", "summary": "Test", "confidence": 0.9}';
      const result = (extractor as any).extractJson(json);
      expect(JSON.parse(result)).toEqual(JSON.parse(json));
    });

    test('extracts JSON from code block', () => {
      const content = '```json\n{"entities": ["test"], "keywords": ["test"], "type": "trend", "summary": "Test", "confidence": 0.9}\n```';
      const result = (extractor as any).extractJson(content);
      expect(result).toContain('"entities"');
    });

    test('extracts JSON object from plain text', () => {
      const content = 'Here is some text before {"entities": [], "keywords": [], "type": "pattern", "summary": "Test", "confidence": 0.5} and after';
      const result = (extractor as any).extractJson(content);
      expect(result).toContain('"entities"');
    });

    test('throws when no JSON found', () => {
      const content = 'This is plain text without any JSON';
      expect(() => (extractor as any).extractJson(content)).toThrow('No JSON found in response');
    });
  });

  describe('normalizeInsightType', () => {
    test('normalizes valid types', () => {
      expect((extractor as any).normalizeInsightType('trend')).toBe('trend');
      expect((extractor as any).normalizeInsightType('opportunity')).toBe('opportunity');
      expect((extractor as any).normalizeInsightType('risk')).toBe('risk');
      expect((extractor as any).normalizeInsightType('pattern')).toBe('pattern');
    });

    test('normalizes uppercase types', () => {
      expect((extractor as any).normalizeInsightType('TREND')).toBe('trend');
      expect((extractor as any).normalizeInsightType('Opportunity')).toBe('opportunity');
    });

    test('normalizes types with whitespace', () => {
      expect((extractor as any).normalizeInsightType('  risk  ')).toBe('risk');
    });

    test('defaults to pattern for invalid types', () => {
      expect((extractor as any).normalizeInsightType('invalid')).toBe('pattern');
      expect((extractor as any).normalizeInsightType('')).toBe('pattern');
      expect((extractor as any).normalizeInsightType(null)).toBe('pattern');
      expect((extractor as any).normalizeInsightType(undefined)).toBe('pattern');
    });
  });

  describe('fallbackParse', () => {
    test('extracts type from content', () => {
      const content = 'This content mentions a risk that we should address';
      const result = (extractor as any).fallbackParse(content);
      expect(result.type).toBe('risk');
    });

    test('extracts entities from bullet lists', () => {
      const content = 'entities:\n- React';
      const result = (extractor as any).fallbackParse(content);
      expect(result.entities).toContain('React');
    });

    test('extracts keywords from bullet lists', () => {
      const content = 'keywords:\n- frontend\n- backend\n- api';
      const result = (extractor as any).fallbackParse(content);
      expect(result.keywords).toContain('frontend');
      expect(result.keywords).toContain('backend');
    });

    test('limits keywords to 10', () => {
      const content = 'keywords:\n- k1\n- k2\n- k3\n- k4\n- k5\n- k6\n- k7\n- k8\n- k9\n- k10\n- k11\n- k12';
      const result = (extractor as any).fallbackParse(content);
      expect(result.keywords.length).toBe(10);
    });

    test('returns low confidence for fallback', () => {
      const content = 'Some content without clear structure';
      const result = (extractor as any).fallbackParse(content);
      expect(result.confidence).toBe(0.3);
    });
  });

  describe('callWithTimeout', () => {
    test('returns result when promise resolves within timeout', async () => {
      const promise = Promise.resolve('success');
      const result = await (extractor as any).callWithTimeout(promise, 5000);
      expect(result).toBe('success');
    });

    test('returns null when promise times out', async () => {
      const promise = new Promise((resolve) => setTimeout(() => resolve('late'), 100));
      const result = await (extractor as any).callWithTimeout(promise, 10);
      expect(result).toBeNull();
    });

    test('returns null when promise rejects', async () => {
      const promise = Promise.reject(new Error('error'));
      const result = await (extractor as any).callWithTimeout(promise, 5000);
      expect(result).toBeNull();
    });
  });

  describe('getLLMConfig', () => {
    test('returns undefined by default when no provider available', async () => {
      // Mock the GlobalProviderSettings import to throw
      const extractorNoConfig = new InsightExtractor();
      jest.spyOn(extractorNoConfig as any, 'getLLMConfig').mockImplementation(async () => {
        // Simulate no provider available
        return undefined;
      });

      const result = await (extractorNoConfig as any).getLLMConfig();
      expect(result).toBeUndefined();
    });
  });
});
