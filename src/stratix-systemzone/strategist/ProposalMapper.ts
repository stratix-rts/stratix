// ============================================
// ProposalMapper.ts - 扫描结果 → 提案映射
// Phase 1: Step 3 - ProjectScanner 确定性扫描
// ============================================

import type {
  CoverageReport,
  TypeCheckResult,
  LintResult,
  FileSizeReport,
  Proposal,
  ProposalType,
} from '../types';

import type { ProposalMapperConfig, MappingContext } from './types';

const DEFAULT_COVERAGE_THRESHOLD = 50; // 50%
const DEFAULT_FILE_SIZE_THRESHOLD = 500; // 500 lines
const DEFAULT_LINT_ERROR_WEIGHT = 2;
const DEFAULT_LINT_WARNING_WEIGHT = 1;

/**
 * ProposalMapper - 将扫描结果确定性映射为提案
 *
 * 规则：
 * - 覆盖率 < 阈值 → improve_test 提案
 * - 类型错误 → improve_code 提案
 * - lint 错误/警告 → improve_code 提案
 * - 文件 >500 行 → improve_architecture 提案
 */
export class ProposalMapper {
  private config: Required<ProposalMapperConfig>;

  constructor(config: ProposalMapperConfig = {}) {
    this.config = {
      coverageThreshold: config.coverageThreshold ?? DEFAULT_COVERAGE_THRESHOLD,
      fileSizeThreshold: config.fileSizeThreshold ?? DEFAULT_FILE_SIZE_THRESHOLD,
      lintErrorWeight: config.lintErrorWeight ?? DEFAULT_LINT_ERROR_WEIGHT,
      lintWarningWeight: config.lintWarningWeight ?? DEFAULT_LINT_WARNING_WEIGHT,
    };
  }

  /**
   * 将完整扫描结果映射为提案数组
   */
  mapFromScanResult(context: MappingContext): Proposal[] {
    const proposals: Proposal[] = [];
    const { scanResult } = context;

    // 1. 从覆盖率生成提案
    proposals.push(...this.fromCoverage(scanResult.coverage, context));

    // 2. 从类型错误生成提案
    proposals.push(...this.fromTypeErrors(scanResult.types, context));

    // 3. 从 lint 问题生成提案
    proposals.push(...this.fromLintIssues(scanResult.lint, context));

    // 4. 从大文件生成提案
    proposals.push(...this.fromLargeFiles(scanResult.sizes, context));

    return proposals;
  }

  /**
   * 从覆盖率报告生成提案
   */
  fromCoverage(report: CoverageReport, context?: MappingContext): Proposal[] {
    const proposals: Proposal[] = [];
    const threshold = this.config.coverageThreshold;

    // 计算总覆盖率
    const statementCoverage =
      report.totalStatements > 0
        ? (report.coveredStatements / report.totalStatements) * 100
        : 0;

    // 如果总体覆盖率低于阈值，生成一条总体提案
    if (statementCoverage < threshold) {
      proposals.push(this.createProposal({
        type: 'improve_test',
        title: `测试覆盖率不足 (${statementCoverage.toFixed(1)}% < ${threshold}%)`,
        description: `当前语句覆盖率为 ${statementCoverage.toFixed(1)}%，低于 ${threshold}% 阈值。需要增加测试用例以提高覆盖率。`,
        target: {},
        selection: {
          confidence: 0.95,
          cost: 7,
          benefit: 8,
          risk: 'low',
        },
        context,
      }));
    }

    // 为未覆盖的文件生成单独提案
    for (const file of report.uncoveredFiles) {
      proposals.push(this.createProposal({
        type: 'improve_test',
        title: `文件完全未覆盖: ${this.shortenPath(file)}`,
        description: `该文件的测试覆盖率为 0%。需要为以下文件添加测试：${file}`,
        target: { file },
        selection: {
          confidence: 0.9,
          cost: 5,
          benefit: 7,
          risk: 'low',
        },
        context,
      }));
    }

    return proposals;
  }

  /**
   * 从类型错误生成提案
   */
  fromTypeErrors(result: TypeCheckResult, context?: MappingContext): Proposal[] {
    const proposals: Proposal[] = [];

    if (result.errors.length === 0) {
      return proposals;
    }

    // 按文件分组类型错误
    const errorsByFile = new Map<string, typeof result.errors>();
    for (const error of result.errors) {
      const existing = errorsByFile.get(error.file) ?? [];
      existing.push(error);
      errorsByFile.set(error.file, existing);
    }

    // 为每个有错误的文件生成提案
    for (const [file, errors] of errorsByFile) {
      // 错误太多时合并为一条提案
      if (errors.length > 5) {
        const errorMessages = errors.slice(0, 3).map((e) => e.message).join('; ');
        proposals.push(this.createProposal({
          type: 'improve_code',
          title: `${errors.length} 个类型错误: ${this.shortenPath(file)}`,
          description: `文件 ${file} 存在 ${errors.length} 个类型错误，包括：${errorMessages}。建议修复类型定义或添加类型注解。`,
          target: { file },
          selection: {
            confidence: 0.95,
            cost: 6,
            benefit: 8,
            risk: 'medium',
          },
          context,
        }));
      } else {
        for (const error of errors) {
          proposals.push(this.createProposal({
            type: 'improve_code',
            title: `类型错误: ${this.shortenPath(error.file)}:${error.line}`,
            description: `TS${error.code}: ${error.message} (行 ${error.line}, 列 ${error.column})`,
            target: { file: error.file },
            selection: {
              confidence: 0.95,
              cost: 4,
              benefit: 7,
              risk: 'medium',
            },
            context,
          }));
        }
      }
    }

    return proposals;
  }

  /**
   * 从 lint 问题生成提案
   */
  fromLintIssues(result: LintResult, context?: MappingContext): Proposal[] {
    const proposals: Proposal[] = [];

    if (result.errors.length === 0 && result.warnings.length === 0) {
      return proposals;
    }

    // 按文件分组
    const issuesByFile = new Map<string, { errors: typeof result.errors; warnings: typeof result.warnings }>();
    for (const issue of result.errors) {
      const existing = issuesByFile.get(issue.file) ?? { errors: [], warnings: [] };
      existing.errors.push(issue);
      issuesByFile.set(issue.file, existing);
    }
    for (const issue of result.warnings) {
      const existing = issuesByFile.get(issue.file) ?? { errors: [], warnings: [] };
      existing.warnings.push(issue);
      issuesByFile.set(issue.file, existing);
    }

    // 为每个有问题的文件生成提案
    for (const [file, { errors, warnings }] of issuesByFile) {
      const totalIssues = errors.length + warnings.length;

      if (totalIssues > 10) {
        // 问题太多时生成一条合并提案
        proposals.push(this.createProposal({
          type: 'improve_code',
          title: `代码质量问题: ${this.shortenPath(file)} (${totalIssues} issues)`,
          description: `文件 ${file} 存在 ${errors.length} 个错误和 ${warnings.length} 个警告。主要问题规则包括：${errors.slice(0, 3).map((e) => e.rule).join(', ')}。建议运行 eslint --fix 或手动修复。`,
          target: { file },
          selection: {
            confidence: 0.85,
            cost: 5,
            benefit: 6,
            risk: 'low',
          },
          context,
        }));
      } else {
        // 问题较少时逐条生成提案
        for (const issue of [...errors, ...warnings]) {
          proposals.push(this.createProposal({
            type: 'improve_code',
            title: `Lint ${issue.severity}: ${issue.rule} in ${this.shortenPath(issue.file)}`,
            description: `[${issue.severity}] ${issue.message} (行 ${issue.line})`,
            target: { file: issue.file },
            selection: {
              confidence: 0.8,
              cost: 2,
              benefit: 4,
              risk: 'low',
            },
            context,
          }));
        }
      }
    }

    return proposals;
  }

  /**
   * 从大文件生成架构提案
   */
  fromLargeFiles(report: FileSizeReport, context?: MappingContext): Proposal[] {
    const proposals: Proposal[] = [];
    const threshold = report.threshold;

    const largeFiles = report.files.filter((f) => f.isLarge);

    for (const file of largeFiles) {
      proposals.push(this.createProposal({
        type: 'improve_architecture',
        title: `文件过大 (${file.lines} 行): ${this.shortenPath(file.path)}`,
        description: `文件 ${file.path} 有 ${file.lines} 行代码，超过了 ${threshold} 行的阈值。建议考虑拆分该文件，将相关功能提取到独立模块。`,
        target: { file: file.path },
        selection: {
          confidence: 0.75,
          cost: 6,
          benefit: 7,
          risk: 'medium',
        },
        context,
      }));
    }

    return proposals;
  }

  /**
   * 创建提案
   */
  private createProposal(params: {
    type: ProposalType;
    title: string;
    description: string;
    target: { file?: string; component?: string; zone?: string };
    selection: { confidence: number; cost: number; benefit: number; risk: 'low' | 'medium' | 'high' };
    context?: MappingContext;
  }): Proposal {
    const id = `proposal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    return {
      id,
      timestamp: params.context?.timestamp ?? new Date(),
      type: params.type,
      title: params.title,
      description: params.description,
      target: params.target,
      selection: params.selection,
      status: 'pending',
    };
  }

  /**
   * 缩短文件路径用于显示
   */
  private shortenPath(filePath: string): string {
    if (!filePath) return filePath;
    // 移除项目根路径前缀
    const srcIndex = filePath.indexOf('/src/');
    if (srcIndex !== -1) {
      return filePath.slice(srcIndex + 1);
    }
    // 移除太长的前缀
    if (filePath.length > 50) {
      const parts = filePath.split('/');
      if (parts.length > 3) {
        return '.../' + parts.slice(-3).join('/');
      }
    }
    return filePath;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<ProposalMapperConfig> {
    return { ...this.config };
  }
}
