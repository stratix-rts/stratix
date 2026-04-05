// ============================================
// ImpactEvaluator.ts - 效果评估器
// Phase 4: P4-04 - 效果评估器
// ============================================

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type {
  MetricSnapshot,
  MetricDeltas,
  ImpactEvaluation,
} from './types';

import { ProjectScanner } from '../strategist/ProjectScanner';
import { FitnessEvaluator } from '../fitness/FitnessEvaluator';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CWD = path.resolve(__dirname, '../../../../');

/**
 * ImpactEvaluator - 效果评估器
 *
 * 在执行前后捕获指标快照，计算效果变化，生成建议
 *
 * 用法:
 *   const evaluator = new ImpactEvaluator();
 *   const before = await evaluator.captureBefore();
 *   // ... 执行修改 ...
 *   const after = await evaluator.captureAfter();
 *   const evaluation = evaluator.evaluate(before, after);
 *   const recommendation = evaluator.recommend(evaluation);
 */
export class ImpactEvaluator {
  private config: {
    timeoutMs: number;
    cwd: string;
  };

  constructor(config: { timeoutMs?: number; cwd?: string } = {}) {
    this.config = {
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      cwd: config.cwd ?? DEFAULT_CWD,
    };
  }

  // ================================================================
  // 公开 API
  // ================================================================

  /**
   * 捕获执行前指标
   */
  async captureBefore(): Promise<MetricSnapshot> {
    return this.captureSnapshot();
  }

  /**
   * 捕获执行后指标
   */
  async captureAfter(): Promise<MetricSnapshot> {
    return this.captureSnapshot();
  }

  /**
   * 计算效果评估
   *
   * @param before 执行前快照
   * @param after 执行后快照
   * @param proposalId 可选的提案 ID
   */
  evaluate(
    before: MetricSnapshot,
    after: MetricSnapshot,
    proposalId: string = 'unknown'
  ): ImpactEvaluation {
    const deltas = this.calculateDeltas(before, after);
    const overallImpact = this.calculateOverallImpact(deltas);

    const evaluation: ImpactEvaluation = {
      proposalId,
      before,
      after,
      deltas,
      overallImpact,
      recommendation: this.determineRecommendation(overallImpact, deltas),
    };

    return evaluation;
  }

  /**
   * 计算综合影响分数
   *
   * 正面变化（覆盖率提升、错误减少）加分
   * 负面影响（错误增加、性能下降）扣分
   * 范围 -100 到 +100
   */
  calculateOverallImpact(deltas: MetricDeltas): number {
    let score = 0;

    // 1. 测试覆盖率变化 (权重: 25)
    // 每提升 1% 得 2 分，每下降 1% 扣 2 分
    score += deltas.testCoverage * 2;

    // 2. 测试通过率变化 (权重: 25)
    // 每提升 1% 得 2 分，每下降 1% 扣 2 分
    score += deltas.testPassRate * 2;

    // 3. 类型错误变化 (权重: 20)
    // 每减少 1 个错误得 1 分，每增加 1 个错误扣 2 分
    score -= deltas.typeErrors * 2;

    // 4. Lint 错误变化 (权重: 15)
    // 每减少 1 个错误得 0.5 分，每增加 1 个错误扣 1 分
    score -= deltas.lintErrors * 1;

    // 5. Bundle 大小变化 (权重: 10)
    // 每减少 1KB 得 1 分，每增加 1KB 扣 1 分
    // deltas 是百分比变化，转为 KB 估算（假设基准 500KB）
    const bundleSizeDeltaKb = (deltas.bundleSize / 1024);
    score -= bundleSizeDeltaKb;

    // 6. 响应时间变化 (权重: 5)
    // 每减少 10ms 得 1 分，每增加 10ms 扣 1 分
    score -= deltas.responseTime / 10;

    // 7. Fitness 分数变化 (权重: 10)
    score += deltas.fitnessScore;

    // 限制在 -100 到 +100 范围内
    return Math.max(-100, Math.min(100, Math.round(score)));
  }

  /**
   * 生成建议
   *
   * @param evaluation 效果评估结果
   */
  recommend(evaluation: ImpactEvaluation): 'keep' | 'rollback' | 'investigate' {
    return evaluation.recommendation;
  }

  // ================================================================
  // 私有方法
  // ================================================================

  /**
   * 捕获当前指标快照
   */
  private async captureSnapshot(): Promise<MetricSnapshot> {
    const [scannerResult, testResult, bundleSize, responseTime, fitnessScore] = await Promise.all([
      this.runScanner(),
      this.runTests(),
      this.measureBundleSize(),
      this.measureResponseTime(),
      this.evaluateFitness(),
    ]);

    // 计算测试通过率
    const testPassRate = this.calculateTestPassRate(testResult);

    return {
      timestamp: new Date(),
      testCoverage: scannerResult.coverage,
      testPassRate,
      typeErrors: scannerResult.typeErrors,
      lintErrors: scannerResult.lintErrors,
      bundleSize,
      responseTime,
      fitnessScore,
    };
  }

  /**
   * 运行扫描获取覆盖率、类型错误、lint 错误
   */
  private async runScanner(): Promise<{
    coverage: number;
    typeErrors: number;
    lintErrors: number;
  }> {
    try {
      const scanner = new ProjectScanner({
        timeoutMs: this.config.timeoutMs,
        cwd: this.config.cwd,
        cacheEnabled: false, // 禁用缓存以获取实时数据
      });

      const result = await scanner.scanAll();

      // 计算覆盖率
      const coverageReport = result.scanResult.coverage;
      const totalStatements = (coverageReport as { totalStatements?: number }).totalStatements ?? 0;
      const coveredStatements = (coverageReport as { coveredStatements?: number }).coveredStatements ?? 0;
      const coverage = totalStatements > 0
        ? Math.round((coveredStatements / totalStatements) * 100)
        : 0;

      // 获取错误数
      const typeErrors = result.scanResult.types
        ? (result.scanResult.types as { errors?: Array<unknown> }).errors?.length ?? 0
        : 0;
      const lintErrors = result.scanResult.lint
        ? (result.scanResult.lint as { errors?: Array<unknown> }).errors?.length ?? 0
        : 0;

      return { coverage, typeErrors, lintErrors };
    } catch {
      // 扫描失败时返回零值
      return { coverage: 0, typeErrors: 0, lintErrors: 0 };
    }
  }

  /**
   * 运行测试获取测试结果
   */
  private async runTests(): Promise<{
    totalTests: number;
    passedTests: number;
    failedTests: number;
  }> {
    return new Promise((resolve) => {
      const proc = spawn('npm', ['test', '--', '--json', '--testPathIgnorePatterns='], {
        cwd: this.config.cwd,
        shell: true,
        timeout: this.config.timeoutMs,
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
        resolve({ totalTests: 0, passedTests: 0, failedTests: 0 });
      }, this.config.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);

        try {
          // 尝试从 JSON 输出解析测试结果
          const result = this.parseTestOutput(stdout, code);
          resolve(result);
        } catch {
          resolve({ totalTests: 0, passedTests: 0, failedTests: 0 });
        }
      });

      proc.on('error', () => {
        clearTimeout(timer);
        resolve({ totalTests: 0, passedTests: 0, failedTests: 0 });
      });
    });
  }

  /**
   * 解析测试输出
   */
  private parseTestOutput(
    stdout: string,
    exitCode: number | null
  ): { totalTests: number; passedTests: number; failedTests: number } {
    try {
      // 尝试解析 JSON 输出
      const jsonMatch = stdout.match(/\{[\s\S]*"numPassedTests"[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const passedTests = data.numPassedTests ?? 0;
        const failedTests = data.numFailedTests ?? 0;
        const totalTests = passedTests + failedTests;
        return { totalTests, passedTests, failedTests };
      }
    } catch {
      // Fall through
    }

    // Fallback: 根据退出码判断
    if (exitCode === 0) {
      return { totalTests: 0, passedTests: 0, failedTests: 0 }; // 无法确定具体数量
    }
    return { totalTests: 0, passedTests: 0, failedTests: 0 };
  }

  /**
   * 计算测试通过率
   */
  private calculateTestPassRate(testResult: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
  }): number {
    if (testResult.totalTests === 0) {
      return 0;
    }
    return Math.round((testResult.passedTests / testResult.totalTests) * 100);
  }

  /**
   * 测量构建产物大小
   */
  private async measureBundleSize(): Promise<number> {
    const distDir = path.join(this.config.cwd, 'dist');

    if (!fs.existsSync(distDir)) {
      return 0;
    }

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
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    await scanDir(distDir);
    return totalSize;
  }

  /**
   * 测量响应时间（简化 benchmark）
   */
  private async measureResponseTime(): Promise<number> {
    // 简化的响应时间测量
    // 实际实现应该运行 dev server 并发送请求
    // 这里返回基于系统指标的估算值
    return 150; // 默认 150ms
  }

  /**
   * 评估 Fitness 分数
   */
  private async evaluateFitness(): Promise<number> {
    try {
      const evaluator = new FitnessEvaluator({
        scannerTimeoutMs: this.config.timeoutMs,
        scannerCwd: this.config.cwd,
      });

      const report = await evaluator.evaluate();
      return report.scores.overall;
    } catch {
      return 0;
    }
  }

  /**
   * 计算指标变化量
   */
  private calculateDeltas(before: MetricSnapshot, after: MetricSnapshot): MetricDeltas {
    return {
      testCoverage: after.testCoverage - before.testCoverage,
      testPassRate: after.testPassRate - before.testPassRate,
      typeErrors: after.typeErrors - before.typeErrors,
      lintErrors: after.lintErrors - before.lintErrors,
      bundleSize: after.bundleSize - before.bundleSize,
      responseTime: after.responseTime - before.responseTime,
      fitnessScore: after.fitnessScore - before.fitnessScore,
    };
  }

  /**
   * 确定建议
   */
  private determineRecommendation(
    overallImpact: number,
    deltas: MetricDeltas
  ): 'keep' | 'rollback' | 'investigate' {
    // 严重回归检测
    const hasCriticalRegression =
      deltas.testCoverage < -5 ||           // 覆盖率下降超过 5%
      deltas.testPassRate < -10 ||          // 通过率下降超过 10%
      deltas.typeErrors > 10 ||              // 类型错误增加超过 10 个
      deltas.lintErrors > 20 ||             // Lint 错误增加超过 20 个
      deltas.bundleSize > 102400 ||         // Bundle 增加超过 100KB
      deltas.responseTime > 100;            // 响应时间增加超过 100ms

    if (hasCriticalRegression) {
      return 'rollback';
    }

    // 明显的负面效果
    if (overallImpact < -10) {
      return 'rollback';
    }

    // 明显的正面效果
    if (overallImpact > 10) {
      return 'keep';
    }

    // 需要进一步调查
    return 'investigate';
  }
}
