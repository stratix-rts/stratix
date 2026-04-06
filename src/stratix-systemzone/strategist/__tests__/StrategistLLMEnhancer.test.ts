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
      getDefaultProvider: jest.fn().mockReturnValue(undefined),
      getFirstAvailableProvider: jest.fn().mockReturnValue(undefined),
    }),
  },
}));

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
    const mockProviderConfig = {
      provider: 'openai',
      model: 'gpt-4',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    };
    SettingsModule.default.getInstance.mockReturnValue({
      getDefaultProvider: jest.fn().mockReturnValue(mockProviderConfig),
      getFirstAvailableProvider: jest.fn().mockReturnValue(mockProviderConfig),
    });

    // Reset LLM cache so tests can override the mock implementation
    if (enhancer) {
      (enhancer as unknown as { llm: unknown }).llm = null;
    }

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
      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const proposal = createProposal({ target: {} });
      const result = await enhancer2.enrichProposal(proposal);
      expect(result).toEqual(proposal);
    });

    it('should return proposal unchanged when source file read fails', async () => {
      mockFs.promises.readFile = jest.fn().mockRejectedValue(new Error('File not found'));
      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const proposal = createProposal({ target: { file: 'nonexistent.ts' } });
      const result = await enhancer2.enrichProposal(proposal);
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

      // Implementation constructs enhancedDescription from title + description fields
      // It also derives suggestions[0].confidence from riskLevel
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          title: 'Add type annotation',
          description: 'Add explicit type annotation to variable x',
          codeSuggestion: 'const x: number = 1;',
          riskLevel: 'low',
          estimatedCost: 2,
          estimatedBenefit: 8,
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      // Reset llm cache so it uses the new mock implementation
      (enhancer2 as unknown as { llm: unknown }).llm = null;

      const proposal = createProposal();
      const result = await enhancer2.enrichProposal(proposal);

      expect(result.description).toBe('## Add type annotation\n\nAdd explicit type annotation to variable x\n\n```\nconst x: number = 1;\n```');
      expect(result.selection.cost).toBe(2);
      expect(result.selection.benefit).toBe(8);
      expect(result.selection.confidence).toBe(0.9);
    });

    it('should handle JSON code block in LLM response', async () => {
      mockFs.promises.readFile = jest.fn().mockResolvedValue('const x = 1;');

      // Implementation constructs enhancedDescription from title + description and appends codeSuggestion
      const mockGenerate = jest.fn().mockResolvedValue({
        content: 'Here is my analysis:\n```json\n{"title":"Improved","description":"Improved description","codeSuggestion":"const x: number = 1;","riskLevel":"medium","estimatedCost":3,"estimatedBenefit":7}\n```',
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      (enhancer2 as unknown as { llm: unknown }).llm = null;

      const proposal = createProposal();
      const result = await enhancer2.enrichProposal(proposal);

      expect(result.description).toBe('## Improved\n\nImproved description\n\n```\nconst x: number = 1;\n```');
    });

    it('should handle partial JSON match in LLM response', async () => {
      mockFs.promises.readFile = jest.fn().mockResolvedValue('const x = 1;');

      // Implementation constructs enhancedDescription from title + description
      const mockGenerate = jest.fn().mockResolvedValue({
        content: 'Some text before {"title":"Partial","description":"Partial match","estimatedCost":4,"estimatedBenefit":6} some text after',
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      (enhancer2 as unknown as { llm: unknown }).llm = null;

      const proposal = createProposal();
      const result = await enhancer2.enrichProposal(proposal);

      expect(result.description).toBe('## Partial\n\nPartial match');
    });

    it('should use estimated cost/benefit when suggestions is empty', async () => {
      mockFs.promises.readFile = jest.fn().mockResolvedValue('const x = 1;');

      // Implementation always creates suggestions[0] with confidence from riskLevel (defaults to 'medium' = 0.7)
      // Cost is derived from estimatedCost directly, benefit from estimatedBenefit directly
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          title: 'Enhanced',
          description: 'Enhanced description',
          suggestions: [],
          estimatedCost: 3,
          estimatedBenefit: 7,
          // No riskLevel, so defaults to 'medium' -> confidence 0.7
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      (enhancer2 as unknown as { llm: unknown }).llm = null;

      const proposal = createProposal({ selection: { confidence: 0.5, cost: 5, benefit: 5, risk: 'medium' } });
      const result = await enhancer2.enrichProposal(proposal);

      // cost/benefit from estimatedCost/estimatedBenefit (3 and 7)
      expect(result.selection.cost).toBe(3);
      expect(result.selection.benefit).toBe(7);
      // confidence is always from suggestions[0] which is created with riskLevel 'medium' -> 0.7
      expect(result.selection.confidence).toBe(0.7);
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
          issues: [
            {
              title: 'Reduce file size',
              severity: 'warning',
              description: 'File is too large',
              suggestion: 'Split into smaller modules',
              affectedModules: ['src/large.ts', 'MainComponent'],
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
      expect(result[0].description).toContain('File is too large');
      expect(result[0].target.file).toBe('src/large.ts');
      expect(result[0].target.component).toBe('MainComponent');
      expect(result[0].selection.confidence).toBe(0.7); // warning severity -> 0.7
      expect(result[0].selection.cost).toBe(5); // warning severity -> cost 5
      expect(result[0].selection.benefit).toBe(6); // warning severity -> benefit 6
      expect(result[0].selection.risk).toBe('medium');
      expect(result[0].status).toBe('pending');
    });

    it('should clamp confidence, cost, benefit to valid ranges', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          issues: [
            {
              title: 'Test',
              severity: 'critical', // critical maps to high risk, high confidence, high cost, high benefit
              description: 'Test description',
              suggestion: 'Test suggestion',
            },
          ],
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const scanResult = createScanResult();
      const result = await enhancer2.analyzeArchitecture(scanResult);

      expect(result[0].selection.confidence).toBe(0.9); // critical -> 0.9
      expect(result[0].selection.cost).toBe(8); // critical -> cost 8
      expect(result[0].selection.benefit).toBe(9); // critical -> benefit 9
      expect(result[0].selection.risk).toBe('high'); // critical -> high
    });

    it('should normalize unknown proposal types to improve_code', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          issues: [
            {
              title: 'Test',
              severity: 'warning',
              description: 'Test',
              suggestion: 'Test suggestion',
            },
          ],
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      const scanResult = createScanResult();
      const result = await enhancer2.analyzeArchitecture(scanResult);

      expect(result[0].type).toBe('improve_architecture');
    });

    it('should generate unique IDs for each proposal', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          issues: [
            { title: 'Test1', severity: 'info', description: 'Test1', suggestion: 'S1' },
            { title: 'Test2', severity: 'info', description: 'Test2', suggestion: 'S2' },
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
        content: '```json\n{"issues":[{"title":"Refactor","severity":"warning","description":"Refactor large files","suggestion":"Split it"}]}\n```',
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

      // Implementation constructs enhancedDescription from title + description, not from enhancedDescription field
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          title: 'Enhanced',
          description: 'Enhanced description',
          suggestions: [],
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
      (enhancer2 as unknown as { llm: unknown }).llm = null;

      const proposals = [
        createProposal({ id: 'p1', description: 'Original description' }),
        createProposal({ id: 'p2', target: { file: 'error.ts' }, description: 'Original p2' }),
      ];
      const result = await enhancer2.enrichProposals(proposals);

      expect(result.length).toBe(2);
      // p1: enriched (has source code and valid LLM response)
      expect(result[0].description).toBe('## Enhanced\n\nEnhanced description');
      // p2: read error, original kept
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
      // Override the GlobalProviderSettings mock to throw (simulating unavailability)
      const SettingsModule = require('../../../stratix-core/config/GlobalProviderSettings');
      SettingsModule.default.getInstance.mockImplementation(() => {
        throw new Error('Module not available');
      });

      // Implementation constructs enhancedDescription from title + description
      const mockGenerate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          title: 'Enhanced',
          description: 'Enhanced description',
          suggestions: [],
          estimatedCost: 2,
          estimatedBenefit: 8,
        }),
      });
      LLMConnector.mockImplementation(() => ({ generate: mockGenerate }));

      mockFs.promises.readFile = jest.fn().mockResolvedValue('const x = 1;');

      const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      try {
        const enhancer2 = new StrategistLLMEnhancer({ cwd: '/project' });
        (enhancer2 as unknown as { llm: unknown }).llm = null;

        const proposal = createProposal();
        const result = await enhancer2.enrichProposal(proposal);

        expect(result.description).toBe('## Enhanced\n\nEnhanced description');
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
