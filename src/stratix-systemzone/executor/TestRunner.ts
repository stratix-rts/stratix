// ============================================
// TestRunner.ts - 测试执行与验证
// Phase 2: Step 4 - TestRunner 测试验证器
// ============================================

import { spawn } from 'child_process';
import * as path from 'path';

import type { TestVerificationResult, TestFailure } from './types';

const DEFAULT_TIMEOUT_MS = 120_000; // 120 seconds

/**
 * 覆盖率报告（百分比形式）
 */
export interface CoverageReport {
  lines: number;       // 百分比 0-100
  statements: number;
  branches: number;
  functions: number;
  timestamp: Date;
}

/**
 * 覆盖率变化
 */
export interface CoverageDelta {
  lines: number;       // 变化量（百分点）
  statements: number;
  branches: number;
  functions: number;
}

/**
 * Jest JSON 输出格式
 */
interface JestJsonOutput {
  results?: Array<{
    assertionResults: Array<{
      title: string;
      status: string;
      failureMessages: string[];
      location?: string;
    }>;
    status: string;
  }>;
  coverageMap?: Record<string, unknown>;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
}

/**
 * TestRunner - 测试执行与验证
 *
 * 运行测试、获取覆盖率报告、对比覆盖率变化
 */
export class TestRunner {
  private timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * 在指定目录运行测试
   * 运行: npm test -- --coverage --json
   */
  async runTests(workDir: string): Promise<TestVerificationResult> {
    return this.runTestsInternal(workDir, []);
  }

  /**
   * 只测试指定文件
   * 运行: npm test -- --coverage --json --testPathPattern=<files>
   */
  async runTestsForFiles(workDir: string, files: string[]): Promise<TestVerificationResult> {
    return this.runTestsInternal(workDir, files);
  }

  /**
   * 获取覆盖率报告
   * 运行: npm test -- --coverage --json --coverageReporters=json
   */
  async getCoverage(workDir: string): Promise<CoverageReport> {
    return new Promise((resolve, reject) => {
      const args = [
        'test',
        '--',
        '--coverage',
        '--json',
        '--testPathIgnorePatterns=',
        '--coverageReporters=json-summary',
      ];

      const proc = spawn('npm', args, {
        cwd: workDir,
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`getCoverage timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);

        try {
          const report = this.parseCoverageReport(stdout, code);
          resolve(report);
        } catch (e) {
          reject(e);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`getCoverage failed: ${err.message}`));
      });
    });
  }

  /**
   * 对比覆盖率变化
   */
  compareCoverage(before: CoverageReport, after: CoverageReport): CoverageDelta {
    return {
      lines: this.round(after.lines - before.lines),
      statements: this.round(after.statements - before.statements),
      branches: this.round(after.branches - before.branches),
      functions: this.round(after.functions - before.functions),
    };
  }

  /**
   * 内部方法：运行测试
   */
  private runTestsInternal(workDir: string, files: string[]): Promise<TestVerificationResult> {
    return new Promise((resolve, reject) => {
      const args = ['test', '--', '--coverage', '--json', '--testPathIgnorePatterns='];

      // If specific files are provided, add test pattern
      if (files.length > 0) {
        const filePattern = files.map((f) => path.basename(f)).join('|');
        args.push(`--testPathPattern=${filePattern}`);
      }

      const proc = spawn('npm', args, {
        cwd: workDir,
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      const startTime = Date.now();

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`runTests timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;

        try {
          const result = this.parseTestOutput(stdout, code, duration);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`runTests failed: ${err.message}`));
      });
    });
  }

  /**
   * 解析 Jest JSON 测试输出
   */
  private parseTestOutput(stdout: string, exitCode: number | null, duration: number): TestVerificationResult {
    const failures: TestFailure[] = [];
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let skippedTests = 0;

    try {
      // Jest outputs JSON to stdout when using --json flag
      // Find the JSON part (may have other console output mixed in)
      const jsonMatch = stdout.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);

      if (jsonMatch) {
        const data: JestJsonOutput = JSON.parse(jsonMatch[0]);

        totalTests = data.numTotalTests ?? 0;
        passedTests = data.numPassedTests ?? 0;
        failedTests = data.numFailedTests ?? 0;
        skippedTests = data.numPendingTests ?? 0;

        // Parse assertion results for failures
        if (data.results) {
          for (const result of data.results) {
            if (result.assertionResults) {
              for (const assertion of result.assertionResults) {
                if (assertion.status === 'failed' && assertion.failureMessages.length > 0) {
                  failures.push({
                    testName: assertion.title,
                    filePath: assertion.location ?? 'unknown',
                    errorMessage: assertion.failureMessages.join('\n'),
                  });
                }
              }
            }
          }
        }
      } else {
        // Fallback: try to parse as general JSON
        try {
          const parsed = JSON.parse(stdout);
          totalTests = parsed.numTotalTests ?? 0;
          passedTests = parsed.numPassedTests ?? 0;
          failedTests = parsed.numFailedTests ?? 0;
          skippedTests = parsed.numPendingTests ?? 0;
        } catch {
          // If no JSON found, use exit code
          if (exitCode === 0) {
            totalTests = 0;
            passedTests = 0;
          }
        }
      }
    } catch {
      // If parsing fails entirely, use exit code as fallback
      if (exitCode === 0) {
        totalTests = 0;
        passedTests = 0;
      }
    }

    return {
      passed: failedTests === 0 && exitCode === 0,
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      duration,
      failures,
      coverageDelta: null,
    };
  }

  /**
   * 解析覆盖率报告
   */
  private parseCoverageReport(stdout: string, exitCode: number | null): CoverageReport {
    // Try to parse as general JSON first
    try {
      const parsed = JSON.parse(stdout);

      // Check for direct coverage summary (coverage-report v5+)
      if (typeof parsed.lines === 'number') {
        return {
          lines: parsed.lines ?? 0,
          statements: parsed.statements ?? 0,
          branches: parsed.branches ?? 0,
          functions: parsed.functions ?? 0,
          timestamp: new Date(),
        };
      }

      // Check for coverageMap (Jest JSON output)
      if (parsed.coverageMap) {
        return this.extractCoverageFromMap(parsed);
      }
    } catch {
      // Fall through
    }

    // Fallback: if test ran successfully but no coverage, return zeros
    if (exitCode === 0 || exitCode === null) {
      return {
        lines: 0,
        statements: 0,
        branches: 0,
        functions: 0,
        timestamp: new Date(),
      };
    }

    throw new Error(`Failed to parse coverage output`);
  }

  /**
   * 从 coverageMap 提取覆盖率（百分比）
   */
  private extractCoverageFromMap(data: { coverageMap?: Record<string, unknown> }): CoverageReport {
    const coverageMap = data.coverageMap ?? {};
    const files = Object.keys(coverageMap);

    let totalStatements = 0;
    let totalBranches = 0;
    let totalFunctions = 0;
    let totalLines = 0;
    let coveredStatements = 0;
    let coveredBranches = 0;
    let coveredFunctions = 0;
    let coveredLines = 0;

    for (const filePath of files) {
      const coverage = coverageMap[filePath] as {
        statementCount?: number;
        hitCount?: number;
        branchCount?: number;
        hitBranchCount?: number;
        fnCount?: number;
        hitFnCount?: number;
        lines?: Record<string, number>;
      };

      totalStatements += coverage.statementCount ?? 0;
      totalBranches += coverage.branchCount ?? 0;
      totalFunctions += coverage.fnCount ?? 0;
      coveredStatements += coverage.hitCount ?? 0;
      coveredBranches += coverage.hitBranchCount ?? 0;
      coveredFunctions += coverage.hitFnCount ?? 0;

      // Count lines
      const lines = coverage.lines ?? {};
      const lineCount = Object.keys(lines).length;
      let lineHits = 0;
      for (const hits of Object.values(lines)) {
        if ((hits as number) > 0) lineHits++;
      }
      totalLines += lineCount;
      coveredLines += lineHits;
    }

    return {
      lines: this.percentage(coveredLines, totalLines),
      statements: this.percentage(coveredStatements, totalStatements),
      branches: this.percentage(coveredBranches, totalBranches),
      functions: this.percentage(coveredFunctions, totalFunctions),
      timestamp: new Date(),
    };
  }

  /**
   * 计算百分比
   */
  private percentage(hit: number, total: number): number {
    if (total === 0) return 0;
    return this.round((hit / total) * 100);
  }

  /**
   * 保留两位小数
   */
  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
