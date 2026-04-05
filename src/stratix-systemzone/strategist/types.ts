// ============================================
// Strategist Types
// Phase 1: Step 3 - ProjectScanner 确定性扫描
// ============================================

import type {
  ScanResult,
} from '../types';

// ------------------------------------------------
// Scanner Types
// ------------------------------------------------

export interface ScannerConfig {
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 工作目录，默认为项目根目录 */
  cwd?: string;
  /** 文件大小阈值（行数），默认 500 */
  fileSizeThreshold?: number;
  /** 覆盖率阈值（百分比），默认 50% */
  coverageThreshold?: number;
  /** 是否启用缓存 */
  cacheEnabled?: boolean;
  /** 缓存 TTL（毫秒），默认 30 分钟 */
  cacheTtlMs?: number;
}

export interface ScannerResult {
  /** 是否成功完成所有扫描 */
  success: boolean;
  /** 扫描结果 */
  scanResult: ScanResult;
  /** 错误信息（如果有） */
  errors: ScannerError[];
  /** 各扫描步骤耗时（毫秒） */
  duration: {
    coverage: number;
    typecheck: number;
    lint: number;
    fileSizes: number;
    total: number;
  };
}

export interface ScannerError {
  step: 'coverage' | 'typecheck' | 'lint' | 'fileSizes';
  message: string;
  partialResult?: unknown;
}

// Jest JSON coverage output structure (v8+)
export interface JestCoverageJson {
  coverageMap?: Record<string, JestFileCoverage>;
  [key: string]: unknown;
}

export interface JestFileCoverage {
  path: string;
  statementMap: Record<string, unknown>;
  fnMap: Record<string, unknown>;
  branchMap: Record<string, unknown>;
  s: Record<string, number>; // statement coverage
  f: Record<string, number>; // function coverage
  b: Record<string, number[]>; // branch coverage
  statementCount: number;
  hitCount: number;
  fnCount: number;
  hitFnCount: number;
  branchCount: number;
  hitBranchCount: number;
  lines?: Record<string, number>;
}

// ESLint JSON output format
export interface EslintJsonResult {
  results: EslintFileResult[];
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
}

export interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
}

export interface EslintMessage {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  ruleId: string | null;
  severity: number; // 1 = warning, 2 = error
  source?: string;
}

// ------------------------------------------------
// Parallel Scan Types (Task 2.4)
// ------------------------------------------------

/** TSC 扫描结果项 */
export interface TscScanItem {
  file: string;
  line: number;
  message: string;
  code: string;
}

/** ESLint 扫描结果项 */
export interface EslintScanItem {
  file: string;
  ruleId: string | null;
  severity: 1 | 2; // 1=warn, 2=error
  message: string;
  line: number;
}

/** 文件大小扫描结果项 */
export interface FileSizeScanItem {
  file: string;
  lines: number;
  needsRefactor: boolean;
}

/** 并行三扫结果 */
export interface ParallelScanResult {
  tscErrors: TscScanItem[];
  eslintIssues: EslintScanItem[];
  largeFiles: FileSizeScanItem[];
}

// ------------------------------------------------
// ProposalMapper Types
// ------------------------------------------------

export interface ProposalMapperConfig {
  /** 覆盖率低阈值（百分比），低于此值生成提案 */
  coverageThreshold?: number;
  /** 文件大小阈值（行数），高于此值生成提案 */
  fileSizeThreshold?: number;
  /** Lint 错误权重 */
  lintErrorWeight?: number;
  /** Lint 警告权重 */
  lintWarningWeight?: number;
}

export interface MappingContext {
  /** 当前时间戳 */
  timestamp: Date;
  /** 扫描结果 */
  scanResult: ScanResult;
  /** 根项目路径 */
  projectRoot: string;
}
