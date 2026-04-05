// ============================================
// Executor 类型定义 - Phase 2
// ============================================

// ------------------------------------------------
// 执行状态机
// ------------------------------------------------

export type ExecutorPhase = 'idle' | 'preparing' | 'modifying' | 'testing' | 'committing' | 'rolling_back' | 'completed' | 'failed';

export interface ExecutorState {
  phase: ExecutorPhase;
  currentProposalId: string | null;
  sandboxBranch: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  totalExecutions: number;
  totalSuccesses: number;
  totalRollbacks: number;
}

export const DEFAULT_EXECUTOR_STATE: ExecutorState = {
  phase: 'idle',
  currentProposalId: null,
  sandboxBranch: null,
  startedAt: null,
  completedAt: null,
  lastError: null,
  consecutiveFailures: 0,
  totalExecutions: 0,
  totalSuccesses: 0,
  totalRollbacks: 0,
};

// ------------------------------------------------
// 沙箱配置
// ------------------------------------------------

export interface SandboxConfig {
  worktreeBaseDir: string;        // git worktree 存放目录
  repoPath: string;               // git 仓库路径
  maxConcurrentSandboxes: number; // 最大并发沙箱数
  autoCleanup: boolean;           // 完成后自动清理 worktree
  defaultTimeout: number;         // 默认超时(ms)
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  worktreeBaseDir: '/tmp/stratix-sandbox',
  repoPath: process.cwd(),
  maxConcurrentSandboxes: 3,
  autoCleanup: true,
  defaultTimeout: 300_000, // 5 minutes
};

// ------------------------------------------------
// 代码修改
// ------------------------------------------------

export type ModificationType = 'create' | 'edit' | 'delete' | 'rename';

export interface FileModification {
  type: ModificationType;
  path: string;                    // 相对项目根目录
  content?: string;                // create/edit 时的新内容
  originalContent?: string;        // edit 时的原始内容（用于回滚）
  newPath?: string;                // rename 时的新路径
  description: string;             // 修改描述
}

export interface ModificationPlan {
  proposalId: string;
  modifications: FileModification[];
  estimatedRisk: 'low' | 'medium' | 'high';
  affectedFiles: string[];
  description: string;
}

// ------------------------------------------------
// 测试结果
// ------------------------------------------------

export interface TestVerificationResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  duration: number;                // ms
  failures: TestFailure[];
  coverageDelta: number | null;    // 覆盖率变化 (null = 未计算)
}

export interface TestFailure {
  testName: string;
  filePath: string;
  errorMessage: string;
}

// ------------------------------------------------
// 执行结果
// ------------------------------------------------

export interface ExecutionResult {
  proposalId: string;
  success: boolean;
  phase: ExecutorPhase;
  modifications: FileModification[];
  testResult: TestVerificationResult | null;
  commitHash: string | null;
  rollbackHash: string | null;
  duration: number;                // ms
  error: string | null;
}

// ------------------------------------------------
// 回滚配置
// ------------------------------------------------

export interface RollbackConfig {
  maxSnapshots: number;            // 最多保留的快照数
  autoRollbackOnTestFail: boolean; // 测试失败自动回滚
  requireManualRollback: boolean;  // 是否需要手动确认回滚
}

export const DEFAULT_ROLLBACK_CONFIG: RollbackConfig = {
  maxSnapshots: 20,
  autoRollbackOnTestFail: true,
  requireManualRollback: false,
};

// ------------------------------------------------
// Fitness 类型
// ------------------------------------------------

export interface FitnessThresholds {
  minTestCoverage: number;         // 最低测试覆盖率 (0-100)
  maxCyclomaticComplexity: number; // 最大圈复杂度
  maxDuplicationRate: number;      // 最大重复率 (0-1)
  maxResponseTime: number;         // 最大响应时间(ms)
  maxErrorRate: number;            // 最大错误率 (0-1)
}

export const DEFAULT_FITNESS_THRESHOLDS: FitnessThresholds = {
  minTestCoverage: 80,
  maxCyclomaticComplexity: 15,
  maxDuplicationRate: 0.1,
  maxResponseTime: 500,
  maxErrorRate: 0.01,
};

export interface FitnessReport {
  timestamp: Date;
  metrics: {
    testCoverage: number;
    cyclomaticComplexity: number;
    duplicationRate: number;
    responseTime: number;
    errorRate: number;
  };
  scores: {
    codeQuality: number;  // 0-100
    performance: number;  // 0-100
    systemHealth: number; // 0-100
    overall: number;      // 0-100
  };
  passed: boolean;
  violations: string[];
}

// ------------------------------------------------
// Executor 配置
// ------------------------------------------------

export interface ExecutorConfig {
  sandbox: SandboxConfig;
  rollback: RollbackConfig;
  fitness: FitnessThresholds;
  maxRetries: number;
  requireApproval: boolean;        // 是否需要人工审批
  allowedProposalTypes: string[];  // 允许执行的提案类型
}

export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  sandbox: DEFAULT_SANDBOX_CONFIG,
  rollback: DEFAULT_ROLLBACK_CONFIG,
  fitness: DEFAULT_FITNESS_THRESHOLDS,
  maxRetries: 2,
  requireApproval: true,
  allowedProposalTypes: ['improve_code', 'improve_test', 'improve_architecture'],
};
