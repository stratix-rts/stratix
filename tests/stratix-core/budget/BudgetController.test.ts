import BudgetController from '../../../src/stratix-core/budget/BudgetController';
import { budgetController } from '../../../src/stratix-core/budget';
import type { BudgetConfig } from '../../../src/stratix-core/budget/types';

const DEFAULT_CONFIG: BudgetConfig = {
  maxTokens: 100000,
  completionThreshold: 0.9,
  diminishingThreshold: 500,
  maxContinuations: 10,
};

describe('BudgetController', () => {
  describe('evaluate', () => {
    it('should continue when under threshold', () => {
      const usage = { totalTokens: 50000, promptTokens: 30000, completionTokens: 20000 };
      const decision = budgetController.evaluate(usage, 0);
      expect(decision.action).toBe('continue');
      expect(decision.reason).toBe('within_budget');
      expect(decision.pctUsed).toBe(0.5);
      expect(decision.remainingBudget).toBe(50000);
    });

    it('should stop when over completion threshold', () => {
      const usage = { totalTokens: 95000, promptTokens: 40000, completionTokens: 55000 };
      const decision = budgetController.evaluate(usage, 0);
      expect(decision.action).toBe('stop');
      expect(decision.reason).toBe('threshold_reached');
      expect(decision.pctUsed).toBe(0.95);
      expect(decision.nudgeMessage).toContain('threshold reached');
    });

    it('should stop when budget exhausted', () => {
      const usage = { totalTokens: 100000, promptTokens: 40000, completionTokens: 60000 };
      const decision = budgetController.evaluate(usage, 0);
      expect(decision.action).toBe('stop');
      expect(decision.reason).toBe('budget_exhausted');
      expect(decision.pctUsed).toBe(1.0);
      expect(decision.remainingBudget).toBe(0);
    });

    it('should stop on diminishing returns', () => {
      const usage = { totalTokens: 30000, promptTokens: 28000, completionTokens: 300 };
      const decision = budgetController.evaluate(usage, 0);
      expect(decision.action).toBe('stop');
      expect(decision.reason).toBe('diminishing_returns');
      expect(decision.nudgeMessage).toContain('Diminishing returns');
    });

    it('should stop at max continuations', () => {
      const usage = { totalTokens: 30000, promptTokens: 20000, completionTokens: 10000 };
      const decision = budgetController.evaluate(usage, 10);
      expect(decision.action).toBe('stop');
      expect(decision.reason).toBe('max_continuations');
      expect(decision.nudgeMessage).toContain('Maximum continuations');
    });

    it('should continue just below threshold', () => {
      const usage = { totalTokens: 89000, promptTokens: 40000, completionTokens: 49000 };
      const decision = budgetController.evaluate(usage, 0);
      expect(decision.action).toBe('continue');
      expect(decision.pctUsed).toBe(0.89);
    });

    it('should stop at exact threshold', () => {
      const usage = { totalTokens: 90000, promptTokens: 40000, completionTokens: 50000 };
      const decision = budgetController.evaluate(usage, 0);
      expect(decision.action).toBe('stop');
      expect(decision.reason).toBe('threshold_reached');
    });

    it('should stop at max continuations minus one when other conditions apply', () => {
      const usage = { totalTokens: 99000, promptTokens: 40000, completionTokens: 59000 };
      const decision = budgetController.evaluate(usage, 9);
      expect(decision.action).toBe('stop');
      expect(decision.reason).toBe('threshold_reached');
    });
  });

  describe('isDiminishingReturns', () => {
    it('should return true when completion tokens below threshold', () => {
      expect(budgetController.isDiminishingReturns(300)).toBe(true);
    });

    it('should return false when completion tokens at threshold', () => {
      expect(budgetController.isDiminishingReturns(500)).toBe(false);
    });

    it('should return false when completion tokens above threshold', () => {
      expect(budgetController.isDiminishingReturns(600)).toBe(false);
    });
  });

  describe('generateNudgeMessage', () => {
    it('should generate max_continuations message', () => {
      const msg = budgetController.generateNudgeMessage(0.5, 'max_continuations');
      expect(msg).toContain('Maximum continuations');
      expect(msg).toContain('10');
    });

    it('should generate budget_exhausted message', () => {
      const msg = budgetController.generateNudgeMessage(1.0, 'budget_exhausted');
      expect(msg).toContain('Budget exhausted');
      expect(msg).toContain('100%');
    });

    it('should generate threshold_reached message', () => {
      const msg = budgetController.generateNudgeMessage(0.92, 'threshold_reached');
      expect(msg).toContain('threshold reached');
      expect(msg).toContain('92%');
    });

    it('should generate diminishing_returns message', () => {
      const msg = budgetController.generateNudgeMessage(0.3, 'diminishing_returns');
      expect(msg).toContain('Diminishing returns');
      expect(msg).toContain('30%');
    });

    it('should generate default message for unknown reason', () => {
      const msg = budgetController.generateNudgeMessage(0.55, 'unknown');
      expect(msg).toContain('55%');
    });
  });

  describe('custom config', () => {
    it('should use custom maxTokens', () => {
      const custom = new BudgetController({
        maxTokens: 50000,
        completionThreshold: 0.9,
        diminishingThreshold: 500,
        maxContinuations: 10,
      });
      const usage = { totalTokens: 30000, promptTokens: 15000, completionTokens: 15000 };
      const decision = custom.evaluate(usage, 0);
      expect(decision.pctUsed).toBe(0.6);
      expect(decision.remainingBudget).toBe(20000);
      expect(decision.action).toBe('continue');
    });

    it('should use custom completionThreshold', () => {
      const custom = new BudgetController({
        maxTokens: 100000,
        completionThreshold: 0.5,
        diminishingThreshold: 500,
        maxContinuations: 10,
      });
      const usage = { totalTokens: 55000, promptTokens: 25000, completionTokens: 30000 };
      const decision = custom.evaluate(usage, 0);
      expect(decision.action).toBe('stop');
      expect(decision.reason).toBe('threshold_reached');
    });

    it('should use custom diminishingThreshold', () => {
      const custom = new BudgetController({
        maxTokens: 100000,
        completionThreshold: 0.9,
        diminishingThreshold: 1000,
        maxContinuations: 10,
      });
      const usage = { totalTokens: 30000, promptTokens: 28000, completionTokens: 500 };
      const decision = custom.evaluate(usage, 0);
      expect(decision.action).toBe('stop');
      expect(decision.reason).toBe('diminishing_returns');
    });

    it('should use custom maxContinuations', () => {
      const custom = new BudgetController({
        maxTokens: 100000,
        completionThreshold: 0.9,
        diminishingThreshold: 500,
        maxContinuations: 3,
      });
      const usage = { totalTokens: 30000, promptTokens: 20000, completionTokens: 10000 };
      const decision = custom.evaluate(usage, 3);
      expect(decision.action).toBe('stop');
      expect(decision.reason).toBe('max_continuations');
    });
  });

  describe('edge cases', () => {
    it('should handle zero tokens', () => {
      const usage = { totalTokens: 0, promptTokens: 0, completionTokens: 0 };
      const decision = budgetController.evaluate(usage, 0);
      expect(decision.action).toBe('stop');
      expect(decision.reason).toBe('diminishing_returns');
      expect(decision.pctUsed).toBe(0);
      expect(decision.remainingBudget).toBe(100000);
    });

    it('should handle continuation count of 0', () => {
      const usage = { totalTokens: 10000, promptTokens: 5000, completionTokens: 5000 };
      const decision = budgetController.evaluate(usage, 0);
      expect(decision.action).toBe('continue');
    });
  });
});
