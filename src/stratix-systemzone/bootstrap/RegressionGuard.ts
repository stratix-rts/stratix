// ============================================
// RegressionGuard - 退化保护
// Phase 4: 效果评估 + 退化检测
// ============================================

import {
  MetricSnapshot,
  Regression,
  RegressionCheck,
  RegressionGuardConfig,
  RegressionSeverity,
} from './types';

export class RegressionGuard {
  constructor(private config: RegressionGuardConfig) {}

  /**
   * 执行完整退化检查
   * @param proposalId 提案 ID
   * @param before 之前指标快照
   * @param after 之后指标快照
   */
  check(proposalId: string, before: MetricSnapshot, after: MetricSnapshot): RegressionCheck {
    const regressions: Regression[] = [];

    // 覆盖率下降检查（下降为退化）
    regressions.push(
      this.checkSingle(
        'testCoverage',
        before.testCoverage,
        after.testCoverage,
        this.config.maxCoverageDrop,
        true // 下降为退化
      )
    );

    // 通过率下降检查（下降为退化）
    regressions.push(
      this.checkSingle(
        'testPassRate',
        before.testPassRate,
        after.testPassRate,
        this.config.maxTestPassRateDrop,
        true // 下降为退化
      )
    );

    // 类型错误增加检查（增加为退化）
    regressions.push(
      this.checkSingle(
        'typeErrors',
        before.typeErrors,
        after.typeErrors,
        this.config.maxTypeErrorIncrease,
        false // 增加为退化
      )
    );

    // lint 错误增加检查（增加为退化）
    regressions.push(
      this.checkSingle(
        'lintErrors',
        before.lintErrors,
        after.lintErrors,
        this.config.maxLintErrorIncrease,
        false // 增加为退化
      )
    );

    // 包体积增加检查（增加为退化，threshold 为百分比）
    regressions.push(
      this.checkPercentage(
        'bundleSize',
        before.bundleSize,
        after.bundleSize,
        this.config.maxBundleSizeIncrease
      )
    );

    // 响应时间增加检查（增加为退化，threshold 为百分比）
    regressions.push(
      this.checkPercentage(
        'responseTime',
        before.responseTime,
        after.responseTime,
        this.config.maxResponseTimeIncrease
      )
    );

    const severity = this.getSeverity(regressions);
    const canProceed = this.canProceedInternal(regressions, severity);

    return {
      proposalId,
      regressions,
      severity,
      canProceed,
    };
  }

  /**
   * 单指标退化检查
   * @param metric 指标名称
   * @param before 之前值
   * @param after 之后值
   * @param threshold 阈值（绝对值）
   * @param dropIsRegression true 表示下降为退化（如覆盖率），false 表示增加为退化（如错误数）
   */
  checkSingle(
    metric: string,
    before: number,
    after: number,
    threshold: number,
    dropIsRegression: boolean = true
  ): Regression {
    const delta = after - before;
    const absDelta = Math.abs(delta);
    let isRegression: boolean;

    if (dropIsRegression) {
      // 下降为退化（如覆盖率、通过率）
      isRegression = delta < 0 && absDelta > threshold;
    } else {
      // 增加为退化（如错误数）
      isRegression = delta > 0 && absDelta > threshold;
    }

    return {
      metric,
      beforeValue: before,
      afterValue: after,
      delta,
      threshold,
      isRegression,
    };
  }

  /**
   * 百分比指标的退化检查
   * @param metric 指标名称
   * @param before 之前值
   * @param after 之后值
   * @param maxPercentIncrease 最大允许增加百分比
   */
  checkPercentage(
    metric: string,
    before: number,
    after: number,
    maxPercentIncrease: number
  ): Regression {
    let delta: number;
    let percentChange: number;
    let isRegression: boolean;

    if (before === 0) {
      // 避免除以零
      delta = after;
      percentChange = after > 0 ? 100 : 0;
    } else {
      delta = after - before;
      percentChange = (delta / before) * 100;
    }

    // 增加为退化
    isRegression = percentChange > maxPercentIncrease;

    return {
      metric,
      beforeValue: before,
      afterValue: after,
      delta,
      threshold: maxPercentIncrease,
      isRegression,
    };
  }

  /**
   * 从检查结果中获取所有退化项
   */
  getRegressions(check: RegressionCheck): Regression[] {
    return check.regressions.filter((r) => r.isRegression);
  }

  /**
   * 计算退化严重程度
   * - none: 无退化
   * - minor: 1-2 个轻微退化
   * - major: 多个退化或 1 个严重退化
   * - critical: 核心指标（通过率、覆盖率）显著退化
   */
  getSeverity(regressions: Regression[]): RegressionSeverity {
    const actualRegressions = regressions.filter((r) => r.isRegression);

    if (actualRegressions.length === 0) {
      return 'none';
    }

    // 检查是否有核心指标显著退化（覆盖率或通过率下降 > 5% 或错误数增加 > 10）
    const coreMetrics = ['testCoverage', 'testPassRate', 'typeErrors'];
    const hasCoreRegression = actualRegressions.some((r) => {
      if (coreMetrics.includes(r.metric)) {
        if (r.metric === 'typeErrors') {
          return r.delta > 10;
        }
        return Math.abs(r.delta) > 5;
      }
      return false;
    });

    if (hasCoreRegression) {
      return 'critical';
    }

    // major: 多个退化或严重退化
    if (actualRegressions.length >= 3) {
      return 'major';
    }

    // 检查是否有严重退化（delta 超过阈值 2 倍以上）
    const hasSevereRegression = actualRegressions.some((r) => {
      return Math.abs(r.delta) > r.threshold * 2;
    });

    if (hasSevereRegression) {
      return 'major';
    }

    // minor: 1-2 个轻微退化
    return 'minor';
  }

  /**
   * 判断是否可以继续（基于退化检查结果）
   */
  canProceed(check: RegressionCheck): boolean {
    return this.canProceedInternal(check.regressions, check.severity);
  }

  /**
   * 内部判断是否可以继续
   */
  private canProceedInternal(
    regressions: Regression[],
    severity: RegressionSeverity
  ): boolean {
    const actualRegressions = regressions.filter((r) => r.isRegression);

    // 严重程度为 critical 时，如果配置要求阻止，则不能继续
    if (severity === 'critical' && this.config.blockOnCriticalRegression) {
      return false;
    }

    // 任何 major 退化都不能继续
    if (severity === 'major') {
      return false;
    }

    // minor 和 none 可以继续
    return true;
  }
}
