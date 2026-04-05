// ============================================
// FitnessEvaluator Types - Phase 2: P2-08
// ============================================

import type { FitnessThresholds, FitnessReport } from '../executor/types';

export {
  type FitnessThresholds,
  type FitnessReport,
  DEFAULT_FITNESS_THRESHOLDS,
} from '../executor/types';

// ------------------------------------------------
// Code Quality Metrics
// ------------------------------------------------

export interface CodeQualityMetrics {
  timestamp: Date;
  testCoverage: number;           // 0-100 percentage
  cyclomaticComplexity: number;   // average per function
  duplicationRate: number;       // 0-1 ratio
  lintErrorCount: number;
  lintWarningCount: number;
  typeErrorCount: number;
  largeFileCount: number;        // files > threshold lines
  overallScore: number;          // 0-100
}

// ------------------------------------------------
// Performance Metrics
// ------------------------------------------------

export interface PerformanceMetrics {
  timestamp: Date;
  responseTime: number;          // ms (p50)
  bundleSizeBytes: number;       // total bundle size
  bundleSizeFormatted: string;   // human readable
  largeBundleFiles: string[];    // files contributing most
  buildDuration: number;         // ms
  overallScore: number;          // 0-100
}

// ------------------------------------------------
// System Health Metrics
// ------------------------------------------------

export interface SystemHealthMetrics {
  timestamp: Date;
  errorRate: number;             // 0-1 ratio
  testPassRate: number;          // 0-100 percentage
  testPassCount: number;
  testFailCount: number;
  testSkipCount: number;
  uptimeSeconds: number;
  crashCount: number;
  overallScore: number;           // 0-100
}

// ------------------------------------------------
// Threshold Violation
// ------------------------------------------------

export interface ThresholdViolation {
  metric: string;
  actual: number;
  threshold: number;
  severity: 'critical' | 'warning';
  message: string;
}

// ------------------------------------------------
// FitnessEvaluator Config
// ------------------------------------------------

export interface FitnessEvaluatorConfig {
  /** Scanner timeout in ms */
  scannerTimeoutMs?: number;
  /** Scanner cwd */
  scannerCwd?: string;
  /** Bundle size threshold in bytes */
  bundleSizeThreshold?: number;
  /** Response time threshold in ms */
  responseTimeThreshold?: number;
  /** Custom thresholds (overrides defaults) */
  thresholds?: Partial<FitnessThresholds>;
}

// ------------------------------------------------
// Scanner Interface (for dependency injection)
// ------------------------------------------------

export interface IScanner {
  runTestCoverage(): Promise<{
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
  }>;
  runTypeCheck(): Promise<{
    errors: Array<{ file: string; line: number; column: number; message: string; code: number }>;
    warnings: Array<{ file: string; line: number; column: number; message: string; code: number }>;
    success: boolean;
  }>;
  runLint(): Promise<{
    errors: Array<{ file: string; line: number; column: number; message: string; rule: string; severity: 'error' | 'warning' }>;
    warnings: Array<{ file: string; line: number; column: number; message: string; rule: string; severity: 'error' | 'warning' }>;
    success: boolean;
    fatalErrorCount: number;
  }>;
  scanFileSizes(): Promise<{
    files: Array<{ path: string; lines: number; isLarge: boolean }>;
    threshold: number;
  }>;
  scanAll(): Promise<{
    success: boolean;
    scanResult: {
      timestamp: Date;
      coverage: unknown;
      types: unknown;
      lint: unknown;
      sizes: unknown;
    };
    errors: Array<{ step: string; message: string }>;
    duration: {
      coverage: number;
      typecheck: number;
      lint: number;
      fileSizes: number;
      total: number;
    };
  }>;
}
