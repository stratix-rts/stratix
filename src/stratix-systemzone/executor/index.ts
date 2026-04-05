// ============================================
// executor/index.ts - Executor 模块导出
// Phase 2: Step 6 - Executor 主类
// ============================================

export { Executor } from './Executor';
export type { ExecutorEvent, ExecutorEventType, ExecutorDependencies } from './Executor';

export { Sandbox } from './Sandbox';
export type { SandboxInfo, SandboxError } from './Sandbox';

export { CodeModifier } from './CodeModifier';
export type { ValidationResult, CodeModifierConfig } from './CodeModifier';

export { TestRunner } from './TestRunner';
export type { CoverageReport, CoverageDelta } from './TestRunner';

export { RollbackManager } from './RollbackManager';
export type { Snapshot, RollbackError } from './RollbackManager';

// Re-export types
export type {
  ExecutorConfig,
  ExecutorState,
  ExecutorPhase,
  ExecutionResult,
  SandboxConfig,
  RollbackConfig,
  ModificationPlan,
  FileModification,
  ModificationType,
  TestVerificationResult,
  TestFailure,
  FitnessThresholds,
  FitnessReport,
} from './types';

export {
  DEFAULT_EXECUTOR_CONFIG,
  DEFAULT_EXECUTOR_STATE,
  DEFAULT_SANDBOX_CONFIG,
  DEFAULT_ROLLBACK_CONFIG,
  DEFAULT_FITNESS_THRESHOLDS,
} from './types';
