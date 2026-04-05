// ============================================
// System Zone 类型定义
// Phase 1: 类型定义 + 数据库 schema
// ============================================

// ------------------------------------------------
// 枚举类型
// ------------------------------------------------

export type SystemZoneStatus = 'active' | 'paused' | 'learning';

export type ObserverStatus = 'idle' | 'receiving' | 'processing';

export type StrategistStatus = 'idle' | 'scanning' | 'analyzing' | 'proposing';

export type GuardianStatus = 'guarding' | 'alert';

export type ProposalType = 'improve_code' | 'improve_test' | 'improve_architecture' | 'new_zone';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'rolled_back';

export type RiskLevel = 'low' | 'medium' | 'high';

export type InsightType = 'trend' | 'opportunity' | 'risk' | 'pattern';

export type UserInputType = 'news' | 'idea' | 'analysis' | 'code' | 'test_report' | 'other';

export type UserInputSource = 'manual' | 'api';

export type LessonType = 'error' | 'learning' | 'success';

export type InputFormat = 'code' | 'url' | 'text' | 'json';

export type InputLanguage = 'zh' | 'en' | 'mixed';

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

// ------------------------------------------------
// System Zone 主类型
// ------------------------------------------------

export interface SystemZoneConfig {
  loopIntervalMs: number;
  autoExecuteThreshold: 'none';
  notifyOnChange: boolean;
  llmBudget: 'unlimited';
}

export interface SystemZoneKnowledge {
  insights: Insight[];
  proposals: Proposal[];
  history: ChangeHistory[];
  lessonsLearned: Lesson[];
}

export interface SystemZone {
  id: string;
  ownerId: string;
  name: string;
  status: SystemZoneStatus;

  observer: ObserverState;
  strategist: StrategistState;
  guardian: GuardianState;

  config: SystemZoneConfig;

  knowledge: SystemZoneKnowledge;
}

// ------------------------------------------------
// Observer 类型
// ------------------------------------------------

export interface ObserverMetrics {
  inputsReceived: number;
  insightsGenerated: number;
}

export interface ObserverState {
  status: ObserverStatus;
  lastReceive: Date | null;
  pendingInputs: UserInput[];
  processedInputs: UserInput[];
  metrics: ObserverMetrics;
}

// Observer 预处理
export interface InputPreprocessor {
  detectFormat(content: string): InputFormat;
  detectLanguage(content: string): InputLanguage;
  clean(content: string): string;
  classifyInput(content: string, format: InputFormat): UserInputType;
}

// Observer LLM 语义提取器配置
export interface InsightExtractorConfig {
  model: string;
  prompt: string;
  outputSchema: InsightExtractionResult;
}

// Observer Pipeline
export interface ObserverPipeline {
  preprocessor: InputPreprocessor;
  extractor: InsightExtractorConfig;
}

// LLM 提取结果
export interface InsightExtractionResult {
  entities: string[];
  keywords: string[];
  type: InsightType;
  summary: string;
  confidence: number;
  /** 分析类别 */
  category?: 'architecture' | 'security' | 'performance' | 'quality' | 'dependency';
  /** 严重程度 */
  severity?: 'critical' | 'warning' | 'info';
  /** 详细分析 */
  details?: string;
  /** 改进建议 */
  suggestion?: string;
  /** 受影响的文件路径 */
  affectedFiles?: string[];
}

// ------------------------------------------------
// Strategist 类型
// ------------------------------------------------

export interface StrategistState {
  status: StrategistStatus;
  lastScan: Date | null;
  lastAnalysis: Date | null;
  currentProposals: Proposal[];
  scanResult: ScanResult | null;
}

// 扫描报告汇总
export interface ScanResult {
  timestamp: Date;
  coverage: CoverageReport;
  types: TypeCheckResult;
  lint: LintResult;
  sizes: FileSizeReport;
}

// Jest 覆盖率报告
export interface CoverageReport {
  totalStatements: number;
  totalBranches: number;
  totalFunctions: number;
  totalLines: number;
  coveredStatements: number;
  coveredBranches: number;
  coveredFunctions: number;
  coveredLines: number;
  uncoveredFiles: string[];
  threshold: number;
}

// TypeScript 类型检查结果
export interface TypeCheckResult {
  errors: TypeError[];
  warnings: TypeError[];
  success: boolean;
}

export interface TypeError {
  file: string;
  line: number;
  column: number;
  message: string;
  code: number;
}

// ESLint lint 结果
export interface LintResult {
  errors: LintIssue[];
  warnings: LintIssue[];
  success: boolean;
  fatalErrorCount: number;
}

export interface LintIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  rule: string;
  severity: 'error' | 'warning';
}

// 文件大小报告
export interface FileSizeReport {
  files: FileSizeEntry[];
  threshold: number;
}

export interface FileSizeEntry {
  path: string;
  lines: number;
  isLarge: boolean;
}

// ProjectScanner 接口
export interface ProjectScanner {
  runTestCoverage(): Promise<CoverageReport>;
  runTypeCheck(): Promise<TypeCheckResult>;
  runLint(): Promise<LintResult>;
  scanFileSizes(): Promise<FileSizeReport>;
}

// 确定性映射器接口
export interface ProposalMapper {
  fromCoverage(report: CoverageReport): Proposal[];
  fromTypeErrors(errors: TypeCheckResult): Proposal[];
  fromLintIssues(issues: LintResult): Proposal[];
  fromLargeFiles(files: FileSizeReport): Proposal[];
}

// LLM 增强器接口
export interface StrategistLLMEnhancer {
  enrichProposal(proposal: Proposal, sourceCode: string): Promise<Proposal>;
  analyzeArchitecture(scanResult: ScanResult): Promise<Proposal[]>;
}

// ------------------------------------------------
// Proposal 类型
// ------------------------------------------------

export interface ProposalTarget {
  file?: string;
  component?: string;
  zone?: string;
}

export interface ProposalSelection {
  confidence: number;
  cost: number;
  benefit: number;
  risk: RiskLevel;
}

export interface Proposal {
  id: string;
  timestamp: Date;
  type: ProposalType;
  title: string;
  description: string;
  target: ProposalTarget;
  selection: ProposalSelection;
  status: ProposalStatus;
  approvedBy?: string;
  executedAt?: Date;
}

// ------------------------------------------------
// Guardian 类型
// ------------------------------------------------

export interface CircuitBreakerThresholds {
  maxConsecutiveFailures: number;
  resetAfterMs: number;
}

export interface CircuitBreakerMetrics {
  consecutiveFailures: number;
  lastFailureTimestamp: Date | null;
}

export interface CircuitBreaker {
  metrics: CircuitBreakerMetrics;
  thresholds: CircuitBreakerThresholds;
  state: CircuitBreakerState;
}

export interface Alert {
  id: string;
  timestamp: Date;
  type: 'path_violation' | 'circuit_tripped' | 'approval_rejected';
  message: string;
  proposalId?: string;
}

export interface PermissionMatrix {
  forbiddenPaths: string[];
  readonlyPaths: string[];
}

export interface GuardianProtection {
  forbiddenPaths: string[];
  requireApproval: boolean;
  notifyOnProposal: boolean;
  circuitBreakerEnabled: boolean;
}

export interface GuardianState {
  status: GuardianStatus;
  permissions: PermissionMatrix;
  recentAlerts: Alert[];
  protection: GuardianProtection;
}

// ------------------------------------------------
// Insight 类型
// ------------------------------------------------

export interface Insight {
  id: string;
  timestamp: Date;
  sourceInputId: string;
  type: InsightType;
  content: string;
  entities: string[];
  confidence: number;
  archived: boolean;
}

// ------------------------------------------------
// Lesson 类型
// ------------------------------------------------

export interface Lesson {
  id: string;
  timestamp: Date;
  type: LessonType;
  category: string;
  content: string;
  context: string;
  avoidanceRule?: string;
  reuseCount: number;
}

// ------------------------------------------------
// UserInput 类型
// ------------------------------------------------

export interface UserInputMetadata {
  url?: string;
  tags?: string[];
}

export interface UserInput {
  id: string;
  timestamp: Date;
  content: string;
  source: UserInputSource;
  type: UserInputType;
  metadata?: UserInputMetadata;
}

// ------------------------------------------------
// ChangeHistory 类型 (Phase 2)
// ------------------------------------------------

export interface ChangeHistory {
  id: string;
  timestamp: Date;
  proposalId: string;
  action: 'executed' | 'rolled_back';
  diff: string;
  reverted: boolean;
}

// ------------------------------------------------
// Fitness 函数类型 (Phase 2 准备)
// ------------------------------------------------

export interface FitnessMetrics {
  codeQuality: {
    testCoverage: number;
    cyclomaticComplexity: number;
    duplicationRate: number;
  };
  performance: {
    responseTime: number;
    bundleSize: number;
  };
  systemHealth: {
    errorRate: number;
    crashCount: number;
  };
}
