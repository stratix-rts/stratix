/**
 * BudgetController
 * Token budget management for agent execution
 */

import { BudgetConfig, BudgetDecision, TokenUsage } from './types';

const DEFAULT_CONFIG: BudgetConfig = {
  maxTokens: 100000,
  completionThreshold: 0.9,
  diminishingThreshold: 500,
  maxContinuations: 10,
};

export class BudgetController {
  constructor(private config: BudgetConfig = DEFAULT_CONFIG) {}

  evaluate(usage: TokenUsage, continuationCount: number): BudgetDecision {
    const pctUsed = usage.totalTokens / this.config.maxTokens;
    const remainingBudget = this.config.maxTokens - usage.totalTokens;

    if (continuationCount >= this.config.maxContinuations) {
      return {
        action: 'stop',
        reason: 'max_continuations',
        pctUsed,
        remainingBudget,
        nudgeMessage: this.generateNudgeMessage(pctUsed, 'max_continuations'),
      };
    }

    if (pctUsed >= 1.0) {
      return {
        action: 'stop',
        reason: 'budget_exhausted',
        pctUsed,
        remainingBudget,
        nudgeMessage: this.generateNudgeMessage(pctUsed, 'budget_exhausted'),
      };
    }

    if (pctUsed >= this.config.completionThreshold) {
      return {
        action: 'stop',
        reason: 'threshold_reached',
        pctUsed,
        remainingBudget,
        nudgeMessage: this.generateNudgeMessage(pctUsed, 'threshold_reached'),
      };
    }

    if (this.isDiminishingReturns(usage.completionTokens)) {
      return {
        action: 'stop',
        reason: 'diminishing_returns',
        pctUsed,
        remainingBudget,
        nudgeMessage: this.generateNudgeMessage(pctUsed, 'diminishing_returns'),
      };
    }

    return {
      action: 'continue',
      reason: 'within_budget',
      pctUsed,
      remainingBudget,
    };
  }

  isDiminishingReturns(tokenChange: number): boolean {
    return tokenChange < this.config.diminishingThreshold;
  }

  generateNudgeMessage(pctUsed: number, reason: string): string {
    const pct = Math.round(pctUsed * 100);
    switch (reason) {
      case 'max_continuations':
        return `Maximum continuations reached (${this.config.maxContinuations}). Consider wrapping up.`;
      case 'budget_exhausted':
        return `Budget exhausted (${pct}%). Operation stopped.`;
      case 'threshold_reached':
        return `Budget threshold reached (${pct}% used). Consider concluding soon.`;
      case 'diminishing_returns':
        return `Diminishing returns detected (${pct}% used). Output quality may be declining.`;
      default:
        return `Token usage at ${pct}%.`;
    }
  }
}

export const budgetController = new BudgetController();

export default BudgetController;
