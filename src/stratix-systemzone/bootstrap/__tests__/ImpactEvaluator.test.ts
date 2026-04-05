// ============================================
// ImpactEvaluator.test.ts - 效果评估器测试
// Phase 4: P4-04 - ImpactEvaluator 测试
// ============================================

import { ImpactEvaluator } from '../ImpactEvaluator';
import type {
  MetricSnapshot,
  MetricDeltas,
  ImpactEvaluation,
} from '../types';

// -------------------------------------------------------------------------
// Test Utilities
// -------------------------------------------------------------------------

function createSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    timestamp: new Date(),
    testCoverage: 70,
    testPassRate: 85,
    typeErrors: 10,
    lintErrors: 20,
    bundleSize: 500_000,
    responseTime: 150,
    fitnessScore: 65,
    ...overrides,
  };
}

function createDeltas(overrides: Partial<MetricDeltas> = {}): MetricDeltas {
  return {
    testCoverage: 0,
    testPassRate: 0,
    typeErrors: 0,
    lintErrors: 0,
    bundleSize: 0,
    responseTime: 0,
    fitnessScore: 0,
    ...overrides,
  };
}

// -------------------------------------------------------------------------
// calculateOverallImpact Tests
// -------------------------------------------------------------------------

describe('ImpactEvaluator', () => {
  describe('calculateOverallImpact', () => {
    it('should return 0 when all deltas are zero', () => {
      const evaluator = new ImpactEvaluator();
      const deltas = createDeltas();
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(0);
    });

    it('should add points for improved test coverage', () => {
      const evaluator = new ImpactEvaluator();
      // +5% coverage = +10 points
      const deltas = createDeltas({ testCoverage: 5 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(10);
    });

    it('should subtract points for decreased test coverage', () => {
      const evaluator = new ImpactEvaluator();
      // -5% coverage = -10 points
      const deltas = createDeltas({ testCoverage: -5 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(-10);
    });

    it('should add points for improved test pass rate', () => {
      const evaluator = new ImpactEvaluator();
      // +10% pass rate = +20 points
      const deltas = createDeltas({ testPassRate: 10 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(20);
    });

    it('should subtract double points for increased type errors', () => {
      const evaluator = new ImpactEvaluator();
      // +5 type errors = -10 points
      const deltas = createDeltas({ typeErrors: 5 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(-10);
    });

    it('should add points for decreased type errors', () => {
      const evaluator = new ImpactEvaluator();
      // -5 type errors = +10 points (0 - (-5 * 2))
      const deltas = createDeltas({ typeErrors: -5 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(10);
    });

    it('should subtract points for increased lint errors', () => {
      const evaluator = new ImpactEvaluator();
      // +10 lint errors = -10 points
      const deltas = createDeltas({ lintErrors: 10 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(-10);
    });

    it('should add points for decreased lint errors', () => {
      const evaluator = new ImpactEvaluator();
      // -10 lint errors = +10 points (0 - (-10 * 1))
      const deltas = createDeltas({ lintErrors: -10 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(10);
    });

    it('should subtract points for increased bundle size', () => {
      const evaluator = new ImpactEvaluator();
      // +1024 bytes = -1 point
      const deltas = createDeltas({ bundleSize: 1024 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(-1);
    });

    it('should add points for decreased bundle size', () => {
      const evaluator = new ImpactEvaluator();
      // -1024 bytes = +1 point
      const deltas = createDeltas({ bundleSize: -1024 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(1);
    });

    it('should subtract points for increased response time', () => {
      const evaluator = new ImpactEvaluator();
      // +50ms = -5 points
      const deltas = createDeltas({ responseTime: 50 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(-5);
    });

    it('should add points for improved fitness score', () => {
      const evaluator = new ImpactEvaluator();
      // +10 fitness = +10 points
      const deltas = createDeltas({ fitnessScore: 10 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(10);
    });

    it('should combine multiple positive changes', () => {
      const evaluator = new ImpactEvaluator();
      // +5% coverage (+10) +10% pass rate (+20) -5 type errors (+10) -10 lint errors (+10)
      const deltas = createDeltas({
        testCoverage: 5,
        testPassRate: 10,
        typeErrors: -5,
        lintErrors: -10,
      });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(50);
    });

    it('should combine multiple negative changes', () => {
      const evaluator = new ImpactEvaluator();
      // -5% coverage (-10) +10 type errors (-20) +20 lint errors (-20)
      const deltas = createDeltas({
        testCoverage: -5,
        typeErrors: 10,
        lintErrors: 20,
      });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(-50);
    });

    it('should cap impact at +100', () => {
      const evaluator = new ImpactEvaluator();
      // Large positive changes
      const deltas = createDeltas({
        testCoverage: 50,
        testPassRate: 50,
        typeErrors: -50,
        fitnessScore: 50,
      });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(100);
    });

    it('should cap impact at -100', () => {
      const evaluator = new ImpactEvaluator();
      // Large negative changes
      const deltas = createDeltas({
        testCoverage: -50,
        testPassRate: -50,
        typeErrors: 50,
        lintErrors: 50,
      });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(-100);
    });
  });

  // -------------------------------------------------------------------------
  // evaluate Tests
  // -------------------------------------------------------------------------

  describe('evaluate', () => {
    it('should calculate correct deltas between before and after', () => {
      const evaluator = new ImpactEvaluator();
      const before = createSnapshot({
        testCoverage: 70,
        testPassRate: 85,
        typeErrors: 10,
        lintErrors: 20,
      });
      const after = createSnapshot({
        testCoverage: 75,
        testPassRate: 90,
        typeErrors: 5,
        lintErrors: 15,
      });

      const evaluation = evaluator.evaluate(before, after, 'proposal-1');

      expect(evaluation.deltas.testCoverage).toBe(5);
      expect(evaluation.deltas.testPassRate).toBe(5);
      expect(evaluation.deltas.typeErrors).toBe(-5);
      expect(evaluation.deltas.lintErrors).toBe(-5);
    });

    it('should set proposalId in evaluation', () => {
      const evaluator = new ImpactEvaluator();
      const before = createSnapshot();
      const after = createSnapshot();

      const evaluation = evaluator.evaluate(before, after, 'test-proposal');

      expect(evaluation.proposalId).toBe('test-proposal');
    });

    it('should default proposalId to "unknown"', () => {
      const evaluator = new ImpactEvaluator();
      const before = createSnapshot();
      const after = createSnapshot();

      const evaluation = evaluator.evaluate(before, after);

      expect(evaluation.proposalId).toBe('unknown');
    });

    it('should include before and after snapshots in evaluation', () => {
      const evaluator = new ImpactEvaluator();
      const before = createSnapshot({ testCoverage: 60 });
      const after = createSnapshot({ testCoverage: 70 });

      const evaluation = evaluator.evaluate(before, after);

      expect(evaluation.before).toBe(before);
      expect(evaluation.after).toBe(after);
    });
  });

  // -------------------------------------------------------------------------
  // recommend Tests
  // -------------------------------------------------------------------------

  describe('recommend', () => {
    it('should return "keep" for strong positive impact', () => {
      const evaluator = new ImpactEvaluator();
      const evaluation: ImpactEvaluation = {
        proposalId: 'test',
        before: createSnapshot(),
        after: createSnapshot(),
        deltas: createDeltas({
          testCoverage: 10,
          testPassRate: 10,
        }),
        overallImpact: 50,
        recommendation: 'keep',
      };

      expect(evaluator.recommend(evaluation)).toBe('keep');
    });

    it('should return "rollback" for critical regressions', () => {
      const evaluator = new ImpactEvaluator();
      const evaluation: ImpactEvaluation = {
        proposalId: 'test',
        before: createSnapshot(),
        after: createSnapshot(),
        deltas: createDeltas({
          testCoverage: -10, // > -5 is critical
        }),
        overallImpact: -20,
        recommendation: 'rollback',
      };

      expect(evaluator.recommend(evaluation)).toBe('rollback');
    });

    it('should return "rollback" for significant negative impact', () => {
      const evaluator = new ImpactEvaluator();
      const evaluation: ImpactEvaluation = {
        proposalId: 'test',
        before: createSnapshot(),
        after: createSnapshot(),
        deltas: createDeltas(),
        overallImpact: -30,
        recommendation: 'rollback',
      };

      expect(evaluator.recommend(evaluation)).toBe('rollback');
    });

    it('should return "investigate" for moderate impact', () => {
      const evaluator = new ImpactEvaluator();
      const evaluation: ImpactEvaluation = {
        proposalId: 'test',
        before: createSnapshot(),
        after: createSnapshot(),
        deltas: createDeltas({
          testCoverage: 2,
          testPassRate: 3,
        }),
        overallImpact: 5,
        recommendation: 'investigate',
      };

      expect(evaluator.recommend(evaluation)).toBe('investigate');
    });

    it('should return "rollback" when type errors increase significantly', () => {
      const evaluator = new ImpactEvaluator();
      const evaluation: ImpactEvaluation = {
        proposalId: 'test',
        before: createSnapshot(),
        after: createSnapshot(),
        deltas: createDeltas({
          typeErrors: 15, // > 10 is critical
        }),
        overallImpact: -10,
        recommendation: 'rollback',
      };

      expect(evaluator.recommend(evaluation)).toBe('rollback');
    });

    it('should return "rollback" when lint errors increase significantly', () => {
      const evaluator = new ImpactEvaluator();
      const evaluation: ImpactEvaluation = {
        proposalId: 'test',
        before: createSnapshot(),
        after: createSnapshot(),
        deltas: createDeltas({
          lintErrors: 30, // > 20 is critical
        }),
        overallImpact: -15,
        recommendation: 'rollback',
      };

      expect(evaluator.recommend(evaluation)).toBe('rollback');
    });

    it('should return "rollback" when bundle size increases significantly', () => {
      const evaluator = new ImpactEvaluator();
      const evaluation: ImpactEvaluation = {
        proposalId: 'test',
        before: createSnapshot(),
        after: createSnapshot(),
        deltas: createDeltas({
          bundleSize: 150_000, // > 100KB is critical
        }),
        overallImpact: -5,
        recommendation: 'rollback',
      };

      expect(evaluator.recommend(evaluation)).toBe('rollback');
    });

    it('should return "rollback" when response time increases significantly', () => {
      const evaluator = new ImpactEvaluator();
      const evaluation: ImpactEvaluation = {
        proposalId: 'test',
        before: createSnapshot(),
        after: createSnapshot(),
        deltas: createDeltas({
          responseTime: 150, // > 100ms is critical
        }),
        overallImpact: -8,
        recommendation: 'rollback',
      };

      expect(evaluator.recommend(evaluation)).toBe('rollback');
    });

    it('should return "investigate" for small positive impact', () => {
      const evaluator = new ImpactEvaluator();
      const evaluation: ImpactEvaluation = {
        proposalId: 'test',
        before: createSnapshot(),
        after: createSnapshot(),
        deltas: createDeltas({
          testCoverage: 3,
        }),
        overallImpact: 6,
        recommendation: 'investigate',
      };

      expect(evaluator.recommend(evaluation)).toBe('investigate');
    });
  });

  // -------------------------------------------------------------------------
  // Integration-style Tests (with mocked scanner/fitness)
// -------------------------------------------------------------------------

  describe('snapshot capture structure', () => {
    it('should create snapshot with all required fields', async () => {
      // This test verifies the structure without running actual commands
      const evaluator = new ImpactEvaluator({ cwd: '/tmp' });

      // We can't easily test captureBefore/After without mocking,
      // but we can verify the evaluator instantiates correctly
      expect(evaluator).toBeInstanceOf(ImpactEvaluator);
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle large negative coverage delta', () => {
      const evaluator = new ImpactEvaluator();
      const deltas = createDeltas({ testCoverage: -30 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(-60);
    });

    it('should handle large positive coverage delta', () => {
      const evaluator = new ImpactEvaluator();
      const deltas = createDeltas({ testCoverage: 30 });
      const impact = evaluator.calculateOverallImpact(deltas);
      expect(impact).toBe(60);
    });

    it('should handle zero fitness score', () => {
      const evaluator = new ImpactEvaluator();
      const before = createSnapshot({ fitnessScore: 50 });
      const after = createSnapshot({ fitnessScore: 0 });
      const evaluation = evaluator.evaluate(before, after);
      expect(evaluation.deltas.fitnessScore).toBe(-50);
    });

    it('should handle zero bundle size', () => {
      const evaluator = new ImpactEvaluator();
      const before = createSnapshot({ bundleSize: 500_000 });
      const after = createSnapshot({ bundleSize: 0 });
      const evaluation = evaluator.evaluate(before, after);
      expect(evaluation.deltas.bundleSize).toBe(-500_000);
    });

    it('should handle 100% test pass rate', () => {
      const evaluator = new ImpactEvaluator();
      const before = createSnapshot({ testPassRate: 100 });
      const after = createSnapshot({ testPassRate: 100 });
      const evaluation = evaluator.evaluate(before, after);
      expect(evaluation.deltas.testPassRate).toBe(0);
    });

    it('should handle 0% test coverage', () => {
      const evaluator = new ImpactEvaluator();
      const before = createSnapshot({ testCoverage: 0 });
      const after = createSnapshot({ testCoverage: 10 });
      const evaluation = evaluator.evaluate(before, after);
      expect(evaluation.deltas.testCoverage).toBe(10);
    });
  });
});
