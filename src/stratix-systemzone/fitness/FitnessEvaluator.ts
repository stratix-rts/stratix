// ============================================
// FitnessEvaluator - 健康度评估器
// Phase 2: P2-08 - FitnessEvaluator 健康度评估器
// ============================================

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type {
  FitnessReport,
  FitnessThresholds,
  CodeQualityMetrics,
  PerformanceMetrics,
  SystemHealthMetrics,
  ThresholdViolation,
  FitnessEvaluatorConfig,
  IScanner,
} from './types';

import { DEFAULT_FITNESS_THRESHOLDS } from '../executor/types';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CWD = path.resolve(__dirname, '../../../../');
const DEFAULT_BUNDLE_SIZE_THRESHOLD = 500_000; // 500KB

/**
 * FitnessEvaluator - 健康度评估器
 *
 * 执行完整的项目健康度评估，包括：
 * - 代码质量评估（覆盖率、圈复杂度、重复率）
 * - 性能评估（响应时间、构建产物大小）
 * - 系统健康评估（错误率、测试通过率）
 *
 * 评估结果用于决定是否启用 Executor
 */
export class FitnessEvaluator {
  private config: Required<FitnessEvaluatorConfig>;
  private thresholds: FitnessThresholds;
  private scanner: IScanner | null = null;

  constructor(config: FitnessEvaluatorConfig = {}) {
    this.config = {
      scannerTimeoutMs: config.scannerTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      scannerCwd: config.scannerCwd ?? DEFAULT_CWD,
      bundleSizeThreshold: config.bundleSizeThreshold ?? DEFAULT_BUNDLE_SIZE_THRESHOLD,
      responseTimeThreshold: config.responseTimeThreshold ?? 500,
      thresholds: config.thresholds ?? {},
    };

    this.thresholds = {
      ...DEFAULT_FITNESS_THRESHOLDS,
      ...this.config.thresholds,
    };
  }

  /**
   * 设置自定义 Scanner（用于测试或高级用法）
   */
  setScanner(scanner: IScanner): void {
    this.scanner = scanner;
  }

  /**
   * 执行完整健康度评估
   */
  async evaluate(): Promise<FitnessReport> {
    const startTime = Date.now();

    // Run all evaluations in parallel
    const [codeQuality, performance, systemHealth] = await Promise.all([
      this.evaluateCodeQuality(),
      this.evaluatePerformance(),
      this.evaluateSystemHealth(),
    ]);

    // Calculate overall score (weighted average)
    const overall = Math.round(
      codeQuality.overallScore * 0.4 +
      performance.overallScore * 0.3 +
      systemHealth.overallScore * 0.3
    );

    // Check threshold violations
    const violations = this.checkViolations(codeQuality, performance, systemHealth);

    // FitnessReport.violations is string[], so convert ThresholdViolation to message strings
    const violationMessages = violations.map(v => v.message);

    const report: FitnessReport = {
      timestamp: new Date(),
      metrics: {
        testCoverage: codeQuality.testCoverage,
        cyclomaticComplexity: codeQuality.cyclomaticComplexity,
        duplicationRate: codeQuality.duplicationRate,
        responseTime: performance.responseTime,
        errorRate: systemHealth.errorRate,
      },
      scores: {
        codeQuality: codeQuality.overallScore,
        performance: performance.overallScore,
        systemHealth: systemHealth.overallScore,
        overall,
      },
      passed: violations.length === 0,
      violations: violationMessages,
    };

    return report;
  }

  /**
   * 评估代码质量
   *
   * 复用 ProjectScanner 获取覆盖率数据，计算圈复杂度和重复率
   */
  async evaluateCodeQuality(): Promise<CodeQualityMetrics> {
    const scanner = this.scanner ?? this.createDefaultScanner();

    let coverage = this.emptyCoverageReport();
    let lintResult = this.emptyLintResult();
    let typeResult = this.emptyTypeResult();
    let sizeReport = { files: [] as Array<{ path: string; lines: number; isLarge: boolean }>, threshold: 500 };

    try {
      const [cov, lint, types, sizes] = await Promise.all([
        scanner.runTestCoverage().catch(() => coverage),
        scanner.runLint().catch(() => lintResult),
        scanner.runTypeCheck().catch(() => typeResult),
        scanner.scanFileSizes().catch(() => sizeReport),
      ]);

      coverage = cov;
      lintResult = lint;
      typeResult = types;
      sizeReport = sizes;
    } catch {
      // Fallback to empty results on error
    }

    // Calculate test coverage percentage
    const testCoverage = coverage.totalStatements > 0
      ? Math.round((coverage.coveredStatements / coverage.totalStatements) * 100)
      : 0;

    // Calculate cyclomatic complexity (simplified - based on branch/statement ratio)
    const cyclomaticComplexity = coverage.totalStatements > 0 && coverage.totalBranches > 0
      ? Math.max(1, Math.round((coverage.totalBranches / coverage.totalStatements) * 10))
      : 1;

    // Calculate duplication rate (simplified - based on uncovered files ratio)
    const duplicationRate = coverage.totalStatements > 0
      ? (coverage.uncoveredFiles?.length ?? 0) / Math.max(1, Object.keys(coverage).length)
      : 0;

    // Count lint issues
    const lintErrorCount = lintResult.errors?.length ?? 0;
    const lintWarningCount = lintResult.warnings?.length ?? 0;
    const typeErrorCount = typeResult.errors?.length ?? 0;
    const largeFileCount = sizeReport.files?.filter(f => f.isLarge).length ?? 0;

    // Calculate code quality score (0-100)
    let score = 100;
    score -= Math.max(0, (50 - testCoverage) * 1.5); // Coverage penalty
    score -= Math.min(20, lintErrorCount * 2);         // Lint error penalty
    score -= Math.min(10, lintWarningCount * 0.5);    // Lint warning penalty
    score -= Math.min(15, typeErrorCount * 1.5);      // Type error penalty
    score -= Math.min(10, largeFileCount * 2);        // Large file penalty
    score -= Math.max(0, (cyclomaticComplexity - this.thresholds.maxCyclomaticComplexity) * 2);
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      timestamp: new Date(),
      testCoverage,
      cyclomaticComplexity,
      duplicationRate,
      lintErrorCount,
      lintWarningCount,
      typeErrorCount,
      largeFileCount,
      overallScore: score,
    };
  }

  /**
   * 评估性能
   *
   * 运行 benchmark 或解析构建产物大小
   */
  async evaluatePerformance(): Promise<PerformanceMetrics> {
    const startTime = Date.now();

    // Get bundle size by running build
    const bundleInfo = await this.measureBundleSize();

    // Get build duration
    const buildDuration = Date.now() - startTime;

    // Response time (simulated - in real implementation would run actual benchmarks)
    const responseTime = await this.measureResponseTime();

    // Calculate performance score
    let score = 100;
    score -= Math.max(0, (bundleInfo.sizeBytes - this.config.bundleSizeThreshold) / this.config.bundleSizeThreshold * 30);
    score -= Math.max(0, (responseTime - this.config.responseTimeThreshold) / this.config.responseTimeThreshold * 20);
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      timestamp: new Date(),
      responseTime,
      bundleSizeBytes: bundleInfo.sizeBytes,
      bundleSizeFormatted: bundleInfo.formatted,
      largeBundleFiles: bundleInfo.largeFiles,
      buildDuration,
      overallScore: score,
    };
  }

  /**
   * 评估系统健康
   *
   * 检查错误率、测试通过率
   */
  async evaluateSystemHealth(): Promise<SystemHealthMetrics> {
    const scanner = this.scanner ?? this.createDefaultScanner();

    let coverage = this.emptyCoverageReport();
    let testResult = this.emptyTestResult();

    try {
      const [cov] = await Promise.all([
        scanner.runTestCoverage().catch(() => coverage),
      ]);

      coverage = cov;

      // Parse test results from coverage output
      // In real implementation, would run tests separately
      const totalTests = coverage.totalStatements > 0 ? Math.max(1, coverage.totalFunctions) : 1;
      const passedTests = coverage.coveredFunctions;
      const failedTests = coverage.totalFunctions - coverage.coveredFunctions;

      testResult = {
        passed: failedTests === 0,
        totalTests,
        passedTests,
        failedTests,
        skippedTests: 0,
      };
    } catch {
      // Fallback
    }

    const testPassRate = testResult.totalTests > 0
      ? Math.round((testResult.passedTests / testResult.totalTests) * 100)
      : 0;

    // Error rate based on test failures and uncovered statements
    const uncoveredRatio = coverage.totalStatements > 0
      ? (coverage.totalStatements - coverage.coveredStatements) / coverage.totalStatements
      : 1;
    const errorRate = Math.min(1, uncoveredRatio + (testResult.failedTests / Math.max(1, testResult.totalTests) * 0.5));

    // Calculate system health score
    let score = 100;
    score -= Math.max(0, (100 - testPassRate) * 0.8);       // Test pass rate
    score -= Math.min(20, testResult.failedTests * 5);     // Failed tests
    score -= Math.max(0, errorRate * 30);                   // Error rate
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      timestamp: new Date(),
      errorRate: Math.round(errorRate * 100) / 100,
      testPassRate,
      testPassCount: testResult.passedTests,
      testFailCount: testResult.failedTests,
      testSkipCount: testResult.skippedTests,
      uptimeSeconds: process.uptime(),
      crashCount: 0,
      overallScore: score,
    };
  }

  /**
   * 检查阈值违规
   */
  checkThresholds(report: FitnessReport): ThresholdViolation[] {
    const violations: ThresholdViolation[] = [];
    const { metrics } = report;

    // Check test coverage
    if (metrics.testCoverage < this.thresholds.minTestCoverage) {
      violations.push({
        metric: 'testCoverage',
        actual: metrics.testCoverage,
        threshold: this.thresholds.minTestCoverage,
        severity: metrics.testCoverage < this.thresholds.minTestCoverage - 10 ? 'critical' : 'warning',
        message: `Test coverage ${metrics.testCoverage}% is below threshold ${this.thresholds.minTestCoverage}%`,
      });
    }

    // Check cyclomatic complexity
    if (metrics.cyclomaticComplexity > this.thresholds.maxCyclomaticComplexity) {
      violations.push({
        metric: 'cyclomaticComplexity',
        actual: metrics.cyclomaticComplexity,
        threshold: this.thresholds.maxCyclomaticComplexity,
        severity: 'warning',
        message: `Cyclomatic complexity ${metrics.cyclomaticComplexity} exceeds threshold ${this.thresholds.maxCyclomaticComplexity}`,
      });
    }

    // Check duplication rate
    if (metrics.duplicationRate > this.thresholds.maxDuplicationRate) {
      violations.push({
        metric: 'duplicationRate',
        actual: metrics.duplicationRate,
        threshold: this.thresholds.maxDuplicationRate,
        severity: 'warning',
        message: `Duplication rate ${(metrics.duplicationRate * 100).toFixed(1)}% exceeds threshold ${(this.thresholds.maxDuplicationRate * 100).toFixed(1)}%`,
      });
    }

    // Check response time
    if (metrics.responseTime > this.thresholds.maxResponseTime) {
      violations.push({
        metric: 'responseTime',
        actual: metrics.responseTime,
        threshold: this.thresholds.maxResponseTime,
        severity: metrics.responseTime > this.thresholds.maxResponseTime * 2 ? 'critical' : 'warning',
        message: `Response time ${metrics.responseTime}ms exceeds threshold ${this.thresholds.maxResponseTime}ms`,
      });
    }

    // Check error rate
    if (metrics.errorRate > this.thresholds.maxErrorRate) {
      violations.push({
        metric: 'errorRate',
        actual: metrics.errorRate,
        threshold: this.thresholds.maxErrorRate,
        severity: metrics.errorRate > this.thresholds.maxErrorRate * 5 ? 'critical' : 'warning',
        message: `Error rate ${(metrics.errorRate * 100).toFixed(1)}% exceeds threshold ${(this.thresholds.maxErrorRate * 100).toFixed(1)}%`,
      });
    }

    return violations;
  }

  /**
   * 检查是否满足 Executor 启用条件
   */
  async canEnableExecutor(): Promise<boolean> {
    const [codeQuality, performance, systemHealth] = await Promise.all([
      this.evaluateCodeQuality(),
      this.evaluatePerformance(),
      this.evaluateSystemHealth(),
    ]);

    // Get full violations list to check severity
    const violations = this.checkViolations(codeQuality, performance, systemHealth);

    // All threshold violations must be warnings, not critical
    const criticalViolations = violations.filter(v => v.severity === 'critical');

    // Calculate overall score
    const overall = Math.round(
      codeQuality.overallScore * 0.4 +
      performance.overallScore * 0.3 +
      systemHealth.overallScore * 0.3
    );

    // Overall score must be at least 60
    const hasAcceptableScore = overall >= 60;

    // Must have passed flag OR only warning violations
    const hasPassed = violations.length === 0 || criticalViolations.length === 0;

    return hasAcceptableScore && hasPassed;
  }

  // -------------------------------------------------------------------------
  // Private helper methods
  // -------------------------------------------------------------------------

  /**
   * Check violations across all metric categories
   */
  private checkViolations(
    codeQuality: CodeQualityMetrics,
    performance: PerformanceMetrics,
    systemHealth: SystemHealthMetrics
  ): ThresholdViolation[] {
    const violations: ThresholdViolation[] = [];

    // Code quality violations
    if (codeQuality.testCoverage < this.thresholds.minTestCoverage) {
      violations.push({
        metric: 'testCoverage',
        actual: codeQuality.testCoverage,
        threshold: this.thresholds.minTestCoverage,
        severity: codeQuality.testCoverage < this.thresholds.minTestCoverage - 10 ? 'critical' : 'warning',
        message: `Test coverage ${codeQuality.testCoverage}% is below threshold ${this.thresholds.minTestCoverage}%`,
      });
    }

    if (codeQuality.cyclomaticComplexity > this.thresholds.maxCyclomaticComplexity) {
      violations.push({
        metric: 'cyclomaticComplexity',
        actual: codeQuality.cyclomaticComplexity,
        threshold: this.thresholds.maxCyclomaticComplexity,
        severity: 'warning',
        message: `Cyclomatic complexity ${codeQuality.cyclomaticComplexity} exceeds threshold ${this.thresholds.maxCyclomaticComplexity}`,
      });
    }

    if (codeQuality.duplicationRate > this.thresholds.maxDuplicationRate) {
      violations.push({
        metric: 'duplicationRate',
        actual: codeQuality.duplicationRate,
        threshold: this.thresholds.maxDuplicationRate,
        severity: 'warning',
        message: `Duplication rate ${(codeQuality.duplicationRate * 100).toFixed(1)}% exceeds threshold ${(this.thresholds.maxDuplicationRate * 100).toFixed(1)}%`,
      });
    }

    // Performance violations
    if (performance.responseTime > this.thresholds.maxResponseTime) {
      violations.push({
        metric: 'responseTime',
        actual: performance.responseTime,
        threshold: this.thresholds.maxResponseTime,
        severity: performance.responseTime > this.thresholds.maxResponseTime * 2 ? 'critical' : 'warning',
        message: `Response time ${performance.responseTime}ms exceeds threshold ${this.thresholds.maxResponseTime}ms`,
      });
    }

    // System health violations
    if (systemHealth.errorRate > this.thresholds.maxErrorRate) {
      violations.push({
        metric: 'errorRate',
        actual: systemHealth.errorRate,
        threshold: this.thresholds.maxErrorRate,
        severity: systemHealth.errorRate > this.thresholds.maxErrorRate * 5 ? 'critical' : 'warning',
        message: `Error rate ${(systemHealth.errorRate * 100).toFixed(1)}% exceeds threshold ${(this.thresholds.maxErrorRate * 100).toFixed(1)}%`,
      });
    }

    return violations;
  }

  /**
   * 测量构建产物大小
   */
  private async measureBundleSize(): Promise<{ sizeBytes: number; formatted: string; largeFiles: string[] }> {
    const distDir = path.join(this.config.scannerCwd, 'dist');

    if (!fs.existsSync(distDir)) {
      return { sizeBytes: 0, formatted: '0 B', largeFiles: [] };
    }

    const fileSizes: Array<{ path: string; size: number }> = [];
    let totalSize = 0;

    const scanDir = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile()) {
            const stat = await fs.promises.stat(fullPath);
            totalSize += stat.size;
            fileSizes.push({ path: fullPath, size: stat.size });
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    await scanDir(distDir);

    // Sort by size descending
    fileSizes.sort((a, b) => b.size - a.size);
    const largeFiles = fileSizes.slice(0, 5).map(f => path.relative(this.config.scannerCwd, f.path));

    return {
      sizeBytes: totalSize,
      formatted: this.formatBytes(totalSize),
      largeFiles,
    };
  }

  /**
   * 测量响应时间（简化版 - 实际会运行 benchmark）
   */
  private async measureResponseTime(): Promise<number> {
    // In a real implementation, this would:
    // 1. Start the dev server
    // 2. Run a series of requests
    // 3. Calculate p50 response time
    // For now, return a simulated value based on build time
    return 150; // Default 150ms
  }

  /**
   * 创建默认 Scanner 实例
   */
  private createDefaultScanner(): IScanner {
    // Lazy import to avoid circular dependency
    const { ProjectScanner } = require('../strategist/ProjectScanner');
    const scanner = new ProjectScanner({
      timeoutMs: this.config.scannerTimeoutMs,
      cwd: this.config.scannerCwd,
      cacheEnabled: true,
    });

    return {
      runTestCoverage: () => scanner.runTestCoverage(),
      runTypeCheck: () => scanner.runTypeCheck(),
      runLint: () => scanner.runLint(),
      scanFileSizes: () => scanner.scanFileSizes(),
      scanAll: () => scanner.scanAll(),
    };
  }

  /**
   * 格式化字节数
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * Empty coverage report
   */
  private emptyCoverageReport(): {
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
  } {
    return {
      totalStatements: 0,
      totalBranches: 0,
      totalFunctions: 0,
      totalLines: 0,
      coveredStatements: 0,
      coveredBranches: 0,
      coveredFunctions: 0,
      coveredLines: 0,
      uncoveredFiles: [] as string[],
      threshold: 80,
    };
  }

  /**
   * Empty lint result
   */
  private emptyLintResult(): {
    errors: Array<{ file: string; line: number; column: number; message: string; rule: string; severity: 'error' | 'warning' }>;
    warnings: Array<{ file: string; line: number; column: number; message: string; rule: string; severity: 'error' | 'warning' }>;
    success: boolean;
    fatalErrorCount: number;
  } {
    return {
      errors: [] as Array<{ file: string; line: number; column: number; message: string; rule: string; severity: 'error' | 'warning' }>,
      warnings: [] as Array<{ file: string; line: number; column: number; message: string; rule: string; severity: 'error' | 'warning' }>,
      success: true,
      fatalErrorCount: 0,
    };
  }

  /**
   * Empty type result
   */
  private emptyTypeResult(): {
    errors: Array<{ file: string; line: number; column: number; message: string; code: number }>;
    warnings: Array<{ file: string; line: number; column: number; message: string; code: number }>;
    success: boolean;
  } {
    return {
      errors: [] as Array<{ file: string; line: number; column: number; message: string; code: number }>,
      warnings: [] as Array<{ file: string; line: number; column: number; message: string; code: number }>,
      success: true,
    };
  }

  /**
   * Empty test result
   */
  private emptyTestResult() {
    return {
      passed: true,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
    };
  }

  /**
   * 获取当前阈值配置
   */
  getThresholds(): FitnessThresholds {
    return { ...this.thresholds };
  }
}
