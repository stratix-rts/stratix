/**
 * DiscoveryEngine.test.ts - 改进发现引擎测试
 * Phase 4: P4-02 - 改进发现引擎测试
 */

import { EventEmitter } from 'events';

// -------------------------------------------------------------------------
// Mock ProjectScanner
// -------------------------------------------------------------------------
interface MockScanResult {
  success: boolean;
  scanResult: {
    timestamp: Date;
    coverage: {
      totalStatements: number;
      totalBranches: number;
      totalFunctions: number;
      totalLines: number;
      coveredStatements: number;
      coveredBranches: number;
      coveredFunctions: number;
      coveredLines: number;
      uncoveredFiles: string[];
      threshold: number;
    };
    types: {
      errors: Array<{ file: string; line: number; column: number; message: string; code: number }>;
      warnings: Array<{ file: string; line: number; column: number; message: string; code: number }>;
      success: boolean;
    };
    lint: {
      errors: Array<{ file: string; line: number; column: number; message: string; rule: string; severity: 'error' | 'warning' }>;
      warnings: Array<{ file: string; line: number; column: number; message: string; rule: string; severity: 'error' | 'warning' }>;
      success: boolean;
      fatalErrorCount: number;
    };
    sizes: {
      files: Array<{ path: string; lines: number; isLarge: boolean }>;
      threshold: number;
    };
  };
  errors: Array<{ step: string; message: string }>;
  duration: {
    coverage: number;
    typecheck: number;
    lint: number;
    fileSizes: number;
    total: number;
  };
}

const createMockScanner = (overrides: Partial<MockScanResult> = {}): jest.Mocked<any> => ({
  scanAll: jest.fn().mockResolvedValue({
    success: true,
    scanResult: {
      timestamp: new Date(),
      coverage: {
        totalStatements: 100,
        totalBranches: 50,
        totalFunctions: 20,
        totalLines: 100,
        coveredStatements: 70,
        coveredBranches: 35,
        coveredFunctions: 14,
        coveredLines: 70,
        uncoveredFiles: [],
        threshold: 50,
      },
      types: {
        errors: [],
        warnings: [],
        success: true,
      },
      lint: {
        errors: [],
        warnings: [],
        success: true,
        fatalErrorCount: 0,
      },
      sizes: {
        files: [],
        threshold: 500,
      },
      ...overrides.scanResult,
    },
    errors: [],
    duration: {
      coverage: 1000,
      typecheck: 500,
      lint: 800,
      fileSizes: 200,
      total: 2500,
    },
    ...overrides,
  }),
});

// -------------------------------------------------------------------------
// Mock interfaces
// -------------------------------------------------------------------------
const mockLessonManager = {
  getRecentLessons: jest.fn().mockResolvedValue([]),
  getRepeatPatterns: jest.fn().mockResolvedValue([]),
};

const mockExternalSource = {
  fetch: jest.fn().mockResolvedValue([]),
};

const mockHistoryStore = {
  save: jest.fn().mockResolvedValue(undefined),
  getLast: jest.fn().mockResolvedValue([]),
};

// -------------------------------------------------------------------------
// Imports
// -------------------------------------------------------------------------
import { DiscoveryEngine } from '../DiscoveryEngine';
import type { DiscoveryConfig } from '../types';

describe('DiscoveryEngine', () => {
  let mockScanner: jest.Mocked<any>;
  let defaultConfig: DiscoveryConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    mockScanner = createMockScanner();
    defaultConfig = {
      scanInterval: 3600000,
      maxProposalsPerCycle: 5,
      minImprovementScore: 10,
      enabledCategories: ['test', 'code', 'architecture', 'performance'],
    };
  });

  describe('constructor', () => {
    it('initializes with config and scanner', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      expect(engine).toBeDefined();
      expect(engine.getConfig()).toEqual(defaultConfig);
    });

    it('accepts optional lesson manager', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner, {
        lessonManager: mockLessonManager as any,
      });
      expect(engine).toBeDefined();
    });

    it('accepts optional external sources', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner, {
        externalSources: [mockExternalSource as any],
      });
      expect(engine).toBeDefined();
    });

    it('accepts optional history store', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner, {
        historyStore: mockHistoryStore as any,
      });
      expect(engine).toBeDefined();
    });
  });

  describe('discover()', () => {
    it('returns discovery result with proposals and metrics', async () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const result = await engine.discover();

      expect(result).toHaveProperty('proposals');
      expect(result).toHaveProperty('scanMetrics');
      expect(result).toHaveProperty('timestamp');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('scanner is called during discovery', async () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      await engine.discover();

      expect(mockScanner.scanAll).toHaveBeenCalled();
    });

    it('respects maxProposalsPerCycle limit', async () => {
      // Setup scanner to return many proposals via uncovered files
      mockScanner.scanAll.mockResolvedValueOnce({
        success: true,
        scanResult: {
          timestamp: new Date(),
          coverage: {
            totalStatements: 1000,
            totalBranches: 500,
            totalFunctions: 200,
            totalLines: 1000,
            coveredStatements: 300,
            coveredBranches: 150,
            coveredFunctions: 60,
            coveredLines: 300,
            uncoveredFiles: ['src/f1.ts', 'src/f2.ts', 'src/f3.ts', 'src/f4.ts', 'src/f5.ts', 'src/f6.ts'],
            threshold: 50,
          },
          types: { errors: [], warnings: [], success: true },
          lint: { errors: [], warnings: [], success: true, fatalErrorCount: 0 },
          sizes: { files: [], threshold: 500 },
        },
        errors: [],
        duration: { coverage: 1000, typecheck: 500, lint: 800, fileSizes: 200, total: 2500 },
      });

      const limitedConfig = { ...defaultConfig, maxProposalsPerCycle: 3 };
      const engine = new DiscoveryEngine(limitedConfig, mockScanner);
      const result = await engine.discover();

      expect(result.proposals.length).toBeLessThanOrEqual(3);
    });

    it('handles scanner errors gracefully', async () => {
      mockScanner.scanAll.mockRejectedValueOnce(new Error('Scanner failed'));

      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const result = await engine.discover();

      // Should still return a valid result (with minimal metrics)
      expect(result).toHaveProperty('proposals');
      expect(result).toHaveProperty('scanMetrics');
    });
  });

  describe('scanProject()', () => {
    it('returns scan metrics from scanner', async () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const metrics = await engine.scanProject();

      expect(metrics).toHaveProperty('filesScanned');
      expect(metrics).toHaveProperty('issuesFound');
      expect(metrics).toHaveProperty('coverageGaps');
      expect(metrics).toHaveProperty('complexityHotspots');
      expect(metrics).toHaveProperty('scanDuration');
      expect(typeof metrics.scanDuration).toBe('number');
    });

    it('calculates coverage gaps when coverage is low', async () => {
      mockScanner.scanAll.mockResolvedValueOnce({
        success: true,
        scanResult: {
          timestamp: new Date(),
          coverage: {
            totalStatements: 100,
            totalBranches: 50,
            totalFunctions: 20,
            totalLines: 100,
            coveredStatements: 5, // Very low coverage
            coveredBranches: 2,
            coveredFunctions: 1,
            coveredLines: 5,
            uncoveredFiles: [],
            threshold: 50,
          },
          types: { errors: [], warnings: [], success: true },
          lint: { errors: [], warnings: [], success: true, fatalErrorCount: 0 },
          sizes: { files: [], threshold: 500 },
        },
        errors: [],
        duration: { coverage: 1000, typecheck: 500, lint: 800, fileSizes: 200, total: 2500 },
      });

      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const metrics = await engine.scanProject();

      expect(metrics.coverageGaps).toBe(1);
    });

    it('counts complexity hotspots from large files', async () => {
      mockScanner.scanAll.mockResolvedValueOnce({
        success: true,
        scanResult: {
          timestamp: new Date(),
          coverage: {
            totalStatements: 100,
            totalBranches: 50,
            totalFunctions: 20,
            totalLines: 100,
            coveredStatements: 100,
            coveredBranches: 50,
            coveredFunctions: 20,
            coveredLines: 100,
            uncoveredFiles: [],
            threshold: 50,
          },
          types: { errors: [], warnings: [], success: true },
          lint: { errors: [], warnings: [], success: true, fatalErrorCount: 0 },
          sizes: {
            files: [
              { path: 'src/big1.ts', lines: 800, isLarge: true },
              { path: 'src/big2.ts', lines: 700, isLarge: true },
              { path: 'src/small.ts', lines: 100, isLarge: false },
            ],
            threshold: 500,
          },
        },
        errors: [],
        duration: { coverage: 1000, typecheck: 500, lint: 800, fileSizes: 200, total: 2500 },
      });

      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const metrics = await engine.scanProject();

      expect(metrics.complexityHotspots).toBe(2);
    });
  });

  describe('analyzeGaps()', () => {
    it('generates proposal for coverage gaps', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const proposals = engine.analyzeGaps({
        filesScanned: 10,
        issuesFound: 0,
        coverageGaps: 1,
        complexityHotspots: 0,
        scanDuration: 1000,
      });

      expect(proposals.some((p) => p.category === 'test')).toBe(true);
    });

    it('generates proposal for complexity hotspots', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const proposals = engine.analyzeGaps({
        filesScanned: 10,
        issuesFound: 0,
        coverageGaps: 0,
        complexityHotspots: 3,
        scanDuration: 1000,
      });

      expect(proposals.some((p) => p.category === 'architecture')).toBe(true);
    });

    it('generates proposal for many issues', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const proposals = engine.analyzeGaps({
        filesScanned: 10,
        issuesFound: 15,
        coverageGaps: 0,
        complexityHotspots: 0,
        scanDuration: 1000,
      });

      expect(proposals.some((p) => p.category === 'code')).toBe(true);
    });

    it('returns empty array when no gaps', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const proposals = engine.analyzeGaps({
        filesScanned: 10,
        issuesFound: 5,
        coverageGaps: 0,
        complexityHotspots: 0,
        scanDuration: 1000,
      });

      expect(proposals).toHaveLength(0);
    });
  });

  describe('prioritize()', () => {
    it('sorts proposals by impact descending', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const proposals = engine.prioritize([
        {
          id: '1',
          category: 'test',
          target: 'a',
          description: 'Low impact',
          estimatedImpact: 20,
          estimatedRisk: 10,
          estimatedEffort: 'low',
          source: 'scanner',
          data: {},
        },
        {
          id: '2',
          category: 'test',
          target: 'b',
          description: 'High impact',
          estimatedImpact: 80,
          estimatedRisk: 20,
          estimatedEffort: 'high',
          source: 'scanner',
          data: {},
        },
        {
          id: '3',
          category: 'test',
          target: 'c',
          description: 'Medium impact',
          estimatedImpact: 50,
          estimatedRisk: 15,
          estimatedEffort: 'medium',
          source: 'scanner',
          data: {},
        },
      ]);

      expect(proposals[0].estimatedImpact).toBe(80);
      expect(proposals[1].estimatedImpact).toBe(50);
      expect(proposals[2].estimatedImpact).toBe(20);
    });

    it('sorts by risk when impact is equal', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const proposals = engine.prioritize([
        {
          id: '1',
          category: 'test',
          target: 'a',
          description: 'High risk',
          estimatedImpact: 50,
          estimatedRisk: 80,
          estimatedEffort: 'high',
          source: 'scanner',
          data: {},
        },
        {
          id: '2',
          category: 'test',
          target: 'b',
          description: 'Low risk',
          estimatedImpact: 50,
          estimatedRisk: 10,
          estimatedEffort: 'low',
          source: 'scanner',
          data: {},
        },
      ]);

      expect(proposals[0].estimatedRisk).toBe(10);
      expect(proposals[1].estimatedRisk).toBe(80);
    });

    it('does not mutate original array', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const original: Array<{
        id: string;
        category: string;
        target: string;
        description: string;
        estimatedImpact: number;
        estimatedRisk: number;
        estimatedEffort: 'low' | 'medium' | 'high';
        source: 'scanner';
        data: Record<string, unknown>;
      }> = [
        {
          id: '1',
          category: 'test',
          target: 'a',
          description: 'Test',
          estimatedImpact: 20,
          estimatedRisk: 10,
          estimatedEffort: 'low',
          source: 'scanner',
          data: {},
        },
        {
          id: '2',
          category: 'test',
          target: 'b',
          description: 'Test',
          estimatedImpact: 80,
          estimatedRisk: 20,
          estimatedEffort: 'high',
          source: 'scanner',
          data: {},
        },
      ];

      engine.prioritize(original);
      expect(original[0].estimatedImpact).toBe(20);
      expect(original[1].estimatedImpact).toBe(80);
    });
  });

  describe('filterByCategory()', () => {
    it('filters proposals by single category', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const proposals = [
        {
          id: '1',
          category: 'test',
          target: 'a',
          description: 'Test',
          estimatedImpact: 50,
          estimatedRisk: 10,
          estimatedEffort: 'low',
          source: 'scanner' as const,
          data: {},
        },
        {
          id: '2',
          category: 'code',
          target: 'b',
          description: 'Code',
          estimatedImpact: 50,
          estimatedRisk: 10,
          estimatedEffort: 'low',
          source: 'scanner' as const,
          data: {},
        },
        {
          id: '3',
          category: 'architecture',
          target: 'c',
          description: 'Arch',
          estimatedImpact: 50,
          estimatedRisk: 10,
          estimatedEffort: 'low',
          source: 'scanner' as const,
          data: {},
        },
      ];

      const filtered = engine.filterByCategory(proposals, ['test']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].category).toBe('test');
    });

    it('filters proposals by multiple categories', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const proposals = [
        { id: '1', category: 'test', target: 'a', description: 'Test', estimatedImpact: 50, estimatedRisk: 10, estimatedEffort: 'low', source: 'scanner' as const, data: {} },
        { id: '2', category: 'code', target: 'b', description: 'Code', estimatedImpact: 50, estimatedRisk: 10, estimatedEffort: 'low', source: 'scanner' as const, data: {} },
        { id: '3', category: 'architecture', target: 'c', description: 'Arch', estimatedImpact: 50, estimatedRisk: 10, estimatedEffort: 'low', source: 'scanner' as const, data: {} },
        { id: '4', category: 'performance', target: 'd', description: 'Perf', estimatedImpact: 50, estimatedRisk: 10, estimatedEffort: 'low', source: 'scanner' as const, data: {} },
      ];

      const filtered = engine.filterByCategory(proposals, ['test', 'code']);
      expect(filtered).toHaveLength(2);
      expect(filtered.every((p) => p.category === 'test' || p.category === 'code')).toBe(true);
    });

    it('returns all proposals when categories is empty', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const proposals = [
        { id: '1', category: 'test', target: 'a', description: 'Test', estimatedImpact: 50, estimatedRisk: 10, estimatedEffort: 'low', source: 'scanner' as const, data: {} },
        { id: '2', category: 'code', target: 'b', description: 'Code', estimatedImpact: 50, estimatedRisk: 10, estimatedEffort: 'low', source: 'scanner' as const, data: {} },
      ];

      const filtered = engine.filterByCategory(proposals, []);
      expect(filtered).toHaveLength(2);
    });

    it('returns empty array when no matches', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const proposals = [
        { id: '1', category: 'test', target: 'a', description: 'Test', estimatedImpact: 50, estimatedRisk: 10, estimatedEffort: 'low', source: 'scanner' as const, data: {} },
      ];

      const filtered = engine.filterByCategory(proposals, ['nonexistent']);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('discoverFromLessons()', () => {
    it('uses lesson manager to get repeat patterns', async () => {
      const repeatPatterns = [
        {
          lessonId: 'l1',
          pattern: 'unused_import',
          occurrenceCount: 5,
          lastOccurredAt: new Date(),
          suggestedFix: 'Remove unused imports',
        },
      ];

      const lessonMgr = {
        getRecentLessons: jest.fn().mockResolvedValue([]),
        getRepeatPatterns: jest.fn().mockResolvedValue(repeatPatterns),
      };

      const engine = new DiscoveryEngine(defaultConfig, mockScanner, {
        lessonManager: lessonMgr as any,
      });

      const result = await engine.discover();
      expect(lessonMgr.getRepeatPatterns).toHaveBeenCalled();
      expect(result.proposals.some((p) => p.source === 'lesson')).toBe(true);
    });
  });

  describe('discoverFromExternal()', () => {
    it('fetches from external sources', async () => {
      const suggestions = [
        {
          id: 'ext1',
          source: 'api',
          category: 'performance',
          target: 'bundle',
          description: 'Enable tree shaking',
          impact: 60,
          data: {},
        },
      ];

      const externalSrc = {
        fetch: jest.fn().mockResolvedValue(suggestions),
      };

      const engine = new DiscoveryEngine(defaultConfig, mockScanner, {
        externalSources: [externalSrc as any],
      });

      const result = await engine.discover();
      expect(externalSrc.fetch).toHaveBeenCalled();
      expect(result.proposals.some((p) => p.source === 'external')).toBe(true);
    });
  });

  describe('discoverFromFitness()', () => {
    it('detects fitness regression from history', async () => {
      const historyStore = {
        save: jest.fn().mockResolvedValue(undefined),
        getLast: jest.fn().mockResolvedValue([
          {
            timestamp: new Date(Date.now() - 3600000),
            fitnessReport: {
              timestamp: new Date(Date.now() - 3600000),
              metrics: { testCoverage: 70, cyclomaticComplexity: 5, duplicationRate: 0.05, responseTime: 100, errorRate: 0.01 },
              scores: { codeQuality: 75, performance: 80, systemHealth: 85, overall: 80 },
              passed: true,
              violations: [],
            },
            scanMetrics: { filesScanned: 10, issuesFound: 5, coverageGaps: 0, complexityHotspots: 0, scanDuration: 1000 },
          },
          {
            timestamp: new Date(),
            fitnessReport: {
              timestamp: new Date(),
              metrics: { testCoverage: 65, cyclomaticComplexity: 5, duplicationRate: 0.05, responseTime: 100, errorRate: 0.01 },
              scores: { codeQuality: 70, performance: 80, systemHealth: 85, overall: 70 },
              passed: true,
              violations: [],
            },
            scanMetrics: { filesScanned: 10, issuesFound: 5, coverageGaps: 0, complexityHotspots: 0, scanDuration: 1000 },
          },
        ]),
      };

      const engine = new DiscoveryEngine(defaultConfig, mockScanner, {
        historyStore: historyStore as any,
      });

      const result = await engine.discover();
      expect(result.proposals.some((p) => p.source === 'fitness')).toBe(true);
    });
  });

  describe('setLessonManager()', () => {
    it('allows setting lesson manager after construction', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      expect(() => engine.setLessonManager(mockLessonManager as any)).not.toThrow();
    });
  });

  describe('addExternalSource()', () => {
    it('allows adding external source after construction', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      expect(() => engine.addExternalSource(mockExternalSource as any)).not.toThrow();
    });
  });

  describe('setHistoryStore()', () => {
    it('allows setting history store after construction', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      expect(() => engine.setHistoryStore(mockHistoryStore as any)).not.toThrow();
    });
  });

  describe('getLastScanMetrics()', () => {
    it('returns null before any scan', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      expect(engine.getLastScanMetrics()).toBeNull();
    });

    it('returns metrics after scan', async () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      await engine.scanProject();
      expect(engine.getLastScanMetrics()).not.toBeNull();
    });
  });

  describe('getConfig()', () => {
    it('returns current config', () => {
      const engine = new DiscoveryEngine(defaultConfig, mockScanner);
      const config = engine.getConfig();
      expect(config).toEqual(defaultConfig);
      expect(config).not.toBe(defaultConfig); // Should be a copy
    });
  });
});
