/**
 * StrategistLLMEnhancer.test.ts - LLM 增强器测试
 * Phase 1: Step 5 - Strategist LLM 增强
 */

import * as fs from 'fs';
import { StrategistLLMEnhancer } from '../StrategistLLMEnhancer';
import type { Proposal, ScanResult, ProposalType } from '../../types';

// -----------------------------------------------
// Mock external dependencies
// -----------------------------------------------

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock('../../../stratix-agent/core/LLMConnector', () => ({
  LLMConnector: jest.fn().mockImplementation(() => ({
    generate: jest.fn(),
  })),
}));

jest.mock('../../../stratix-core/config/GlobalProviderSettings', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn().mockReturnValue({
      getDefaultProvider: jest.fn().mockReturnValue({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
      }),
      getFirstAvailableProvider: jest.fn().mockReturnValue({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
      }),
    }),
  },
}));;

// -----------------------------------------------
// Helpers
// -----------------------------------------------

const createProposal = (overrides?: Partial<Proposal>): Proposal => ({
  id: 'proposal-1',
  timestamp: new Date(),
  type: 'improve_code' as ProposalType,
  title: 'Test Proposal',
  description: 'Test description',
  target: { file: 'src/test.ts', component: undefined, zone: undefined },
  selection: {
    confidence: 0.5,
    cost: 5,
    benefit: 5,
    risk: 'medium' as const,
  },
  status: 'pending' as const,
  ...overrides,
});

const createScanResult = (overrides?: Partial<ScanResult>): ScanResult => ({
  timestamp: new Date(),
  coverage: {
    totalStatements: 100,
    totalBranches: 50,
    totalFunctions: 20,
    totalLines: 100,
    coveredStatements: 30,
    coveredBranches: 20,
    coveredFunctions: 10,
    coveredLines: 30,
    uncoveredFiles: ['src/uncovered.ts'],
    threshold: 50,
  },
  types: {
    errors: [{ file: 'src/type-error.ts', line: 10, column: 1, message: 'Type error', code: 2322 }],
    warnings: [],
    success: false,
  },
  lint: {
    errors: [{ file: 'src/lint-error.ts', line: 1, column: 1, message: 'Lint error', rule: 'no-console', severity: 'error' }],
    warnings: [],
    success: false,
    fatalErrorCount: 0,
  },
  sizes: {
    files: [{ path: 'src/large.ts', lines: 600, isLarge: true }],
    threshold: 500,
  },
  ...overrides,
});

// -----------------------------------------------
// Test suite
// -----------------------------------------------

describe('StrategistLLMEnhancer', () => {
  let enhancer: StrategistLLMEnhancer;
  let mockFs: jest.Mocked<typeof import('fs')>;
  let LLMConnector: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-apply mock implementations after clearAllMocks
    const SettingsModule = require('../../../stratix-core/config/GlobalProviderSettings');
    SettingsModule.default.getInstance.mockReturnValue({
      getDefaultProvider: jest.fn().mockReturnValue({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
      }),
      getFirstAvailableProvider: jest.fn().mockReturnValue({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
      }),
    });

    enhancer = new StrategistLLMEnhancer({ cwd: '/project' });

    mockFs = require('fs');
    LLMConnector = require('../../../stratix-agent/core/LLMConnector').LLMConnector;
  });

  describe('constructor', () => {
    it('should use default config values', () => {
      const instance = new StrategistLLMEnhancer();
      // Access private config via any
      const config = (instance as unknown as { config: Record<string, unknown> }).config;
      expect(config.providerId).toBe('default');
      expect(config.model).toBe('claude-sonnet-4-20250514');
      expect(config.maxTokens).toBe(2048);
      expect(config.temperature).toBe(0.3);
      expect(config.timeoutMs).toBe(30000);
    });

    it('should accept custom config values', () => {
      const instance = new StrategistLLMEnhancer({
        providerId: 'custom-provider',
        model: 'custom-model',
        maxTokens: 1024,
        temperature: 0.7,
        timeoutMs: 15000,
        cwd: '/custom/path',
      });
      const config = (instance as unknown as { config: Record<string, unknown> }).config;
      expect(config.providerId).toBe('custom-provider');
      expect(config.model).toBe('custom-model');
      expect(config.maxTokens).toBe(1024);
      expect(config.temperature).toBe(0.7);
      expect(config.timeoutMs).toBe(15000);
    });

    it('should apply partial config with defaults', () => {
      const instance = new StrategistLLMEnhancer({ maxTokens: 512 });
      const config = (instance as unknown as { config: Record<string, unknown> }).config;
      expect(config.maxTokens).toBe(512);
      expect(config.temperature).toBe(0.3); // default
    });
  });

  describe('enrichProposal()', () => {
    it('should return proposal unchanged when no target file', async () => {
      const proposal = createProposal({ target: {} });
      const result = await enhancer.enrichProposal(proposal);
      expect(result).toEqual(proposal);
    });

    it('should return proposal unchanged when source file read fails', async () => {
      mockFs.promises.readFile = jest.fn().mockRejectedValue(new Error('File not found'));
      const proposal = createProposal({ target: { file: 'nonexistent.ts' } });
      const result = await enhancer.enrichProposal(proposal);
      expect(result).toEqual(proposal);
    });

    it('should return proposal unchanged when LLM returns no enhanced description', async () => {
      mockFs.promises.readFile = jest.fn().mockResolvedValue('const x = 1;');

      // Mock LLMConnector instance
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({ success: true, suggestions: [], estimatedCost: 5, estimatedBenefit: 5 }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const proposal = createProposal();
      const result = await enhancer2.enrichProposal(proposal);
      // Returns proposal as-is when enhancedDescription is missing
      expect(result.description).toBe(proposal.description);
    });

    it('should return enriched proposal when LLM returns valid response', async () => {
      const sourceCode = 'const x = 1;';
      mockFs.promises.readFile = jest.fn().mockResolvedValue(sourceCode);

      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          suggestions: [{ action: 'Add type annotation', reason: 'Improves type safety', risk: 'low', confidence: 0.9 }],
          enhancedDescription: 'Add explicit type annotation to variable x',
          estimatedCost: 2,
          estimatedBenefit: 8,
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const proposal = createProposal();
      const result = await enhancer2.enrichProposal(proposal);

      expect(result.description).toBe('Add explicit type annotation to variable x');
      expect(result.selection.cost).toBe(2);
      expect(result.selection.benefit).toBe(8);
      expect(result.selection.confidence).toBe(0.9);
    });

    it('should handle JSON code block in LLM response', async () => {
      mockFs.promises.readFile = jest.fn().mockResolvedValue('const x = 1;');

      const mockGenerate = jest.fn().mockResolvedValue({
        content: 'Here is my analysis:\n```json\n{"success":true,"suggestions":[],"enhancedDescription":"Improved description","estimatedCost":3,"estimatedBenefit":7}\n```',
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const proposal = createProposal();
      const result = await enhancer2.enrichProposal(proposal);

      expect(result.description).toBe('Improved description');
    });

    it('should handle partial JSON match in LLM response', async () => {
      mockFs.promises.readFile = jest.fn().mockResolvedValue('const x = 1;');

      const mockGenerate = jest.fn().mockResolvedValue({
        content: 'Some text before {"success":true,"suggestions":[],"enhancedDescription":"Partial match","estimatedCost":4,"estimatedBenefit":6} some text after',
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const proposal = createProposal();
      const result = await enhancer2.enrichProposal(proposal);

      expect(result.description).toBe('Partial match');
    });

    it('should fall back to original proposal selection when suggestions array is empty', async () => {
      mockFs.promises.readFile = jest.fn().mockResolvedValue('const x = 1;');

      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          success: true,
          suggestions: [],
          enhancedDescription: 'Enhanced',
          estimatedCost: 3,
          estimatedBenefit: 7,
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const proposal = createProposal({ selection: { confidence: 0.5, cost: 5, benefit: 5, risk: 'medium' } });
      const result = await enhancer2.enrichProposal(proposal);

      // Falls back to original selection since suggestions[0] is undefined
      expect(result.selection.cost).toBe(3);
      expect(result.selection.benefit).toBe(7);
      expect(result.selection.confidence).toBe(0.5); // original
    });
  });

  describe('analyzeArchitecture()', () => {
    it('should return empty array when LLM returns no proposals', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({ success: true, proposals: [] }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const scanResult = createScanResult();
      const result = await enhancer2.analyzeArchitecture(scanResult);

      expect(result).toEqual([]);
    });

    it('should return empty array when LLM call fails', async () => {
      const mockGenerate = jest.fn().mockRejectedValue(new Error('LLM error'));
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const scanResult = createScanResult();
      const result = await enhancer2.analyzeArchitecture(scanResult);

      expect(result).toEqual([]);
    });

    it('should return empty array when LLM response has no content', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({ content: undefined });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const scanResult = createScanResult();
      const result = await enhancer2.analyzeArchitecture(scanResult);

      expect(result).toEqual([]);
    });

    it('should return parsed proposals with required fields', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          proposals: [
            {
              type: 'improve_architecture',
              title: 'Reduce file size',
              description: 'Split large files',
              target: { file: 'src/large.ts', component: 'MainComponent' },
              confidence: 0.8,
              cost: 7,
              benefit: 9,
              risk: 'medium',
            },
          ],
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const scanResult = createScanResult();
      const result = await enhancer2.analyzeArchitecture(scanResult);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('improve_architecture');
      expect(result[0].title).toBe('Reduce file size');
      expect(result[0].description).toBe('Split large files');
      expect(result[0].target.file).toBe('src/large.ts');
      expect(result[0].target.component).toBe('MainComponent');
      expect(result[0].selection.confidence).toBe(0.8);
      expect(result[0].selection.cost).toBe(7);
      expect(result[0].selection.benefit).toBe(9);
      expect(result[0].selection.risk).toBe('medium');
      expect(result[0].status).toBe('pending');
    });

    it('should clamp confidence, cost, benefit to valid ranges', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          proposals: [
            {
              type: 'improve_code',
              title: 'Test',
              description: 'Test',
              confidence: 1.5, // > 1, should clamp to 1
              cost: 15, // > 10, should clamp to 10
              benefit: -5, // < 1, should clamp to 1
              risk: 'invalid', // should default to medium
            },
          ],
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const scanResult = createScanResult();
      const result = await enhancer2.analyzeArchitecture(scanResult);

      expect(result[0].selection.confidence).toBe(1);
      expect(result[0].selection.cost).toBe(10);
      expect(result[0].selection.benefit).toBe(1);
      expect(result[0].selection.risk).toBe('medium');
    });

    it('should normalize unknown proposal types to improve_code', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          proposals: [
            {
              type: 'unknown_type',
              title: 'Test',
              description: 'Test',
            },
          ],
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const scanResult = createScanResult();
      const result = await enhancer2.analyzeArchitecture(scanResult);

      expect(result[0].type).toBe('improve_code');
    });

    it('should generate unique IDs for each proposal', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          proposals: [
            { type: 'improve_code', title: 'Test1', description: 'Test1' },
            { type: 'improve_code', title: 'Test2', description: 'Test2' },
          ],
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const scanResult = createScanResult();
      const result = await enhancer2.analyzeArchitecture(scanResult);

      expect(result[0].id).not.toBe(result[1].id);
    });

    it('should handle JSON code block in architecture response', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({
        content: '```json\n{"proposals":[{"type":"improve_architecture","title":"Refactor","description":"Refactor large files","confidence":0.9,"cost":6,"benefit":8,"risk":"low"}]}\n```',
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const scanResult = createScanResult();
      const result = await enhancer2.analyzeArchitecture(scanResult);

      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Refactor');
    });
  });

  describe('enrichProposals()', () => {
    it('should return enriched proposals for multiple proposals', async () => {
      mockFs.promises.readFile = jest.fn().mockResolvedValue('const x = 1;');

      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          suggestions: [],
          enhancedDescription: 'Enhanced',
          estimatedCost: 3,
          estimatedBenefit: 7,
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const proposals = [
        createProposal({ id: 'p1' }),
        createProposal({ id: 'p2' }),
      ];
      const result = await enhancer2.enrichProposals(proposals);

      expect(result.length).toBe(2);
    });

    it('should keep original proposal on error during enrichment', async () => {
      mockFs.promises.readFile = jest.fn()
        .mockResolvedValueOnce('const x = 1;')
        .mockRejectedValueOnce(new Error('Read error'));

      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          suggestions: [],
          enhancedDescription: 'Enhanced',
          estimatedCost: 3,
          estimatedBenefit: 7,
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const proposals = [
        createProposal({ id: 'p1' }),
        createProposal({ id: 'p2', target: { file: 'error.ts' } }),
      ];
      const result = await enhancer2.enrichProposals(proposals);

      expect(result.length).toBe(2);
      expect(result[0].description).toBe('Enhanced');
      expect(result[1]).toEqual(proposals[1]); // Original kept
    });

    it('should handle empty proposals array', async () => {
      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const result = await enhancer2.enrichProposals([]);
      expect(result).toEqual([]);
    });
  });

  describe('LLM provider fallback', () => {
    it('should fallback to environment variables when GlobalProviderSettings not available', async () => {
      jest.resetModules();

      // Mock GlobalProviderSettings to throw
      jest.doMock('../../../stratix-core/config/GlobalProviderSettings', () => {
        throw new Error('Module not available');
      });

      // Mock LLMConnector for the re-imported module
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          suggestions: [],
          enhancedDescription: 'Enhanced',
          estimatedCost: 2,
          estimatedBenefit: 8,
        }),
      });
      jest.doMock('../../../stratix-agent/core/LLMConnector', () => ({
        LLMConnector: jest.fn().mockImplementation(() => ({
          generate: mockGenerate,
        })),
      }));

      jest.doMock('fs', () => ({
        promises: {
          readFile: jest.fn().mockResolvedValue('const x = 1;'),
        },
      }));

      // Set env before re-import
      const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      try {
        // Re-import to pick up the new mocks
        const { StrategistLLMEnhancer: EnhancedEnhancer } = require('../StrategistLLMEnhancer');
        const enhancer2 = new EnhancedEnhancer({ cwd: '/project' });
        const proposal = createProposal();
        const result = await enhancer2.enrichProposal(proposal);

        expect(result.description).toBe('Enhanced');
      } finally {
        if (originalAnthropicKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });
  });
});
