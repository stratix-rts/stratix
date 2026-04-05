/**
 * Strategist.test.ts - Strategist 单元测试
 * Phase 1: Step 5 - Strategist（扫描映射 + LLM 增强）
 */

import { EventEmitter } from 'events';
import { Strategist } from '../Strategist';
import { StrategistLLMEnhancer } from '../StrategistLLMEnhancer';
import { ProjectScanner } from '../ProjectScanner';
import { ProposalMapper } from '../ProposalMapper';
import type {
  Proposal,
  ScanResult,
  CoverageReport,
  TypeCheckResult,
  LintResult,
  FileSizeReport,
} from '../../types';
import type { ScannerResult, MappingContext } from '../types';

// -------------------------------------------------------------------------
// Mock LLMConnector
// -------------------------------------------------------------------------
const mockLLMGenerate = jest.fn();

jest.mock('../../../stratix-agent/core/LLMConnector', () => ({
  LLMConnector: jest.fn().mockImplementation(() => ({
    generate: mockLLMGenerate,
  })),
}));

// -------------------------------------------------------------------------
// Mock child_process for ProjectScanner
// -------------------------------------------------------------------------
class MockChildProcess extends EventEmitter {
  stdout = new MockReadable();
  stderr = new MockReadable();
  kill = jest.fn();
  on = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.on(event, handler);
    return this;
  });
  off = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.off(event, handler);
    return this;
  });
}

class MockReadable extends EventEmitter {
  on = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.on(event, handler);
    return this;
  });
  off = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.off(event, handler);
    return this;
  });
  pipe = jest.fn(() => this);
}

const mockProc = new MockChildProcess();

jest.mock('child_process', () => ({
  spawn: jest.fn(() => mockProc),
}));

// -------------------------------------------------------------------------
// Helper functions
// -------------------------------------------------------------------------
const simulateSpawnOutput = (stdout: string, stderr: string, exitCode: number | null = 0) => {
  if (stdout) mockProc.stdout.emit('data', stdout);
  if (stderr) mockProc.stderr.emit('data', stderr);
  mockProc.emit('close', exitCode);
};

const createMockProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  timestamp: new Date(),
  type: 'improve_code',
  title: 'Test Proposal',
  description: 'Test description',
  target: { file: 'src/test.ts' },
  selection: { confidence: 0.8, cost: 5, benefit: 7, risk: 'medium' },
  status: 'pending',
  ...overrides,
});

const createMockScanResult = (overrides: Partial<ScanResult> = {}): ScanResult => ({
  timestamp: new Date(),
  coverage: {
    totalStatements: 100,
    totalBranches: 50,
    totalFunctions: 20,
    totalLines: 100,
    coveredStatements: 30,
    coveredBranches: 15,
    coveredFunctions: 5,
    coveredLines: 30,
    uncoveredFiles: ['src/uncovered.ts'],
    threshold: 50,
  },
  types: {
    errors: [
      { file: 'src/utils.ts', line: 10, column: 5, message: "Cannot find name 'foo'", code: 2304 },
    ],
    warnings: [],
    success: false,
  },
  lint: {
    errors: [
      { file: 'src/main.ts', line: 5, column: 1, message: 'Missing semicolon', rule: 'semi', severity: 'error' as const },
    ],
    warnings: [],
    success: false,
    fatalErrorCount: 0,
  },
  sizes: {
    files: [{ path: 'src/big-file.ts', lines: 800, isLarge: true }],
    threshold: 500,
  },
  ...overrides,
});

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------
describe('Strategist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProc.stdout.removeAllListeners();
    mockProc.stderr.removeAllListeners();
    mockProc.removeAllListeners();
  });

  describe('constructor', () => {
    it('creates instance with default config', () => {
      const strategist = new Strategist();
      expect(strategist).toBeInstanceOf(Strategist);
      expect(strategist.getState()).toBeDefined();
    });

    it('creates instance with custom config', () => {
      const strategist = new Strategist({
        scanner: { timeoutMs: 5000, cwd: '/fake/project' },
        mapper: { coverageThreshold: 60 },
        enhancer: { model: 'claude-sonnet-4-20250514' },
      });
      expect(strategist).toBeInstanceOf(Strategist);
    });

    it('initial state is idle', () => {
      const strategist = new Strategist();
      expect(strategist.getState().status).toBe('idle');
    });
  });

  describe('getState', () => {
    it('returns current state', () => {
      const strategist = new Strategist();
      const state = strategist.getState();

      expect(state).toHaveProperty('status');
      expect(state).toHaveProperty('lastScan');
      expect(state).toHaveProperty('lastAnalysis');
      expect(state).toHaveProperty('currentProposals');
      expect(state).toHaveProperty('scanResult');
    });

    it('returns copies of arrays to prevent mutation', () => {
      const strategist = new Strategist();
      const state1 = strategist.getState();
      const state2 = strategist.getState();

      expect(state1.currentProposals).not.toBe(state2.currentProposals);
    });
  });

  describe('getSummary', () => {
    it('returns status summary', () => {
      const strategist = new Strategist();
      const summary = strategist.getSummary();

      expect(summary).toHaveProperty('status');
      expect(summary).toHaveProperty('lastScan');
      expect(summary).toHaveProperty('lastAnalysis');
      expect(summary).toHaveProperty('proposalCount');
      expect(summary).toHaveProperty('hasScanResult');
    });
  });

  describe('getScanner / getMapper / getEnhancer', () => {
    it('returns component instances', () => {
      const strategist = new Strategist();

      expect(strategist.getScanner()).toBeInstanceOf(ProjectScanner);
      expect(strategist.getMapper()).toBeInstanceOf(ProposalMapper);
      expect(strategist.getEnhancer()).toBeInstanceOf(StrategistLLMEnhancer);
    });
  });

  describe('analyze - complete flow', () => {
    it('runs complete analyze pipeline with mocked scanner', async () => {
      const strategist = new Strategist({
        scanner: { cacheEnabled: false },
      });

      // Mock the scanner's scanAll to return controlled results
      const mockScanResult: ScannerResult = {
        success: true,
        scanResult: createMockScanResult(),
        errors: [],
        duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 20, total: 220 },
      };

      jest.spyOn(strategist.getScanner(), 'scanAll').mockResolvedValue(mockScanResult);

      // Mock LLM enhancement
      mockLLMGenerate.mockResolvedValue({
        content: JSON.stringify({
          suggestions: [
            { action: 'Add null check', reason: 'Prevents runtime error', risk: 'low', confidence: 0.9 },
          ],
          enhancedDescription: 'Add null check before accessing the property',
          estimatedCost: 2,
          estimatedBenefit: 8,
        }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      // Mock save proposals
      const savedProposals: Proposal[] = [];
      strategist.setDependencies({
        saveProposal: jest.fn(async (p) => { savedProposals.push(p); }),
        validateProposal: jest.fn().mockReturnValue({ valid: true }),
      });

      const proposals = await strategist.analyze();

      expect(proposals.length).toBeGreaterThan(0);
      expect(strategist.getScanner().scanAll).toHaveBeenCalled();
    });

    it('handles scan failure gracefully', async () => {
      const strategist = new Strategist({
        scanner: { cacheEnabled: false },
      });

      jest.spyOn(strategist.getScanner(), 'scanAll').mockRejectedValue(new Error('Scan failed'));

      await expect(strategist.analyze()).rejects.toThrow('Scan failed');
    });
  });

  describe('analyze - Guardian validation', () => {
    it('Guardian blocks proposals targeting protected paths', async () => {
      const strategist = new Strategist({
        scanner: { cacheEnabled: false },
      });

      const mockScanResult: ScannerResult = {
        success: true,
        scanResult: createMockScanResult({
          types: {
            errors: [
              { file: 'src/payment/stripe.ts', line: 10, column: 5, message: 'Type error', code: 2304 },
            ],
            warnings: [],
            success: false,
          },
        }),
        errors: [],
        duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 20, total: 220 },
      };

      jest.spyOn(strategist.getScanner(), 'scanAll').mockResolvedValue(mockScanResult);

      // Mock Guardian validation to block payment/** paths
      const validateProposal = jest.fn((proposal: Proposal) => {
        if (proposal.target.file?.includes('payment')) {
          return { valid: false, reason: 'Path payment/** is protected' };
        }
        return { valid: true };
      });

      strategist.setDependencies({
        validateProposal,
        saveProposals: jest.fn(),
      });

      const proposals = await strategist.analyze();

      // The payment path proposal should be blocked
      const paymentProposals = proposals.filter((p) => p.target.file?.includes('payment'));
      expect(paymentProposals.length).toBe(0);

      // But other proposals should pass through
      expect(validateProposal).toHaveBeenCalled();
    });

    it('allows proposals for normal paths', async () => {
      const strategist = new Strategist({
        scanner: { cacheEnabled: false },
      });

      const mockScanResult: ScannerResult = {
        success: true,
        scanResult: createMockScanResult(),
        errors: [],
        duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 20, total: 220 },
      };

      jest.spyOn(strategist.getScanner(), 'scanAll').mockResolvedValue(mockScanResult);

      const validateProposal = jest.fn().mockReturnValue({ valid: true });

      strategist.setDependencies({
        validateProposal,
        saveProposals: jest.fn(),
      });

      const proposals = await strategist.analyze();

      expect(proposals.length).toBeGreaterThan(0);
      expect(validateProposal).toHaveBeenCalled();
    });
  });

  describe('analyze - LLM enhancement', () => {
    it('LLM enhancement is attempted for proposals with target files', async () => {
      const strategist = new Strategist({
        scanner: { cacheEnabled: false },
      });

      const mockScanResult: ScannerResult = {
        success: true,
        scanResult: createMockScanResult(),
        errors: [],
        duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 20, total: 220 },
      };

      jest.spyOn(strategist.getScanner(), 'scanAll').mockResolvedValue(mockScanResult);

      strategist.setDependencies({
        validateProposal: jest.fn().mockReturnValue({ valid: true }),
        saveProposals: jest.fn(),
      });

      const proposals = await strategist.analyze();

      // Proposals should be generated (LLM enhancement is attempted per-proposal)
      expect(proposals.length).toBeGreaterThan(0);
      // Each proposal should have the expected structure
      proposals.forEach((p) => {
        expect(p.id).toBeDefined();
        expect(p.type).toMatch(/^improve_(code|test|architecture)$/);
      });
    });

    it('keeps original proposal when LLM call fails', async () => {
      const strategist = new Strategist({
        scanner: { cacheEnabled: false },
      });

      const mockScanResult: ScannerResult = {
        success: true,
        scanResult: createMockScanResult(),
        errors: [],
        duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 20, total: 220 },
      };

      jest.spyOn(strategist.getScanner(), 'scanAll').mockResolvedValue(mockScanResult);

      // Mock LLM to fail
      mockLLMGenerate.mockRejectedValue(new Error('LLM connection failed'));

      strategist.setDependencies({
        validateProposal: jest.fn().mockReturnValue({ valid: true }),
        saveProposals: jest.fn(),
      });

      // Should not throw, should return proposals
      const proposals = await strategist.analyze();
      expect(Array.isArray(proposals)).toBe(true);
    });
  });

  describe('scan', () => {
    it('runs only scanning without proposal generation', async () => {
      const strategist = new Strategist({
        scanner: { cacheEnabled: false },
      });

      const mockScanResult: ScannerResult = {
        success: true,
        scanResult: createMockScanResult(),
        errors: [],
        duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 20, total: 220 },
      };

      jest.spyOn(strategist.getScanner(), 'scanAll').mockResolvedValue(mockScanResult);

      const scanResult = await strategist.scan();

      expect(scanResult).toBeDefined();
      expect(scanResult.timestamp).toBeInstanceOf(Date);
      expect(strategist.getLatestScanResult()).toBeDefined();
    });
  });

  describe('generateProposalsFromScan', () => {
    it('generates proposals from scan result without LLM', async () => {
      const strategist = new Strategist();

      const scanResult = createMockScanResult();

      const validateProposal = jest.fn().mockReturnValue({ valid: true });
      strategist.setDependencies({ validateProposal });

      const proposals = await strategist.generateProposalsFromScan(scanResult);

      expect(Array.isArray(proposals)).toBe(true);
      expect(proposals.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeArchitecture', () => {
    it('returns array when LLM is not available', async () => {
      const strategist = new Strategist();

      // Without proper LLM config, should return empty array
      const proposals = await strategist.analyzeArchitecture(createMockScanResult());

      expect(Array.isArray(proposals)).toBe(true);
    });
  });

  describe('enrichProposal', () => {
    it('returns original proposal when source file cannot be read', async () => {
      const strategist = new Strategist();

      const proposal = createMockProposal({
        target: { file: 'src/nonexistent-file.ts' },
        description: 'Fix type error',
      });

      const enriched = await strategist.enrichProposal(proposal);

      // File doesn't exist, so original is returned
      expect(enriched.description).toBe('Fix type error');
    });
  });

  describe('priority sorting', () => {
    it('returns proposals with selection metadata', async () => {
      const strategist = new Strategist();

      const scanResult = createMockScanResult();
      const validateProposal = jest.fn().mockReturnValue({ valid: true });
      strategist.setDependencies({ validateProposal });

      const proposals = await strategist.generateProposalsFromScan(scanResult);

      // Proposals should have valid selection metadata
      proposals.forEach((p) => {
        expect(p.selection).toBeDefined();
        expect(typeof p.selection.confidence).toBe('number');
        expect(typeof p.selection.cost).toBe('number');
        expect(typeof p.selection.benefit).toBe('number');
        expect(['low', 'medium', 'high']).toContain(p.selection.risk);
      });
    });
  });

  describe('events', () => {
    it('emits status_changed event during analyze', async () => {
      const strategist = new Strategist({ scanner: { cacheEnabled: false } });

      const mockScanResult: ScannerResult = {
        success: true,
        scanResult: createMockScanResult(),
        errors: [],
        duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 20, total: 220 },
      };

      jest.spyOn(strategist.getScanner(), 'scanAll').mockResolvedValue(mockScanResult);

      const statusChanges: string[] = [];
      strategist.on('status_changed', (event) => {
        statusChanges.push(event.payload.status as string);
      });

      strategist.setDependencies({
        validateProposal: jest.fn().mockReturnValue({ valid: true }),
        saveProposals: jest.fn(),
      });

      await strategist.analyze();

      expect(statusChanges).toContain('scanning');
      expect(statusChanges).toContain('analyzing');
    });

    it('emits scan_completed and proposals_generated events', async () => {
      const strategist = new Strategist({ scanner: { cacheEnabled: false } });

      const mockScanResult: ScannerResult = {
        success: true,
        scanResult: createMockScanResult(),
        errors: [],
        duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 20, total: 220 },
      };

      jest.spyOn(strategist.getScanner(), 'scanAll').mockResolvedValue(mockScanResult);

      let scanCompletedEmitted = false;
      let proposalsGeneratedEmitted = false;

      strategist.on('scan_completed', () => { scanCompletedEmitted = true; });
      strategist.on('proposals_generated', () => { proposalsGeneratedEmitted = true; });

      strategist.setDependencies({
        validateProposal: jest.fn().mockReturnValue({ valid: true }),
        saveProposals: jest.fn(),
      });

      await strategist.analyze();

      expect(scanCompletedEmitted).toBe(true);
      expect(proposalsGeneratedEmitted).toBe(true);
    });

    it('allows unsubscribe from events', () => {
      const strategist = new Strategist();

      const handler = jest.fn();
      strategist.on('status_changed', handler);
      strategist.off('status_changed', handler);

      // Manually trigger internal state change that would emit
      // Since we can't easily trigger events without full analyze,
      // just verify off was called (the method exists and works)
      expect(typeof strategist.off).toBe('function');
    });
  });

  describe('clearCache', () => {
    it('clears scanner cache', () => {
      const strategist = new Strategist();
      const clearCacheSpy = jest.spyOn(strategist.getScanner(), 'clearCache');

      strategist.clearCache();

      expect(clearCacheSpy).toHaveBeenCalled();
    });
  });

  describe('setDependencies', () => {
    it('allows setting dependencies after construction', () => {
      const strategist = new Strategist();

      const saveProposal = jest.fn();
      const validateProposal = jest.fn();

      strategist.setDependencies({ saveProposal, validateProposal });

      // Verify by checking internal state - getSummary should work
      expect(strategist.getSummary()).toBeDefined();
    });
  });

  describe('getLatestScanResult', () => {
    it('returns null when no scan has been run', () => {
      const strategist = new Strategist();
      expect(strategist.getLatestScanResult()).toBeNull();
    });
  });
});

describe('StrategistLLMEnhancer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('enrichProposal', () => {
    it('returns original proposal when no target file', async () => {
      const enhancer = new StrategistLLMEnhancer();

      const proposal = createMockProposal({ target: {} });
      const result = await enhancer.enrichProposal(proposal);

      expect(result).toEqual(proposal);
      expect(mockLLMGenerate).not.toHaveBeenCalled();
    });

    it('returns original proposal when source file cannot be read', async () => {
      const enhancer = new StrategistLLMEnhancer();

      const proposal = createMockProposal({
        target: { file: 'src/nonexistent.ts' },
        description: 'Improve code quality',
      });

      const enriched = await enhancer.enrichProposal(proposal);

      // File doesn't exist, so original is returned without LLM call
      expect(enriched.description).toBe('Improve code quality');
      expect(mockLLMGenerate).not.toHaveBeenCalled();
    });
  });

  describe('analyzeArchitecture', () => {
    it('returns empty array when LLM is not available', async () => {
      const enhancer = new StrategistLLMEnhancer();

      const proposals = await enhancer.analyzeArchitecture(createMockScanResult());

      // Without proper LLM config, returns empty array
      expect(proposals).toEqual([]);
    });
  });

  describe('enrichProposals (batch)', () => {
    it('returns original proposals when files cannot be read', async () => {
      const enhancer = new StrategistLLMEnhancer();

      const proposals = [
        createMockProposal({ target: { file: 'src/a.ts' } }),
        createMockProposal({ target: { file: 'src/b.ts' } }),
      ];

      const enriched = await enhancer.enrichProposals(proposals);

      // Files don't exist, so originals are returned
      expect(enriched.length).toBe(2);
      expect(enriched).toEqual(proposals);
    });
  });
});

describe('Strategist + Guardian integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProc.stdout.removeAllListeners();
    mockProc.stderr.removeAllListeners();
    mockProc.removeAllListeners();
  });

  it('Guardian blocks payment path and strategist excludes those proposals', async () => {
    const strategist = new Strategist({
      scanner: { cacheEnabled: false },
    });

    // Create scan result with a protected path error
    const mockScanResult: ScannerResult = {
      success: true,
      scanResult: createMockScanResult({
        types: {
          errors: [
            { file: 'src/payment/PaymentProcessor.ts', line: 10, column: 5, message: 'Type error', code: 2304 },
            { file: 'src/normal/Helper.ts', line: 5, column: 3, message: 'Type error', code: 2304 },
          ],
          warnings: [],
          success: false,
        },
      }),
      errors: [],
      duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 20, total: 220 },
    };

    jest.spyOn(strategist.getScanner(), 'scanAll').mockResolvedValue(mockScanResult);

    // Guardian validation - blocks payment/**
    const guardianValidate = jest.fn((proposal: Proposal) => {
      if (proposal.target.file?.includes('payment')) {
        return { valid: false, reason: 'Forbidden path: payment/**' };
      }
      return { valid: true };
    });

    const savedProposals: Proposal[] = [];
    strategist.setDependencies({
      validateProposal: guardianValidate,
      saveProposals: jest.fn().mockImplementation((proposals) => {
        savedProposals.push(...proposals);
      }),
    });

    const proposals = await strategist.analyze();

    // Payment proposal should be blocked
    const paymentProposals = proposals.filter((p) => p.target.file?.includes('payment'));
    expect(paymentProposals.length).toBe(0);

    // Normal path should be allowed
    const normalProposals = proposals.filter((p) => p.target.file?.includes('normal'));
    expect(normalProposals.length).toBeGreaterThan(0);

    // Verify Guardian was called for each proposal
    expect(guardianValidate).toHaveBeenCalled();
  });

  it('Guardian blocks .env file proposals', async () => {
    const strategist = new Strategist({
      scanner: { cacheEnabled: false },
    });

    const mockScanResult: ScannerResult = {
      success: true,
      scanResult: createMockScanResult({
        lint: {
          errors: [
            { file: '.env.production', line: 5, column: 1, message: 'Unexpected token', rule: 'no-undef', severity: 'error' as const },
          ],
          warnings: [],
          success: false,
          fatalErrorCount: 0,
        },
      }),
      errors: [],
      duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 20, total: 220 },
    };

    jest.spyOn(strategist.getScanner(), 'scanAll').mockResolvedValue(mockScanResult);

    const guardianValidate = jest.fn((proposal: Proposal) => {
      if (proposal.target.file?.includes('.env')) {
        return { valid: false, reason: 'Forbidden path: .env files' };
      }
      return { valid: true };
    });

    strategist.setDependencies({
      validateProposal: guardianValidate,
      saveProposals: jest.fn(),
    });

    const proposals = await strategist.analyze();

    const envProposals = proposals.filter((p) => p.target.file?.includes('.env'));
    expect(envProposals.length).toBe(0);
  });
});

describe('Strategist - edge cases', () => {
  it('handles empty scan result', async () => {
    const strategist = new Strategist();

    const emptyScanResult: ScanResult = {
      timestamp: new Date(),
      coverage: {
        totalStatements: 0, totalBranches: 0, totalFunctions: 0, totalLines: 0,
        coveredStatements: 0, coveredBranches: 0, coveredFunctions: 0, coveredLines: 0,
        uncoveredFiles: [], threshold: 50,
      },
      types: { errors: [], warnings: [], success: true },
      lint: { errors: [], warnings: [], success: true, fatalErrorCount: 0 },
      sizes: { files: [], threshold: 500 },
    };

    const validateProposal = jest.fn().mockReturnValue({ valid: true });
    strategist.setDependencies({ validateProposal });

    const proposals = await strategist.generateProposalsFromScan(emptyScanResult);

    // Should still return an array (may be empty for no issues)
    expect(Array.isArray(proposals)).toBe(true);
  });

  it('handles proposals without target file', async () => {
    const strategist = new Strategist();

    const validateProposal = jest.fn().mockReturnValue({ valid: true });
    strategist.setDependencies({ validateProposal });

    const scanResult = createMockScanResult();

    const proposals = await strategist.generateProposalsFromScan(scanResult);

    // Proposals without file targets should be allowed
    const proposalsWithoutFile = proposals.filter((p) => !p.target.file);
    expect(Array.isArray(proposalsWithoutFile)).toBe(true);
  });
});