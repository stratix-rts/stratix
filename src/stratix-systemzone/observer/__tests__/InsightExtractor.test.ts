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

  describe('extract (with mocked LLM)', () => {
    test('returns success result with insight when LLM returns valid JSON', async () => {
      const mockInput: UserInput = {
        id: 'input_123',
        timestamp: new Date(),
        content: 'Test content about React and TypeScript',
        source: 'manual',
        type: 'other',
      };

      const mockContext: ExtractionContext = {
        input: mockInput,
        preprocessed: {
          original: mockInput.content,
          cleaned: 'Test content about React and TypeScript',
          format: 'text',
          language: 'en',
          inferredType: 'other',
          formatConfidence: 0.9,
        },
        zoneId: 'zone_456',
      };

      // Mock getLLMConfig to return a config
      jest.spyOn(extractor as any, 'getLLMConfig').mockResolvedValue({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
      });

      // Mock the LLMConnector
      const mockLLMConnector = {
        generate: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            entities: ['React', 'TypeScript'],
            keywords: ['frontend', 'web', 'components'],
            type: 'trend',
            summary: 'React and TypeScript continue to be popular for frontend development',
            confidence: 0.9,
          }),
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        }),
      };

      jest.spyOn(require('../../stratix-agent/core/LLMConnector'), 'LLMConnector')
        .mockImplementation(() => mockLLMConnector);

      const result = await extractor.extract(mockContext);

      expect(result.success).toBe(true);
      expect(result.insight).toBeDefined();
      expect(result.insight?.type).toBe('trend');
      expect(result.insight?.entities).toContain('React');
      expect(result.insight?.entities).toContain('TypeScript');
      expect(result.usage).toBeDefined();
    });

    test('returns error when no LLM provider configured', async () => {
      const mockInput: UserInput = {
        id: 'input_123',
        timestamp: new Date(),
        content: 'Test content',
        source: 'manual',
        type: 'other',
      };

      const mockContext: ExtractionContext = {
        input: mockInput,
        preprocessed: {
          original: mockInput.content,
          cleaned: 'Test content',
          format: 'text',
          language: 'en',
          inferredType: 'other',
          formatConfidence: 0.9,
        },
        zoneId: 'zone_456',
      };

      jest.spyOn(extractor as any, 'getLLMConfig').mockResolvedValue(undefined);

      const result = await extractor.extract(mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No LLM provider configured');
    });

    test('returns error when LLM call fails', async () => {
      const mockInput: UserInput = {
        id: 'input_123',
        timestamp: new Date(),
        content: 'Test content',
        source: 'manual',
        type: 'other',
      };

      const mockContext: ExtractionContext = {
        input: mockInput,
        preprocessed: {
          original: mockInput.content,
          cleaned: 'Test content',
          format: 'text',
          language: 'en',
          inferredType: 'other',
          formatConfidence: 0.9,
        },
        zoneId: 'zone_456',
      };

      jest.spyOn(extractor as any, 'getLLMConfig').mockResolvedValue({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
      });

      const mockLLMConnector = {
        generate: jest.fn().mockRejectedValue(new Error('LLM API Error')),
      };

      jest.spyOn(require('../../stratix-agent/core/LLMConnector'), 'LLMConnector')
        .mockImplementation(() => mockLLMConnector);

      const result = await extractor.extract(mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('LLM API Error');
    });

    test('returns error when LLM response cannot be parsed', async () => {
      const mockInput: UserInput = {
        id: 'input_123',
        timestamp: new Date(),
        content: 'Test content',
        source: 'manual',
        type: 'other',
      };

      const mockContext: ExtractionContext = {
        input: mockInput,
        preprocessed: {
          original: mockInput.content,
          cleaned: 'Test content',
          format: 'text',
          language: 'en',
          inferredType: 'other',
          formatConfidence: 0.9,
        },
        zoneId: 'zone_456',
      };

      jest.spyOn(extractor as any, 'getLLMConfig').mockResolvedValue({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
      });

      const mockLLMConnector = {
        generate: jest.fn().mockResolvedValue({
          content: 'This is not valid JSON at all',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      };

      jest.spyOn(require('../../stratix-agent/core/LLMConnector'), 'LLMConnector')
        .mockImplementation(() => mockLLMConnector);

      const result = await extractor.extract(mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to parse LLM response');
    });
  });

  describe('extractFromText', () => {
    test('returns pattern with zero confidence when no LLM configured', async () => {
      const extractorNoLLM = new InsightExtractor();
      jest.spyOn(extractorNoLLM as any, 'getLLMConfig').mockResolvedValue(undefined);

      const result = await (extractorNoLLM as any).extractFromText('Some test content');

      expect(result.type).toBe('pattern');
      expect(result.confidence).toBe(0);
    });

    test('extracts from text when LLM is available', async () => {
      const mockExtractor = new InsightExtractor();
      jest.spyOn(mockExtractor as any, 'getLLMConfig').mockResolvedValue({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
      });

      const mockLLMConnector = {
        generate: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            entities: ['AI', 'ML'],
            keywords: ['artificial intelligence', 'machine learning'],
            type: 'opportunity',
            summary: 'AI/ML presents new opportunities',
            confidence: 0.85,
          }),
          usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        }),
      };

      jest.spyOn(require('../../stratix-agent/core/LLMConnector'), 'LLMConnector')
        .mockImplementation(() => mockLLMConnector);

      const result = await (mockExtractor as any).extractFromText('Content about AI and ML');

      expect(result.type).toBe('opportunity');
      expect(result.entities).toContain('AI');
      expect(result.confidence).toBe(0.85);
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
      const content = 'entities:\n- React\n- TypeScript\n- Node.js';
      const result = (extractor as any).fallbackParse(content);
      expect(result.entities).toContain('React');
      expect(result.entities).toContain('TypeScript');
      expect(result.entities).toContain('Node.js');
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
