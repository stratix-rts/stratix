// ============================================
// Bootstrap Engine 类型定义 - Phase 4
// ============================================

// ------------------------------------------------
// 自举状态机
// ------------------------------------------------

export type BootstrapPhase = 'discovering' | 'deciding' | 'executing' | 'evaluating' | 'idle' | 'paused';

export type BootstrapMode = 'manual' | 'semi_auto' | 'full_auto';

export interface BootstrapState {
  phase: BootstrapPhase;
  mode: BootstrapMode;
  cycleCount: number;
  successCount: number;
  failureCount: number;
  lastCycleAt: Date | null;
  lastDiscoveryAt: Date | null;
  activeExperiments: string[];
  consecutiveFailures: number;
  totalProposalsGenerated: number;
  totalProposalsExecuted: number;
  totalProposalsRolledBack: number;
  improvementScore: number;       // 0-100, overall improvement trend
}

export const DEFAULT_BOOTSTRAP_STATE: BootstrapState = {
  phase: 'idle',
  mode: 'manual',
  cycleCount: 0,
  successCount: 0,
  failureCount: 0,
  lastCycleAt: null,
  lastDiscoveryAt: null,
  activeExperiments: [],
  consecutiveFailures: 0,
  totalProposalsGenerated: 0,
  totalProposalsExecuted: 0,
  totalProposalsRolledBack: 0,
  improvementScore: 50,
};

// ------------------------------------------------
// 发现引擎
// ------------------------------------------------

export interface DiscoveryConfig {
  scanInterval: number;           // ms, 扫描间隔
  maxProposalsPerCycle: number;   // 每轮最大提案数
  minImprovementScore: number;    // 最低改进分数阈值
  enabledCategories: string[];    // 启用的改进类别
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  scanInterval: 3_600_000,       // 1 hour
  maxProposalsPerCycle: 5,
  minImprovementScore: 10,
  enabledCategories: ['test', 'code', 'architecture', 'performance'],
};

export interface DiscoveryResult {
  proposals: DiscoveredProposal[];
  scanMetrics: ScanMetrics;
  timestamp: Date;
}

export interface DiscoveredProposal {
  id: string;
  category: string;
  target: string;
  description: string;
  estimatedImpact: number;        // 0-100
  estimatedRisk: number;          // 0-100
  estimatedEffort: 'low' | 'medium' | 'high';
  source: 'scanner' | 'fitness' | 'external' | 'lesson';
  data: Record<string, unknown>;
}

export interface ScanMetrics {
  filesScanned: number;
  issuesFound: number;
  coverageGaps: number;
  complexityHotspots: number;
  scanDuration: number;           // ms
}

// ------------------------------------------------
// 决策引擎
// ------------------------------------------------

export interface DecisionConfig {
  autoApproveThreshold: number;   // 自动审批的风险阈值 0-100
  requireManualAbove: number;     // 超过此风险值必须人工审批
  maxConcurrentExecutions: number;
  cooldownAfterFailure: number;   // 失败后冷却时间 ms
}

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  autoApproveThreshold: 30,
  requireManualAbove: 70,
  maxConcurrentExecutions: 2,
  cooldownAfterFailure: 600_000,  // 10 minutes
};

export interface Decision {
  proposalId: string;
  action: 'approve' | 'reject' | 'defer' | 'escalate';
  confidence: number;             // 0-1
  reasoning: string;
  riskAssessment: RiskAssessment;
  expectedOutcome: string;
}

export interface RiskAssessment {
  overall: number;                // 0-100
  factors: RiskFactor[];
  mitigations: string[];
}

export interface RiskFactor {
  name: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

// ------------------------------------------------
// 效果评估
// ------------------------------------------------

export interface ImpactEvaluation {
  proposalId: string;
  before: MetricSnapshot;
  after: MetricSnapshot;
  deltas: MetricDeltas;
  overallImpact: number;          // -100 to +100
  recommendation: 'keep' | 'rollback' | 'investigate';
}

export interface MetricSnapshot {
  timestamp: Date;
  testCoverage: number;
  testPassRate: number;
  typeErrors: number;
  lintErrors: number;
  bundleSize: number;
  responseTime: number;
  fitnessScore: number;
}

export interface MetricDeltas {
  testCoverage: number;
  testPassRate: number;
  typeErrors: number;
  lintErrors: number;
  bundleSize: number;
  responseTime: number;
  fitnessScore: number;
}

// ------------------------------------------------
// 退化保护
// ------------------------------------------------

export type RegressionSeverity = 'none' | 'minor' | 'major' | 'critical';

export interface RegressionCheck {
  proposalId: string;
  regressions: Regression[];
  severity: RegressionSeverity;
  canProceed: boolean;
}

export interface Regression {
  metric: string;
  beforeValue: number;
  afterValue: number;
  delta: number;
  threshold: number;              // 允许的最大变化
  isRegression: boolean;
}

export interface RegressionGuardConfig {
  maxCoverageDrop: number;        // 最大允许覆盖率下降（百分点）
  maxTestPassRateDrop: number;    // 最大允许通过率下降
  maxTypeErrorIncrease: number;   // 最大允许类型错误增加
  maxLintErrorIncrease: number;   // 最大允许 lint 错误增加
  maxBundleSizeIncrease: number;  // 最大允许包体积增加（百分比）
  maxResponseTimeIncrease: number;// 最大允许响应时间增加（百分比）
  blockOnCriticalRegression: boolean;
}

export const DEFAULT_REGRESSION_GUARD_CONFIG: RegressionGuardConfig = {
  maxCoverageDrop: 2,
  maxTestPassRateDrop: 1,
  maxTypeErrorIncrease: 0,
  maxLintErrorIncrease: 5,
  maxBundleSizeIncrease: 5,
  maxResponseTimeIncrease: 10,
  blockOnCriticalRegression: true,
};

// ------------------------------------------------
// 实验区 Zone
// ------------------------------------------------

export type ExperimentStatus = 'proposed' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExperimentZone {
  id: string;
  name: string;
  description: string;
  status: ExperimentStatus;
  proposalId: string;
  branchName: string;
  worktreePath: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  result: ImpactEvaluation | null;
  parentZoneId: string;           // System Zone ID
}

// ------------------------------------------------
// Bootstrap Engine 配置
// ------------------------------------------------

export interface BootstrapEngineConfig {
  discovery: DiscoveryConfig;
  decision: DecisionConfig;
  regressionGuard: RegressionGuardConfig;
  mode: BootstrapMode;
  maxCyclesPerDay: number;
  requireHumanApprovalForMode: BootstrapMode[]; // 需要人工确认的模式切换
}

export const DEFAULT_BOOTSTRAP_ENGINE_CONFIG: BootstrapEngineConfig = {
  discovery: DEFAULT_DISCOVERY_CONFIG,
  decision: DEFAULT_DECISION_CONFIG,
  regressionGuard: DEFAULT_REGRESSION_GUARD_CONFIG,
  mode: 'manual',
  maxCyclesPerDay: 24,
  requireHumanApprovalForMode: ['full_auto'],
};
