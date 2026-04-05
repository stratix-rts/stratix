// ============================================
// DiscoveryEngine - 自主发现引擎
// Phase 4: P4-02 - 改进发现引擎
// ============================================

import { v4 as uuidv4 } from 'uuid';

import type {
  DiscoveryConfig,
  DiscoveryResult,
  DiscoveredProposal,
  ScanMetrics,
} from './types';

import type { ProjectScanner } from '../strategist/ProjectScanner';
import type { ScannerResult } from '../strategist/types';
import type { FitnessReport } from '../fitness/types';

export interface LessonEntry {
  lessonId: string;
  pattern: string;
  occurrenceCount: number;
  lastOccurredAt: Date;
  suggestedFix?: string;
}

export interface HistoryEntry {
  timestamp: Date;
  fitnessReport: FitnessReport;
  scanMetrics: ScanMetrics;
}

export interface ExternalSuggestion {
  id: string;
  source: string;
  category: string;
  target: string;
  description: string;
  impact: number;
  data: Record<string, unknown>;
}

export interface ILessonManager {
  getRecentLessons(limit: number): Promise<LessonEntry[]>;
  getRepeatPatterns(): Promise<LessonEntry[]>;
}

export interface IExternalSource {
  fetch(): Promise<ExternalSuggestion[]>;
}

export interface IHistoryStore {
  save(entry: HistoryEntry): Promise<void>;
  getLast(count: number): Promise<HistoryEntry[]>;
}

/**
 * DiscoveryEngine - 自主发现引擎
 *
 * 从多个来源发现改进点：
 * - scanner: 复用 ProjectScanner 获取覆盖率、类型错误、lint 问题
 * - fitness: 对比历史 Fitness 报告，识别退化趋势
 * - lesson: 从 LessonManager 获取重复错误，生成改进提案
 * - external: 从外部信息源提取的相关建议
 */
export class DiscoveryEngine {
  private config: DiscoveryConfig;
  private scanner: ProjectScanner;
  private lessonManager: ILessonManager | null = null;
  private externalSources: IExternalSource[] = [];
  private historyStore: IHistoryStore | null = null;
  private lastScanMetrics: ScanMetrics | null = null;
  private lastFitnessReport: FitnessReport | null = null;

  constructor(
    config: DiscoveryConfig,
    scanner: ProjectScanner,
    options?: {
      lessonManager?: ILessonManager;
      externalSources?: IExternalSource[];
      historyStore?: IHistoryStore;
    }
  ) {
    this.config = { ...config };
    this.scanner = scanner;
    this.lessonManager = options?.lessonManager ?? null;
    this.externalSources = options?.externalSources ?? [];
    this.historyStore = options?.historyStore ?? null;
  }

  /**
   * 执行一轮自主扫描，发现改进点
   */
  async discover(): Promise<DiscoveryResult> {
    const startTime = Date.now();

    // 1. 扫描项目获取指标
    const scanMetrics = await this.scanProject();

    // 2. 获取所有来源的提案
    const scannerProposals = await this.discoverFromScanner();
    const fitnessProposals = await this.discoverFromFitness();
    const lessonProposals = await this.discoverFromLessons();
    const externalProposals = await this.discoverFromExternal();

    // 合并所有提案
    let allProposals: DiscoveredProposal[] = [
      ...scannerProposals,
      ...fitnessProposals,
      ...lessonProposals,
      ...externalProposals,
    ];

    // 3. 按类别过滤
    allProposals = this.filterByCategory(allProposals, this.config.enabledCategories);

    // 4. 按影响力排序
    allProposals = this.prioritize(allProposals);

    // 5. 限制每轮最大提案数
    if (allProposals.length > this.config.maxProposalsPerCycle) {
      allProposals = allProposals.slice(0, this.config.maxProposalsPerCycle);
    }

    return {
      proposals: allProposals,
      scanMetrics,
      timestamp: new Date(),
    };
  }

  /**
   * 扫描项目（复用 ProjectScanner）
   */
  async scanProject(): Promise<ScanMetrics> {
    const startTime = Date.now();

    let scannerResult: ScannerResult;
    try {
      scannerResult = await this.scanner.scanAll();
    } catch (error) {
      // Return minimal metrics on failure
      return {
        filesScanned: 0,
        issuesFound: 0,
        coverageGaps: 0,
        complexityHotspots: 0,
        scanDuration: Date.now() - startTime,
      };
    }

    const { coverage, types, lint, sizes } = scannerResult.scanResult;

    // 计算覆盖率缺口
    const coveragePercent =
      coverage.totalStatements > 0
        ? (coverage.coveredStatements / coverage.totalStatements) * 100
        : 0;
    const coverageGaps = coveragePercent < this.config.minImprovementScore ? 1 : 0;

    // 计算复杂度热点（文件过大）
    const complexityHotspots = sizes.files.filter((f) => f.isLarge).length;

    // 统计问题数
    const issuesFound =
      types.errors.length +
      lint.errors.length +
      lint.warnings.length;

    // 统计扫描的文件数
    const filesScanned =
      coverage.uncoveredFiles.length +
      sizes.files.length;

    const metrics: ScanMetrics = {
      filesScanned,
      issuesFound,
      coverageGaps,
      complexityHotspots,
      scanDuration: Date.now() - startTime,
    };

    this.lastScanMetrics = metrics;

    // 保存历史记录
    if (this.historyStore && this.lastFitnessReport) {
      await this.historyStore.save({
        timestamp: new Date(),
        fitnessReport: this.lastFitnessReport,
        scanMetrics: metrics,
      });
    }

    return metrics;
  }

  /**
   * 从扫描结果分析改进缺口
   */
  analyzeGaps(metrics: ScanMetrics): DiscoveredProposal[] {
    const proposals: DiscoveredProposal[] = [];

    // 基于扫描指标生成提案
    if (metrics.coverageGaps > 0) {
      proposals.push(this.createProposal({
        category: 'test',
        target: 'project',
        description: '测试覆盖率不足，需要增加测试用例',
        estimatedImpact: 70,
        estimatedRisk: 20,
        estimatedEffort: 'medium',
        source: 'scanner',
        data: { coverageGaps: metrics.coverageGaps },
      }));
    }

    if (metrics.complexityHotspots > 0) {
      proposals.push(this.createProposal({
        category: 'architecture',
        target: 'project',
        description: `发现 ${metrics.complexityHotspots} 个过大的文件，需要重构拆分`,
        estimatedImpact: 50,
        estimatedRisk: 30,
        estimatedEffort: 'high',
        source: 'scanner',
        data: { hotspots: metrics.complexityHotspots },
      }));
    }

    if (metrics.issuesFound > 10) {
      proposals.push(this.createProposal({
        category: 'code',
        target: 'project',
        description: `发现 ${metrics.issuesFound} 个代码问题需要修复`,
        estimatedImpact: 60,
        estimatedRisk: 15,
        estimatedEffort: 'medium',
        source: 'scanner',
        data: { issueCount: metrics.issuesFound },
      }));
    }

    return proposals;
  }

  /**
   * 从 ProjectScanner 结果发现改进点
   */
  private async discoverFromScanner(): Promise<DiscoveredProposal[]> {
    const proposals: DiscoveredProposal[] = [];

    try {
      const result = await this.scanner.scanAll();
      const { coverage, types, lint, sizes } = result.scanResult;

      // 覆盖率分析
      const coveragePercent =
        coverage.totalStatements > 0
          ? (coverage.coveredStatements / coverage.totalStatements) * 100
          : 0;

      if (coveragePercent < 70) {
        proposals.push(this.createProposal({
          category: 'test',
          target: 'coverage',
          description: `测试覆盖率 ${coveragePercent.toFixed(1)}%，低于 70% 阈值`,
          estimatedImpact: Math.round((70 - coveragePercent) * 2),
          estimatedRisk: 20,
          estimatedEffort: 'medium',
          source: 'scanner',
          data: {
            coveragePercent,
            uncoveredFiles: coverage.uncoveredFiles,
          },
        }));
      }

      // 未覆盖文件
      for (const file of coverage.uncoveredFiles.slice(0, 5)) {
        proposals.push(this.createProposal({
          category: 'test',
          target: file,
          description: `文件 ${file} 完全未被测试覆盖`,
          estimatedImpact: 40,
          estimatedRisk: 10,
          estimatedEffort: 'low',
          source: 'scanner',
          data: { file },
        }));
      }

      // 类型错误
      if (types.errors.length > 0) {
        const grouped = this.groupErrorsByFile(types.errors);
        for (const [file, errors] of Object.entries(grouped).slice(0, 3)) {
          proposals.push(this.createProposal({
            category: 'code',
            target: file,
            description: `文件 ${file} 有 ${errors.length} 个类型错误`,
            estimatedImpact: 60,
            estimatedRisk: 15,
            estimatedEffort: 'medium',
            source: 'scanner',
            data: { file, errorCount: errors.length, errors: errors.slice(0, 3) },
          }));
        }
      }

      // Lint 错误
      if (lint.errors.length > 0) {
        proposals.push(this.createProposal({
          category: 'code',
          target: 'lint',
          description: `项目有 ${lint.errors.length} 个 lint 错误`,
          estimatedImpact: 50,
          estimatedRisk: 10,
          estimatedEffort: 'low',
          source: 'scanner',
          data: { errorCount: lint.errors.length },
        }));
      }

      // 大文件
      const largeFiles = sizes.files.filter((f) => f.isLarge);
      for (const file of largeFiles.slice(0, 3)) {
        proposals.push(this.createProposal({
          category: 'architecture',
          target: file.path,
          description: `文件 ${file.path} 有 ${file.lines} 行，超过了 ${sizes.threshold} 行阈值`,
          estimatedImpact: 40,
          estimatedRisk: 30,
          estimatedEffort: 'high',
          source: 'scanner',
          data: { file: file.path, lines: file.lines },
        }));
      }
    } catch {
      // Silently return empty on error
    }

    return proposals;
  }

  /**
   * 从历史 Fitness 报告发现退化趋势
   */
  private async discoverFromFitness(): Promise<DiscoveredProposal[]> {
    const proposals: DiscoveredProposal[] = [];

    if (!this.historyStore) {
      return proposals;
    }

    try {
      const history = await this.historyStore.getLast(5);

      if (history.length < 2) {
        return proposals;
      }

      // 分析 fitness 分数趋势
      const scores = history.map((h) => h.fitnessReport.scores.overall);
      const latest = scores[scores.length - 1];
      const previous = scores[scores.length - 2];

      if (latest < previous && previous - latest > 5) {
        proposals.push(this.createProposal({
          category: 'code',
          target: 'fitness',
          description: `Fitness 分数从 ${previous} 下降到 ${latest}，检测到退化趋势`,
          estimatedImpact: 80,
          estimatedRisk: 40,
          estimatedEffort: 'medium',
          source: 'fitness',
          data: { previous, latest, delta: latest - previous },
        }));
      }

      // 分析测试覆盖率趋势
      const coverageScores = history.map((h) => h.fitnessReport.metrics.testCoverage);
      const latestCoverage = coverageScores[coverageScores.length - 1];
      const previousCoverage = coverageScores[coverageScores.length - 2];

      if (latestCoverage < previousCoverage && previousCoverage - latestCoverage > 2) {
        proposals.push(this.createProposal({
          category: 'test',
          target: 'coverage',
          description: `测试覆盖率从 ${previousCoverage}% 下降到 ${latestCoverage}%`,
          estimatedImpact: 75,
          estimatedRisk: 25,
          estimatedEffort: 'medium',
          source: 'fitness',
          data: { previous: previousCoverage, latest: latestCoverage },
        }));
      }
    } catch {
      // Silently return empty on error
    }

    return proposals;
  }

  /**
   * 从 LessonManager 获取重复错误，生成改进提案
   */
  private async discoverFromLessons(): Promise<DiscoveredProposal[]> {
    const proposals: DiscoveredProposal[] = [];

    if (!this.lessonManager) {
      return proposals;
    }

    try {
      const repeatPatterns = await this.lessonManager.getRepeatPatterns();

      for (const lesson of repeatPatterns.slice(0, 5)) {
        if (lesson.occurrenceCount < 2) continue;

        proposals.push(this.createProposal({
          category: 'code',
          target: lesson.pattern,
          description: `重复错误 "${lesson.pattern}" 已出现 ${lesson.occurrenceCount} 次: ${lesson.suggestedFix ?? '建议检查并修复'}`,
          estimatedImpact: 65,
          estimatedRisk: 20,
          estimatedEffort: 'low',
          source: 'lesson',
          data: {
            lessonId: lesson.lessonId,
            pattern: lesson.pattern,
            occurrenceCount: lesson.occurrenceCount,
            suggestedFix: lesson.suggestedFix,
          },
        }));
      }
    } catch {
      // Silently return empty on error
    }

    return proposals;
  }

  /**
   * 从外部信息源提取改进建议
   */
  private async discoverFromExternal(): Promise<DiscoveredProposal[]> {
    const proposals: DiscoveredProposal[] = [];

    for (const source of this.externalSources) {
      try {
        const suggestions = await source.fetch();

        for (const suggestion of suggestions) {
          proposals.push(this.createProposal({
            category: suggestion.category,
            target: suggestion.target,
            description: suggestion.description,
            estimatedImpact: suggestion.impact,
            estimatedRisk: 30,
            estimatedEffort: 'medium',
            source: 'external',
            data: suggestion.data,
          }));
        }
      } catch {
        // Continue with next source
      }
    }

    return proposals;
  }

  /**
   * 按影响力排序（降序）
   */
  prioritize(proposals: DiscoveredProposal[]): DiscoveredProposal[] {
    return [...proposals].sort((a, b) => {
      // 首先按 estimatedImpact 降序
      if (b.estimatedImpact !== a.estimatedImpact) {
        return b.estimatedImpact - a.estimatedImpact;
      }
      // 然后按 estimatedRisk 升序（风险低优先）
      if (a.estimatedRisk !== b.estimatedRisk) {
        return a.estimatedRisk - b.estimatedRisk;
      }
      // 最后按 estimatedEffort 升序（努力低优先）
      const effortOrder = { low: 0, medium: 1, high: 2 };
      return effortOrder[a.estimatedEffort] - effortOrder[b.estimatedEffort];
    });
  }

  /**
   * 按类别过滤
   */
  filterByCategory(proposals: DiscoveredProposal[], categories: string[]): DiscoveredProposal[] {
    if (!categories || categories.length === 0) {
      return proposals;
    }
    return proposals.filter((p) => categories.includes(p.category));
  }

  /**
   * 设置 LessonManager
   */
  setLessonManager(manager: ILessonManager): void {
    this.lessonManager = manager;
  }

  /**
   * 添加外部源
   */
  addExternalSource(source: IExternalSource): void {
    this.externalSources.push(source);
  }

  /**
   * 设置历史存储
   */
  setHistoryStore(store: IHistoryStore): void {
    this.historyStore = store;
  }

  /**
   * 获取配置
   */
  getConfig(): DiscoveryConfig {
    return { ...this.config };
  }

  /**
   * 获取上次扫描指标
   */
  getLastScanMetrics(): ScanMetrics | null {
    return this.lastScanMetrics;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private createProposal(params: {
    category: string;
    target: string;
    description: string;
    estimatedImpact: number;
    estimatedRisk: number;
    estimatedEffort: 'low' | 'medium' | 'high';
    source: 'scanner' | 'fitness' | 'external' | 'lesson';
    data: Record<string, unknown>;
  }): DiscoveredProposal {
    return {
      id: uuidv4(),
      ...params,
    };
  }

  private groupErrorsByFile(
    errors: Array<{ file: string; line: number; column: number; message: string; code: number }>
  ): Record<string, typeof errors> {
    const grouped: Record<string, typeof errors> = {};
    for (const error of errors) {
      if (!grouped[error.file]) {
        grouped[error.file] = [];
      }
      grouped[error.file].push(error);
    }
    return grouped;
  }
}
