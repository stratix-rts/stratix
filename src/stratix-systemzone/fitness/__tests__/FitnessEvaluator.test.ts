// ============================================
// FitnessEvaluator.test.ts - 健康度评估器测试
// Phase 2: P2-08 - FitnessEvaluator 测试
// ============================================

import { FitnessEvaluator } from '../FitnessEvaluator';
import type { IScanner, FitnessReport } from '../types';

// -------------------------------------------------------------------------
// Mock Scanner
// -------------------------------------------------------------------------

function createMockScanner(overrides: Partial<{
  coverage: Awaited<ReturnType<IScanner['runTestCoverage']>>;
  typeCheck: Awaited<ReturnType<IScanner['runTypeCheck']>>;
  lint: Awaited<ReturnType<IScanner['runLint']>>;
  fileSizes: Awaited<ReturnType<IScanner['scanFileSizes']>>;
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
    errors: [] as Array<{ file: string; line: number; column: number; message: string; rule: string; severity: 'error' | 'warning' }>,
    warnings: [] as Array<{ file: string; line: number; column: number; message: string; rule: string; severity: 'error' | 'warning' }>,
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

  describe('constructor', () => {
    it('creates instance with default config', () => {
      const e = new FitnessEvaluator();
      expect(e).toBeInstanceOf(FitnessEvaluator);
    });

    it('applies custom config overrides', () => {
      const e = new FitnessEvaluator({
        scannerTimeoutMs: 3000,
        scannerCwd: '/custom/path',
        bundleSizeThreshold: 100000,
        responseTimeThreshold: 200,
      });
      const thresholds = e.getThresholds();
      expect(thresholds).toBeDefined();
    });

    it('merges custom thresholds with defaults', () => {
      const e = new FitnessEvaluator({
        thresholds: {
          minTestCoverage: 90,
        },
      });
      const thresholds = e.getThresholds();
      expect(thresholds.minTestCoverage).toBe(90);
      expect(thresholds.maxCyclomaticComplexity).toBe(15); // default
      expect(thresholds.maxDuplicationRate).toBe(0.1); // default
    });
  });

  describe('setScanner()', () => {
    it('allows setting a custom scanner', () => {
      const customScanner = createMockScanner({
        coverage: {
          totalStatements: 500,
          totalBranches: 100,
          totalFunctions: 50,
          totalLines: 250,
          coveredStatements: 500,
          coveredBranches: 100,
          coveredFunctions: 50,
          coveredLines: 250,
          uncoveredFiles: [],
          threshold: 80,
        },
      });
      evaluator.setScanner(customScanner);

      expect(customScanner.runTestCoverage).not.toHaveBeenCalled();
    });
  });

  describe('getThresholds()', () => {
    it('returns current thresholds copy', () => {
      const thresholds = evaluator.getThresholds();

      expect(thresholds.minTestCoverage).toBe(80);
      expect(thresholds.maxCyclomaticComplexity).toBe(15);
      expect(thresholds.maxDuplicationRate).toBe(0.1);
      expect(thresholds.maxResponseTime).toBe(500);
      expect(thresholds.maxErrorRate).toBe(0.01);
    });

    it('returns a copy (not the original)', () => {
      const thresholds = evaluator.getThresholds();
      thresholds.minTestCoverage = 99;

      const again = evaluator.getThresholds();
      expect(again.minTestCoverage).toBe(80);
    });
  });

  describe('evaluateCodeQuality()', () => {
    it('calculates test coverage percentage from scanner data', async () => {
      const result = await evaluator.evaluateCodeQuality();

      // (850/1000) * 100 = 85
      expect(result.testCoverage).toBe(85);
      expect(mockScanner.runTestCoverage).toHaveBeenCalled();
    });

    it('calculates cyclomatic complexity from branch/statement ratio', async () => {
      const result = await evaluator.evaluateCodeQuality();

      // (200/1000) * 10 = 2, rounded
      expect(result.cyclomaticComplexity).toBe(2);
    });

    it('returns lint counts from scanner', async () => {
      const result = await evaluator.evaluateCodeQuality();

      expect(result.lintErrorCount).toBe(0);
      expect(result.lintWarningCount).toBe(0);
    });

    it('counts lint errors and warnings correctly', async () => {
      const scanner = createMockScanner({
        lint: {
          errors: [
            { file: 'a.ts', line: 1, column: 1, message: 'err', rule: 'no-var', severity: 'error' as const },
            { file: 'b.ts', line: 2, column: 2, message: 'err2', rule: 'semi', severity: 'error' as const },
          ],
          warnings: [
            { file: 'c.ts', line: 3, column: 3, message: 'warn', rule: 'no-unused', severity: 'warning' as const },
          ],
          success: false,
          fatalErrorCount: 0,
        },
      });
      evaluator.setScanner(scanner);

      const result = await evaluator.evaluateCodeQuality();

      expect(result.lintErrorCount).toBe(2);
      expect(result.lintWarningCount).toBe(1);
    });

    it('returns type error count from scanner', async () => {
      const scanner = createMockScanner({
        typeCheck: {
          errors: [
            { file: 'a.ts', line: 1, column: 1, message: 'TS2345', code: 2345 },
          ],
          warnings: [],
          success: false,
        },
      });
      evaluator.setScanner(scanner);

      const result = await evaluator.evaluateCodeQuality();

      expect(result.typeErrorCount).toBe(1);
    });

    it('counts large files from file sizes scan', async () => {
      const result = await evaluator.evaluateCodeQuality();

      expect(result.largeFileCount).toBe(1); // only /src/large.ts
    });

    it('returns overallScore between 0 and 100', async () => {
      const result = await evaluator.evaluateCodeQuality();

      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });

    it('returns all required fields in result', async () => {
      const result = await evaluator.evaluateCodeQuality();

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('testCoverage');
      expect(result).toHaveProperty('cyclomaticComplexity');
      expect(result).toHaveProperty('duplicationRate');
      expect(result).toHaveProperty('lintErrorCount');
      expect(result).toHaveProperty('lintWarningCount');
      expect(result).toHaveProperty('typeErrorCount');
      expect(result).toHaveProperty('largeFileCount');
      expect(result).toHaveProperty('overallScore');
    });
  });

  describe('evaluatePerformance()', () => {
    it('returns performance metrics with score', async () => {
      const result = await evaluator.evaluatePerformance();

      expect(result).toHaveProperty('responseTime');
      expect(result).toHaveProperty('bundleSizeBytes');
      expect(result).toHaveProperty('bundleSizeFormatted');
      expect(result).toHaveProperty('largeBundleFiles');
      expect(result).toHaveProperty('buildDuration');
      expect(result).toHaveProperty('overallScore');
    });

    it('returns zero bundle size when dist does not exist', async () => {
      const result = await evaluator.evaluatePerformance();

      expect(result.bundleSizeBytes).toBe(0);
      expect(result.bundleSizeFormatted).toBe('0 B');
      expect(result.largeBundleFiles).toEqual([]);
    });

    it('returns overallScore between 0 and 100', async () => {
      const result = await evaluator.evaluatePerformance();

      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });
  });

  describe('evaluateSystemHealth()', () => {
    it('calculates test pass rate from coverage data', async () => {
      const result = await evaluator.evaluateSystemHealth();

      // 80 covered functions / 100 total = 80%
      expect(result.testPassRate).toBe(80);
    });

    it('calculates test pass/fail counts correctly', async () => {
      const result = await evaluator.evaluateSystemHealth();

      expect(result.testPassCount).toBe(80);
      expect(result.testFailCount).toBe(20);
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

    it('returns uptime seconds', async () => {
      const result = await evaluator.evaluateSystemHealth();

      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('returns all required fields in result', async () => {
      const result = await evaluator.evaluateSystemHealth();

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('errorRate');
      expect(result).toHaveProperty('testPassRate');
      expect(result).toHaveProperty('testPassCount');
      expect(result).toHaveProperty('testFailCount');
      expect(result).toHaveProperty('testSkipCount');
      expect(result).toHaveProperty('uptimeSeconds');
      expect(result).toHaveProperty('crashCount');
      expect(result).toHaveProperty('overallScore');
    });
  });

  describe('evaluate()', () => {
    it('returns a complete fitness report', async () => {
      const report = await evaluator.evaluate();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('metrics');
      expect(report).toHaveProperty('scores');
      expect(report).toHaveProperty('passed');
      expect(report).toHaveProperty('violations');
    });

    it('includes all metric fields', async () => {
      const report = await evaluator.evaluate();

      expect(report.metrics).toHaveProperty('testCoverage');
      expect(report.metrics).toHaveProperty('cyclomaticComplexity');
      expect(report.metrics).toHaveProperty('duplicationRate');
      expect(report.metrics).toHaveProperty('responseTime');
      expect(report.metrics).toHaveProperty('errorRate');
    });

    it('includes all score fields', async () => {
      const report = await evaluator.evaluate();

      expect(report.scores).toHaveProperty('codeQuality');
      expect(report.scores).toHaveProperty('performance');
      expect(report.scores).toHaveProperty('systemHealth');
      expect(report.scores).toHaveProperty('overall');
    });

    it('calculates overall score as weighted average of category scores', async () => {
      const report = await evaluator.evaluate();

      const expectedOverall = Math.round(
        report.scores.codeQuality * 0.4 +
        report.scores.performance * 0.3 +
        report.scores.systemHealth * 0.3
      );

      expect(report.scores.overall).toBe(expectedOverall);
    });

    it('violations is an array of strings', async () => {
      const report = await evaluator.evaluate();

      expect(Array.isArray(report.violations)).toBe(true);
      report.violations.forEach(v => expect(typeof v).toBe('string'));
    });
  });

  describe('checkThresholds()', () => {
    it('detects test coverage violation below threshold', () => {
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

      const coverageViolation = violations.find(v => v.metric === 'testCoverage');
      expect(coverageViolation).toBeDefined();
      expect(coverageViolation?.actual).toBe(50);
      expect(coverageViolation?.threshold).toBe(80);
    });

    it('marks coverage violation as critical when gap > 10', () => {
      const report: FitnessReport = {
        timestamp: new Date(),
        metrics: {
          testCoverage: 60, // 20 below threshold (80 - 10 = 70 critical line)
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

      const coverageViolation = violations.find(v => v.metric === 'testCoverage');
      expect(coverageViolation?.severity).toBe('warning'); // 60 is above 70 critical line
    });

    it('detects cyclomatic complexity violation', () => {
      const report: FitnessReport = {
        timestamp: new Date(),
        metrics: {
          testCoverage: 90,
          cyclomaticComplexity: 20, // Above default 15
          duplicationRate: 0.05,
          responseTime: 200,
          errorRate: 0.005,
        },
        scores: { codeQuality: 80, performance: 90, systemHealth: 90, overall: 86 },
        passed: true,
        violations: [],
      };

      const violations = evaluator.checkThresholds(report);

      const ccViolation = violations.find(v => v.metric === 'cyclomaticComplexity');
      expect(ccViolation).toBeDefined();
      expect(ccViolation?.actual).toBe(20);
      expect(ccViolation?.threshold).toBe(15);
    });

    it('detects duplication rate violation', () => {
      const report: FitnessReport = {
        timestamp: new Date(),
        metrics: {
          testCoverage: 90,
          cyclomaticComplexity: 5,
          duplicationRate: 0.2, // Above default 0.1
          responseTime: 200,
          errorRate: 0.005,
        },
        scores: { codeQuality: 80, performance: 90, systemHealth: 90, overall: 86 },
        passed: true,
        violations: [],
      };

      const violations = evaluator.checkThresholds(report);

      const dupViolation = violations.find(v => v.metric === 'duplicationRate');
      expect(dupViolation).toBeDefined();
      expect(dupViolation?.actual).toBe(0.2);
      expect(dupViolation?.threshold).toBe(0.1);
    });

    it('detects response time violation', () => {
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

      const rtViolation = violations.find(v => v.metric === 'responseTime');
      expect(rtViolation).toBeDefined();
      expect(rtViolation?.actual).toBe(1000);
      expect(rtViolation?.threshold).toBe(500);
    });

    it('marks response time violation as critical when doubled', () => {
      const report: FitnessReport = {
        timestamp: new Date(),
        metrics: {
          testCoverage: 90,
          cyclomaticComplexity: 5,
          duplicationRate: 0.05,
          responseTime: 1200, // > 500 * 2
          errorRate: 0.005,
        },
        scores: { codeQuality: 90, performance: 50, systemHealth: 90, overall: 77 },
        passed: false,
        violations: [],
      };

      const violations = evaluator.checkThresholds(report);

      const rtViolation = violations.find(v => v.metric === 'responseTime');
      expect(rtViolation?.severity).toBe('critical');
    });

    it('detects error rate violation', () => {
      const report: FitnessReport = {
        timestamp: new Date(),
        metrics: {
          testCoverage: 90,
          cyclomaticComplexity: 5,
          duplicationRate: 0.05,
          responseTime: 200,
          errorRate: 0.05, // Above default 0.01
        },
        scores: { codeQuality: 90, performance: 90, systemHealth: 70, overall: 84 },
        passed: true,
        violations: [],
      };

      const violations = evaluator.checkThresholds(report);

      const erViolation = violations.find(v => v.metric === 'errorRate');
      expect(erViolation).toBeDefined();
      expect(erViolation?.actual).toBe(0.05);
      expect(erViolation?.threshold).toBe(0.01);
    });

    it('marks error rate violation as critical when 5x threshold', () => {
      const report: FitnessReport = {
        timestamp: new Date(),
        metrics: {
          testCoverage: 90,
          cyclomaticComplexity: 5,
          duplicationRate: 0.05,
          responseTime: 200,
          errorRate: 0.1, // > 0.01 * 5
        },
        scores: { codeQuality: 90, performance: 90, systemHealth: 70, overall: 84 },
        passed: false,
        violations: [],
      };

      const violations = evaluator.checkThresholds(report);

      const erViolation = violations.find(v => v.metric === 'errorRate');
      expect(erViolation?.severity).toBe('critical');
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

      expect(violations).toEqual([]);
    });
  });

  describe('canEnableExecutor()', () => {
    it('returns true when all metrics pass thresholds with high scores', async () => {
      const scanner = createMockScanner({
        coverage: {
          totalStatements: 1000,
          totalBranches: 100,
          totalFunctions: 100,
          totalLines: 500,
          coveredStatements: 950, // 95% coverage
          coveredBranches: 95,
          coveredFunctions: 100, // All covered = 0 failed
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
      const scanner = createMockScanner({
        coverage: {
          totalStatements: 1000,
          totalBranches: 100,
          totalFunctions: 100,
          totalLines: 500,
          coveredStatements: 200, // 20% coverage
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

  describe('error handling', () => {
    it('handles scanner runTestCoverage rejection gracefully', async () => {
      const failingScanner: IScanner = {
        runTestCoverage: jest.fn(() => Promise.reject(new Error('Coverage scan failed'))),
        runTypeCheck: jest.fn(() => Promise.resolve({ errors: [], warnings: [], success: true })),
        runLint: jest.fn(() => Promise.resolve({ errors: [], warnings: [], success: true, fatalErrorCount: 0 })),
        scanFileSizes: jest.fn(() => Promise.resolve({ files: [], threshold: 500 })),
        scanAll: jest.fn(() => Promise.reject(new Error('Scan failed'))),
      };
      evaluator.setScanner(failingScanner);

      const result = await evaluator.evaluateCodeQuality();

      expect(result.overallScore).toBeDefined();
      expect(result.testCoverage).toBe(0); // Empty coverage fallback
    });

    it('handles scanner runTypeCheck rejection gracefully', async () => {
      const failingScanner: IScanner = {
        runTestCoverage: jest.fn(() => Promise.resolve({
          totalStatements: 0, totalBranches: 0, totalFunctions: 0, totalLines: 0,
          coveredStatements: 0, coveredBranches: 0, coveredFunctions: 0, coveredLines: 0,
          uncoveredFiles: [], threshold: 80,
        })),
        runTypeCheck: jest.fn(() => Promise.reject(new Error('Type check failed'))),
        runLint: jest.fn(() => Promise.resolve({ errors: [], warnings: [], success: true, fatalErrorCount: 0 })),
        scanFileSizes: jest.fn(() => Promise.resolve({ files: [], threshold: 500 })),
        scanAll: jest.fn(),
      };
      evaluator.setScanner(failingScanner);

      const result = await evaluator.evaluateCodeQuality();

      expect(result.typeErrorCount).toBe(0);
    });

    it('handles scanner runLint rejection gracefully', async () => {
      const failingScanner: IScanner = {
        runTestCoverage: jest.fn(() => Promise.resolve({
          totalStatements: 0, totalBranches: 0, totalFunctions: 0, totalLines: 0,
          coveredStatements: 0, coveredBranches: 0, coveredFunctions: 0, coveredLines: 0,
          uncoveredFiles: [], threshold: 80,
        })),
        runTypeCheck: jest.fn(() => Promise.resolve({ errors: [], warnings: [], success: true })),
        runLint: jest.fn(() => Promise.reject(new Error('Lint failed'))),
        scanFileSizes: jest.fn(() => Promise.resolve({ files: [], threshold: 500 })),
        scanAll: jest.fn(),
      };
      evaluator.setScanner(failingScanner);

      const result = await evaluator.evaluateCodeQuality();

      expect(result.lintErrorCount).toBe(0);
      expect(result.lintWarningCount).toBe(0);
    });
  });
});
