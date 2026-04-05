// ============================================
// RegressionGuard 单元测试
// ============================================

import { RegressionGuard } from '../RegressionGuard';
import {
  DEFAULT_REGRESSION_GUARD_CONFIG,
  MetricSnapshot,
  Regression,
  RegressionCheck,
  RegressionSeverity,
} from '../types';

describe('RegressionGuard', () => {
  let guard: RegressionGuard;

  const createSnapshot = (overrides: Partial<MetricSnapshot> = {}): MetricSnapshot => ({
    timestamp: new Date(),
    testCoverage: 80,
    testPassRate: 95,
    typeErrors: 0,
    lintErrors: 5,
    bundleSize: 100_000,
    responseTime: 200,
    fitnessScore: 80,
    ...overrides,
  });

  beforeEach(() => {
    guard = new RegressionGuard(DEFAULT_REGRESSION_GUARD_CONFIG);
  });

  // ============================================
  // checkSingle tests
  // ============================================

  describe('checkSingle', () => {
    it('should detect regression when coverage drops beyond threshold', () => {
      const result = guard.checkSingle('testCoverage', 80, 77, 2, true);
      expect(result.isRegression).toBe(true);
      expect(result.delta).toBe(-3);
    });

    it('should NOT detect regression when coverage drops within threshold', () => {
      const result = guard.checkSingle('testCoverage', 80, 79, 2, true);
      expect(result.isRegression).toBe(false);
      expect(result.delta).toBe(-1);
    });

    it('should detect regression when pass rate drops beyond threshold', () => {
      const result = guard.checkSingle('testPassRate', 95, 93, 1, true);
      expect(result.isRegression).toBe(true);
      expect(result.delta).toBe(-2);
    });

    it('should NOT detect regression when pass rate improves', () => {
      const result = guard.checkSingle('testPassRate', 95, 97, 1, true);
      expect(result.isRegression).toBe(false);
      expect(result.delta).toBe(2);
    });

    it('should detect regression when type errors increase', () => {
      const result = guard.checkSingle('typeErrors', 0, 5, 0, false);
      expect(result.isRegression).toBe(true);
      expect(result.delta).toBe(5);
    });

    it('should NOT detect regression when type errors stay same', () => {
      const result = guard.checkSingle('typeErrors', 5, 5, 0, false);
      expect(result.isRegression).toBe(false);
    });

    it('should NOT detect regression when type errors decrease', () => {
      const result = guard.checkSingle('typeErrors', 5, 3, 0, false);
      expect(result.isRegression).toBe(false);
    });

    it('should detect regression when lint errors increase beyond threshold', () => {
      const result = guard.checkSingle('lintErrors', 5, 12, 5, false);
      expect(result.isRegression).toBe(true);
      expect(result.delta).toBe(7);
    });
  });

  // ============================================
  // checkPercentage tests
  // ============================================

  describe('checkPercentage', () => {
    it('should detect regression when bundle size increases beyond threshold', () => {
      // 100000 -> 110000 = 10% increase, threshold is 5%
      const result = guard.checkPercentage('bundleSize', 100_000, 110_000, 5);
      expect(result.isRegression).toBe(true);
    });

    it('should NOT detect regression when bundle size increases within threshold', () => {
      // 100000 -> 104000 = 4% increase, threshold is 5%
      const result = guard.checkPercentage('bundleSize', 100_000, 104_000, 5);
      expect(result.isRegression).toBe(false);
    });

    it('should NOT detect regression when bundle size decreases', () => {
      // 100000 -> 90000 = -10% change
      const result = guard.checkPercentage('bundleSize', 100_000, 90_000, 5);
      expect(result.isRegression).toBe(false);
    });

    it('should handle zero before value gracefully', () => {
      const result = guard.checkPercentage('bundleSize', 0, 1000, 5);
      expect(result.isRegression).toBe(true); // 0 -> 1000 is considered regression
      expect(result.delta).toBe(1000);
    });
  });

  // ============================================
  // getRegressions tests
  // ============================================

  describe('getRegressions', () => {
    it('should return only regression items', () => {
      const regressions: Regression[] = [
        { metric: 'testCoverage', beforeValue: 80, afterValue: 77, delta: -3, threshold: 2, isRegression: true },
        { metric: 'testPassRate', beforeValue: 95, afterValue: 94, delta: -1, threshold: 1, isRegression: false },
        { metric: 'typeErrors', beforeValue: 0, afterValue: 5, delta: 5, threshold: 0, isRegression: true },
      ];

      const check: RegressionCheck = {
        proposalId: 'test-1',
        regressions,
        severity: 'minor',
        canProceed: true,
      };

      const result = guard.getRegressions(check);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.metric)).toEqual(['testCoverage', 'typeErrors']);
    });

    it('should return empty array when no regressions', () => {
      const regressions: Regression[] = [
        { metric: 'testCoverage', beforeValue: 80, afterValue: 82, delta: 2, threshold: 2, isRegression: false },
      ];

      const check: RegressionCheck = {
        proposalId: 'test-1',
        regressions,
        severity: 'none',
        canProceed: true,
      };

      const result = guard.getRegressions(check);
      expect(result).toHaveLength(0);
    });
  });

  // ============================================
  // getSeverity tests
  // ============================================

  describe('getSeverity', () => {
    it('should return none when no regressions', () => {
      const regressions: Regression[] = [
        { metric: 'testCoverage', beforeValue: 80, afterValue: 82, delta: 2, threshold: 2, isRegression: false },
      ];
      expect(guard.getSeverity(regressions)).toBe('none');
    });

    it('should return minor for 1-2 small regressions', () => {
      const regressions: Regression[] = [
        { metric: 'testCoverage', beforeValue: 80, afterValue: 77, delta: -3, threshold: 2, isRegression: true },
        { metric: 'lintErrors', beforeValue: 5, afterValue: 12, delta: 7, threshold: 5, isRegression: true },
      ];
      expect(guard.getSeverity(regressions)).toBe('minor');
    });

    it('should return major for 3+ regressions', () => {
      const regressions: Regression[] = [
        { metric: 'testCoverage', beforeValue: 80, afterValue: 77, delta: -3, threshold: 2, isRegression: true },
        { metric: 'testPassRate', beforeValue: 95, afterValue: 93, delta: -2, threshold: 1, isRegression: true },
        { metric: 'lintErrors', beforeValue: 5, afterValue: 12, delta: 7, threshold: 5, isRegression: true },
      ];
      expect(guard.getSeverity(regressions)).toBe('major');
    });

    it('should return critical for core metric significant regression', () => {
      // testCoverage drops by 7 (> 5 threshold)
      const regressions: Regression[] = [
        { metric: 'testCoverage', beforeValue: 80, afterValue: 73, delta: -7, threshold: 2, isRegression: true },
      ];
      expect(guard.getSeverity(regressions)).toBe('critical');
    });

    it('should return critical for type errors increase > 10', () => {
      const regressions: Regression[] = [
        { metric: 'typeErrors', beforeValue: 0, afterValue: 15, delta: 15, threshold: 0, isRegression: true },
      ];
      expect(guard.getSeverity(regressions)).toBe('critical');
    });

    it('should return major for severe regression (delta > 2x threshold)', () => {
      const regressions: Regression[] = [
        { metric: 'lintErrors', beforeValue: 5, afterValue: 20, delta: 15, threshold: 5, isRegression: true },
      ];
      expect(guard.getSeverity(regressions)).toBe('major');
    });
  });

  // ============================================
  // canProceed tests
  // ============================================

  describe('canProceed', () => {
    it('should return true when no regressions', () => {
      const check: RegressionCheck = {
        proposalId: 'test-1',
        regressions: [],
        severity: 'none',
        canProceed: true,
      };
      expect(guard.canProceed(check)).toBe(true);
    });

    it('should return true for minor regressions', () => {
      const check: RegressionCheck = {
        proposalId: 'test-1',
        regressions: [
          { metric: 'testCoverage', beforeValue: 80, afterValue: 77, delta: -3, threshold: 2, isRegression: true },
        ],
        severity: 'minor',
        canProceed: true,
      };
      expect(guard.canProceed(check)).toBe(true);
    });

    it('should return false for major severity', () => {
      const check: RegressionCheck = {
        proposalId: 'test-1',
        regressions: [
          { metric: 'testCoverage', beforeValue: 80, afterValue: 77, delta: -3, threshold: 2, isRegression: true },
          { metric: 'testPassRate', beforeValue: 95, afterValue: 93, delta: -2, threshold: 1, isRegression: true },
          { metric: 'lintErrors', beforeValue: 5, afterValue: 12, delta: 7, threshold: 5, isRegression: true },
        ],
        severity: 'major',
        canProceed: false,
      };
      expect(guard.canProceed(check)).toBe(false);
    });

    it('should return false for critical severity with blockOnCriticalRegression=true', () => {
      const check: RegressionCheck = {
        proposalId: 'test-1',
        regressions: [
          { metric: 'testCoverage', beforeValue: 80, afterValue: 73, delta: -7, threshold: 2, isRegression: true },
        ],
        severity: 'critical',
        canProceed: false,
      };
      expect(guard.canProceed(check)).toBe(false);
    });

    it('should return true for critical severity when blockOnCriticalRegression=false', () => {
      const nonBlockingGuard = new RegressionGuard({
        ...DEFAULT_REGRESSION_GUARD_CONFIG,
        blockOnCriticalRegression: false,
      });
      const check: RegressionCheck = {
        proposalId: 'test-1',
        regressions: [
          { metric: 'testCoverage', beforeValue: 80, afterValue: 73, delta: -7, threshold: 2, isRegression: true },
        ],
        severity: 'critical',
        canProceed: true,
      };
      expect(nonBlockingGuard.canProceed(check)).toBe(true);
    });
  });

  // ============================================
  // check (integration) tests
  // ============================================

  describe('check', () => {
    it('should return none severity when all metrics improve', () => {
      const before = createSnapshot();
      const after = createSnapshot({
        testCoverage: 85,
        testPassRate: 98,
        typeErrors: 0,
        lintErrors: 3,
        bundleSize: 95_000,
        responseTime: 180,
      });

      const result = guard.check('proposal-1', before, after);
      expect(result.severity).toBe('none');
      expect(result.canProceed).toBe(true);
      expect(result.regressions.filter((r) => r.isRegression)).toHaveLength(0);
    });

    it('should detect minor regression for small coverage drop', () => {
      const before = createSnapshot();
      const after = createSnapshot({
        testCoverage: 77, // dropped from 80 to 77, delta = -3 > threshold of 2
      });

      const result = guard.check('proposal-1', before, after);
      expect(result.severity).toBe('minor');
      expect(result.canProceed).toBe(true);
    });

    it('should detect critical regression for large coverage drop', () => {
      const before = createSnapshot();
      const after = createSnapshot({
        testCoverage: 70, // dropped from 80 to 70, delta = -10 (> 5)
      });

      const result = guard.check('proposal-1', before, after);
      expect(result.severity).toBe('critical');
      expect(result.canProceed).toBe(false);
    });

    it('should detect bundle size regression', () => {
      const before = createSnapshot({ bundleSize: 100_000 });
      const after = createSnapshot({ bundleSize: 110_000 }); // 10% increase, threshold is 5%

      const result = guard.check('proposal-1', before, after);
      const bundleSizeReg = result.regressions.find((r) => r.metric === 'bundleSize');
      expect(bundleSizeReg?.isRegression).toBe(true);
    });

    it('should propagate proposalId', () => {
      const before = createSnapshot();
      const after = createSnapshot();

      const result = guard.check('my-proposal-id', before, after);
      expect(result.proposalId).toBe('my-proposal-id');
    });
  });
});
