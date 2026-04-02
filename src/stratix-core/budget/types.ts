/**
 * BudgetController Types
 * Token budget management types for agent execution
 */

export interface BudgetConfig {
  /** Maximum tokens allowed per session */
  maxTokens: number;
  /** Percentage threshold (0-1) to warn about high usage, default 0.9 */
  completionThreshold: number;
  /** Token count below which diminishing returns check is triggered */
  diminishingThreshold: number;
  /** Maximum number of continuations allowed */
  maxContinuations: number;
}

export interface TokenUsage {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

export type BudgetAction = 'continue' | 'stop';

export interface BudgetDecision {
  action: BudgetAction;
  reason: string;
  pctUsed: number;
  remainingBudget: number;
  nudgeMessage?: string;
}
