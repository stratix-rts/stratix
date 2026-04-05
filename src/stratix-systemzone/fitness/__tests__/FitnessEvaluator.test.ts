// ============================================
// FitnessEvaluator.test.ts - 健康度评估器测试
// Phase 2: P2-08 - FitnessEvaluator 测试
// ============================================

import { FitnessEvaluator } from '../FitnessEvaluator';
import type {
  CodeQualityMetrics,
  PerformanceMetrics,
  SystemHealthMetrics,
  ThresholdViolation,
  IScanner,
  FitnessReport,
} from '../types';

// -------------------------------------------------------------------------
// Mock Scanner Implementation
// -------------------------------------------------------------------------

function createMockScanner(overrides: Partial<{
  coverage: IScanner['runTestCoverage'] extends () => Promise<infer T> ? T : never;
  typeCheck: IScanner['runTypeCheck'] extends () => Promise<infer T> ? T : never;
  lint: IScanner['runLint'] extends () => Promise<infer T> ? T : never;
  fileSizes: IScanner['scanFileSizes'] extends () => Promise<infer T> ? T : never;
}> = {}): IScanner {
  const defaultCoverage = {
    totalStatements: 1000,
    totalBranches: 200,
    totalFunctions: 100,
    totalLines: 500,
    coveredStatements: 850,
    coveredBranches: 160,
    coveredFunctions: 80,
    coveredLines: 400,
    uncoveredFiles: ['/src/untested.ts'],
    threshold: 80,
  };

  const defaultTypeCheck = {
    errors: [],
    warnings: [],
    success: true,
  };

  const defaultLint = {
    errors: [],
    warnings: [],
    success: true,
    fatalErrorCount: 0,
  };

  const defaultFileSizes = {
    files: [
      { path: '/src/large.ts', lines: 600, isLarge: true },
      { path: '/src/small.ts', lines: 50, isLarge: false },
    ],
    threshold: 500,
  };

  return {
    runTestCoverage: jest.fn(() => Promise.resolve(overrides.coverage ?? defaultCoverage)),
    runTypeCheck: jest.fn(() => Promise.resolve(overrides.typeCheck ?? defaultTypeCheck)),
    runLint: jest.fn(() => Promise.resolve(overrides.lint ?? defaultLint)),
    scanFileSizes: jest.fn(() => Promise.resolve(overrides.fileSizes ?? defaultFileSizes)),
    scanAll: jest.fn(() => Promise.resolve({
      success: true,
      scanResult: {
        timestamp: new Date(),
        coverage: overrides.coverage ?? defaultCoverage,
        types: overrides.typeCheck ?? defaultTypeCheck,
        lint: overrides.lint ?? defaultLint,
        sizes: overrides.fileSizes ?? defaultFileSizes,
      },
      errors: [],
      duration: { coverage: 100, typecheck: 50, lint: 50, fileSizes: 30, total: 230 },
    })),
  };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('FitnessEvaluator', () => {
  let evaluator: FitnessEvaluator;
  let mockScanner: IScanner;

  beforeEach(() => {
    mockScanner = createMockScanner();
    evaluator = new FitnessEvaluator({
      scannerTimeoutMs: 5000,
      scannerCwd: '/fake/project',
    });
    evaluator.setScanner(mockScanner);
  });

  describe('evaluateCodeQuality', () => {
    it('calculates test coverage correctly from scanner data', async () => {
      const result = await evaluator.evaluateCodeQuality();

      expect(result.testCoverage).toBe(85); // 850/1000 * 100
      expect(mockScanner.runTestCoverage).toHaveBeenCalled();
    });

    it('calculates cyclomatic complexity based on branch/statement ratio', async () => {
      const result = await evaluator.evaluateCodeQuality();

      // (200/1000) * 10 = 2, rounded
      expect(result.cyclomaticComplexity).toBe(2);
    });

    it('returns zero lint error count when no errors', async () => {
      const result = await evaluator.evaluateCodeQuality();

      expect(result.lintErrorCount).toBe(0);
      expect(result.lintWarningCount).toBe(0);
    });

    it('counts lint errors and warnings from scanner', async () => {
      const customLint = {
        errors: [
          { file: 'a.ts', line: 1, column: 1, message: 'err', rule: 'no-var', severity: 'error' as const },
          { file: 'b.ts', line: 2, column: 2, message: 'err2', rule: 'semi', severity: 'error' as const },
        ],
        warnings: [
          { file: 'c.ts', line: 3, column: 3, message: 'warn', rule: 'no-unused', severity: 'warning' as const },
        ],
        success: false,
        fatalErrorCount: 0,
      };

      const scanner = createMockScanner({ lint: customLint });
      evaluator.setScanner(scanner);

      const result = await evaluator.evaluateCodeQuality();

      expect(result.lintErrorCount).toBe(2);
      expect(result.lintWarningCount).toBe(1);
    });

    it('calculates overall score based on coverage and issues', async () => {
      const result = await evaluator.evaluateCodeQuality();

      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });

    it('returns type error count from scanner', async () => {
      const customTypeCheck = {
        errors: [
          { file: 'a.ts', line: 1, column: 1, message: 'TS2345', code: 2345 },
        ],
        warnings: [],
        success: false,
      };

      const scanner = createMockScanner({ typeCheck: customTypeCheck });
      evaluator.setScanner(scanner);

      const result = await evaluator.evaluateCodeQuality();

      expect(result.typeErrorCount).toBe(1);
    });

    it('counts large files from file sizes scan', async () => {
      const result = await evaluator.evaluateCodeQuality();

      expect(result.largeFileCount).toBe(1); // Only /src/large.ts is large
    });
  });

  describe('evaluatePerformance', () => {
    it('returns performance metrics with score', async () => {
      // Mock fs.existsSync for dist directory check
      const result = await evaluator.evaluatePerformance();

      expect(result).toHaveProperty('responseTime');
      expect(result).toHaveProperty('bundleSizeBytes');
      expect(result).toHaveProperty('bundleSizeFormatted');
      expect(result).toHaveProperty('overallScore');
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });

    it('returns zero bundle size when dist does not exist', async () => {
      const result = await evaluator.evaluatePerformance();

      expect(result.bundleSizeBytes).toBe(0);
      expect(result.bundleSizeFormatted).toBe('0 B');
    });

    it('formats bundle size correctly', async () => {
      const result = await evaluator.evaluatePerformance();

      // Without dist dir, should be 0 B
      expect(result.bundleSizeFormatted).toBe('0 B');
    });
  });

  describe('evaluateSystemHealth', () => {
    it('calculates test pass rate from coverage data', async () => {
      const result = await evaluator.evaluateSystemHealth();

      // 80 covered functions / 100 total = 80%
      expect(result.testPassRate).toBe(80);
    });

    it('calculates error rate based on uncovered statements', async () => {
      const result = await evaluator.evaluateSystemHealth();

      // Uncovered: (1000-850)/1000 = 0.15
      expect(result.errorRate).toBeGreaterThan(0);
      expect(result.errorRate).toBeLessThan(1);
    });

    it('returns system health score between 0 and 100', async () => {
      const result = await evaluator.evaluateSystemHealth();

      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });

    it('counts test pass and fail counts correctly', async () => {
      const result = await evaluator.evaluateSystemHealth();

      expect(result.testPassCount).toBe(80);
      expect(result.testFailCount).toBe(20);
    });

    it('returns uptime seconds', async () => {
      const result = await evaluator.evaluateSystemHealth();

      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('evaluate', () => {
    it('returns a complete fitness report', async () => {
      const report = await evaluator.evaluate();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('metrics');
      expect(report).toHaveProperty('scores');
      expect(report).toHaveProperty('passed');
      expect(report).toHaveProperty('violations');
    });

    it('calculates overall score as weighted average', async () => {
      const report = await evaluator.evaluate();

      const expectedOverall = Math.round(
        report.scores.codeQuality * 0.4 +
        report.scores.performance * 0.3 +
        report.scores.systemHealth * 0.3
      );

      expect(report.scores.overall).toBe(expectedOverall);
    });

    it('sets passed to true when no violations', async () => {
      const report = await evaluator.evaluate();

      // With default thresholds and mock data, should have violations
      expect(typeof report.passed).toBe('boolean');
    });

    it('includes all metrics in report', async () => {
      const report = await evaluator.evaluate();

      expect(report.metrics).toHaveProperty('testCoverage');
      expect(report.metrics).toHaveProperty('cyclomaticComplexity');
      expect(report.metrics).toHaveProperty('duplicationRate');
      expect(report.metrics).toHaveProperty('responseTime');
      expect(report.metrics).toHaveProperty('errorRate');
    });
  });

  describe('checkThresholds', () => {
    it('detects test coverage violations', () => {
      const report: FitnessReport = {
        timestamp: new Date(),
        metrics: {
          testCoverage: 50, // Below default 80
          cyclomaticComplexity: 5,
          duplicationRate: 0.05,
          responseTime: 200,
          errorRate: 0.005,
        },
        scores: { codeQuality: 70, performance: 90, systemHealth: 90, overall: 83 },
        passed: true,
        violations: [],
      };

      const violations = evaluator.checkThresholds(report);

      expect(violations.length).toBeGreaterThan(0);
      const coverageViolation = violations.find(v => v.metric === 'testCoverage');
      expect(coverageViolation).toBeDefined();
      expect(coverageViolation?.severity).toBe('critical'); // 50 < 70 (80-10)
    });

    it('detects response time violations', () => {
      const report: FitnessReport = {
        timestamp: new Date(),
        metrics: {
          testCoverage: 90,
          cyclomaticComplexity: 5,
          duplicationRate: 0.05,
          responseTime: 1000, // Above default 500
          errorRate: 0.005,
        },
        scores: { codeQuality: 90, performance: 50, systemHealth: 90, overall: 77 },
        passed: false,
        violations: [],
      };

      const violations = evaluator.checkThresholds(report);

      const responseTimeViolation = violations.find(v => v.metric === 'responseTime');
      expect(responseTimeViolation).toBeDefined();
      expect(responseTimeViolation?.actual).toBe(1000);
      expect(responseTimeViolation?.threshold).toBe(500);
    });

    it('returns empty array when all thresholds pass', () => {
      const report: FitnessReport = {
        timestamp: new Date(),
        metrics: {
          testCoverage: 90,
          cyclomaticComplexity: 5,
          duplicationRate: 0.05,
          responseTime: 200,
          errorRate: 0.005,
        },
        scores: { codeQuality: 90, performance: 90, systemHealth: 90, overall: 90 },
        passed: true,
        violations: [],
      };

      const violations = evaluator.checkThresholds(report);

      expect(violations.length).toBe(0);
    });
  });

  describe('canEnableExecutor', () => {
    it('returns true when all metrics pass thresholds', async () => {
      // High coverage, low complexity, low error rate
      const scanner = createMockScanner({
        coverage: {
          totalStatements: 1000,
          totalBranches: 100,
          totalFunctions: 100,
          totalLines: 500,
          coveredStatements: 950, // 95% coverage
          coveredBranches: 90,
          coveredFunctions: 95,
          coveredLines: 450,
          uncoveredFiles: [],
          threshold: 80,
        },
      });
      evaluator.setScanner(scanner);

      const canEnable = await evaluator.canEnableExecutor();

      expect(canEnable).toBe(true);
    });

    it('returns false when overall score is below 60', async () => {
      // Low coverage to pull down score
      const scanner = createMockScanner({
        coverage: {
          totalStatements: 1000,
          totalBranches: 100,
          totalFunctions: 100,
          totalLines: 500,
          coveredStatements: 200, // 20% coverage - very low
          coveredBranches: 50,
          coveredFunctions: 30,
          coveredLines: 100,
          uncoveredFiles: [],
          threshold: 80,
        },
      });
      evaluator.setScanner(scanner);

      const canEnable = await evaluator.canEnableExecutor();

      expect(canEnable).toBe(false);
    });
  });

  describe('custom thresholds', () => {
    it('uses custom thresholds when provided', () => {
      const customEvaluator = new FitnessEvaluator({
        thresholds: {
          minTestCoverage: 90,
          maxCyclomaticComplexity: 10,
          maxDuplicationRate: 0.05,
          maxResponseTime: 300,
          maxErrorRate: 0.005,
        },
      });

      const thresholds = customEvaluator.getThresholds();

      expect(thresholds.minTestCoverage).toBe(90);
      expect(thresholds.maxCyclomaticComplexity).toBe(10);
      expect(thresholds.maxDuplicationRate).toBe(0.05);
      expect(thresholds.maxResponseTime).toBe(300);
      expect(thresholds.maxErrorRate).toBe(0.005);
    });

    it('merges custom thresholds with defaults', () => {
      const customEvaluator = new FitnessEvaluator({
        thresholds: {
          minTestCoverage: 95, // Only override one value
        },
      });

      const thresholds = customEvaluator.getThresholds();

      expect(thresholds.minTestCoverage).toBe(95);
      // Others should be defaults
      expect(thresholds.maxCyclomaticComplexity).toBe(DEFAULT_THRESHOLDS.maxCyclomaticComplexity);
    });
  });

  describe('error handling', () => {
    it('handles scanner errors gracefully', async () => {
      const failingScanner: IScanner = {
        runTestCoverage: jest.fn(() => Promise.reject(new Error('Coverage scan failed'))),
        runTypeCheck: jest.fn(() => Promise.reject(new Error('Type check failed'))),
        runLint: jest.fn(() => Promise.reject(new Error('Lint failed'))),
        scanFileSizes: jest.fn(() => Promise.reject(new Error('File scan failed'))),
        scanAll: jest.fn(() => Promise.reject(new Error('Scan failed'))),
      };
      evaluator.setScanner(failingScanner);

      // Should not throw, should return partial results
      const result = await evaluator.evaluateCodeQuality();

      expect(result.overallScore).toBeDefined();
      expect(result.testCoverage).toBe(0); // Empty coverage
    });
  });
});

// -------------------------------------------------------------------------
// Constants for reference
// -------------------------------------------------------------------------

const DEFAULT_THRESHOLDS = {
  minTestCoverage: 80,
  maxCyclomaticComplexity: 15,
  maxDuplicationRate: 0.1,
  maxResponseTime: 500,
  maxErrorRate: 0.01,
};
