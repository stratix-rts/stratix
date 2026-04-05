/**
 * ProposalMapper.test.ts - 提案映射测试
 * Phase 1: Step 3 - ProposalMapper 确定性映射测试
 */

import { ProposalMapper } from '../ProposalMapper';
import type {
  CoverageReport,
  TypeCheckResult,
  LintResult,
  FileSizeReport,
  ScanResult,
} from '../../types';
import type { ProposalMapperConfig, MappingContext } from '../types';

describe('ProposalMapper', () => {
  let mapper: ProposalMapper;
  let defaultContext: MappingContext;

  const createContext = (overrides?: Partial<MappingContext>): MappingContext => ({
    timestamp: new Date(),
    projectRoot: '/project',
    scanResult: createEmptyScanResult(),
    ...overrides,
  });

  const createEmptyScanResult = (): ScanResult => ({
    timestamp: new Date(),
    coverage: createEmptyCoverageReport(),
    types: createEmptyTypeCheckResult(),
    lint: createEmptyLintResult(),
    sizes: createEmptyFileSizeReport(),
  });

  const createEmptyCoverageReport = (): CoverageReport => ({
    totalStatements: 0,
    totalBranches: 0,
    totalFunctions: 0,
    totalLines: 0,
    coveredStatements: 0,
    coveredBranches: 0,
    coveredFunctions: 0,
    coveredLines: 0,
    uncoveredFiles: [],
    threshold: 50,
  });

  const createEmptyTypeCheckResult = (): TypeCheckResult => ({
    errors: [],
    warnings: [],
    success: true,
  });

  const createEmptyLintResult = (): LintResult => ({
    errors: [],
    warnings: [],
    success: true,
    fatalErrorCount: 0,
  });

  const createEmptyFileSizeReport = (): FileSizeReport => ({
    files: [],
    threshold: 500,
  });

  beforeEach(() => {
    mapper = new ProposalMapper();
    defaultContext = createContext();
  });

  describe('constructor', () => {
    it('should use default thresholds', () => {
      const instance = new ProposalMapper();
      const config = instance.getConfig();
      expect(config.coverageThreshold).toBe(50);
      expect(config.fileSizeThreshold).toBe(500);
      expect(config.lintErrorWeight).toBe(2);
      expect(config.lintWarningWeight).toBe(1);
    });

    it('should accept custom config', () => {
      const config: ProposalMapperConfig = {
        coverageThreshold: 80,
        fileSizeThreshold: 300,
        lintErrorWeight: 3,
        lintWarningWeight: 2,
      };
      const instance = new ProposalMapper(config);
      const result = instance.getConfig();
      expect(result.coverageThreshold).toBe(80);
      expect(result.fileSizeThreshold).toBe(300);
      expect(result.lintErrorWeight).toBe(3);
      expect(result.lintWarningWeight).toBe(2);
    });

    it('should apply partial config with defaults', () => {
      const instance = new ProposalMapper({ coverageThreshold: 75 });
      const config = instance.getConfig();
      expect(config.coverageThreshold).toBe(75);
      expect(config.fileSizeThreshold).toBe(500); // default
    });
  });

  describe('getConfig()', () => {
    it('should return a copy of config', () => {
      const config1 = mapper.getConfig();
      const config2 = mapper.getConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });

    it('should reflect config changes', () => {
      const instance = new ProposalMapper({ coverageThreshold: 60 });
      const config = instance.getConfig();
      expect(config.coverageThreshold).toBe(60);
    });
  });

  describe('mapFromScanResult()', () => {
    it('should return empty array when no issues found', () => {
      const context = createContext({
        scanResult: {
          timestamp: new Date(),
          coverage: {
            ...createEmptyCoverageReport(),
            totalStatements: 100,
            coveredStatements: 80,
            threshold: 50,
          },
          types: createEmptyTypeCheckResult(),
          lint: createEmptyLintResult(),
          sizes: {
            files: [{ path: 'src/small.ts', lines: 100, isLarge: false }],
            threshold: 500,
          },
        },
      });
      const proposals = mapper.mapFromScanResult(context);
      expect(proposals).toEqual([]);
    });

    it('should call all from* methods', () => {
      // Test via integration - all sources contribute to result
      const context = createContext({
        scanResult: {
          timestamp: new Date(),
          coverage: {
            ...createEmptyCoverageReport(),
            totalStatements: 100,
            coveredStatements: 30,
            threshold: 50,
          },
          types: {
            errors: [{ file: 'src/a.ts', line: 1, column: 1, message: 'E', code: 2322 }],
            warnings: [],
            success: false,
          },
          lint: createEmptyLintResult(),
          sizes: createEmptyFileSizeReport(),
        },
      });
      const proposals = mapper.mapFromScanResult(context);
      expect(proposals.length).toBeGreaterThan(0);
    });
  });

  describe('fromCoverage()', () => {
    it('should return empty array when coverage is at threshold', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 50,
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals).toEqual([]);
    });

    it('should return empty array when coverage exceeds threshold', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 60,
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals).toEqual([]);
    });

    it('should generate proposal when coverage below threshold', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 30,
        uncoveredFiles: [],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].type).toBe('improve_test');
    });

    it('should generate proposal for zero coverage', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 0,
        coveredStatements: 0,
        uncoveredFiles: ['src/foo.ts'],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals.some((p) => p.title.includes('0%'))).toBe(true);
    });

    it('should generate separate proposals for uncovered files', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 50,
        uncoveredFiles: ['src/a.ts', 'src/b.ts'],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals.length).toBe(2);
      expect(proposals.every((p) => p.type === 'improve_test')).toBe(true);
    });

    it('should handle zero total statements', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 0,
        coveredStatements: 0,
        uncoveredFiles: [],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals.length).toBe(1);
      expect(proposals[0].title).toContain('0%');
    });

    it('should include selection metadata in proposals', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 30,
        uncoveredFiles: [],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      const proposal = proposals[0];
      expect(proposal.selection).toHaveProperty('confidence');
      expect(proposal.selection).toHaveProperty('cost');
      expect(proposal.selection).toHaveProperty('benefit');
      expect(proposal.selection).toHaveProperty('risk');
    });
  });

  describe('fromTypeErrors()', () => {
    it('should return empty array for no errors', () => {
      const result: TypeCheckResult = createEmptyTypeCheckResult();
      const proposals = mapper.fromTypeErrors(result);
      expect(proposals).toEqual([]);
    });

    it('should generate proposal for single error', () => {
      const result: TypeCheckResult = {
        errors: [{ file: 'src/foo.ts', line: 10, column: 5, message: 'Type error', code: 2322 }],
        warnings: [],
        success: false,
      };
      const proposals = mapper.fromTypeErrors(result);
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe('improve_code');
    });

    it('should generate merged proposal when >5 errors in same file', () => {
      const errors = Array.from({ length: 8 }, (_, i) => ({
        file: 'src/large.ts',
        line: i + 1,
        column: 1,
        message: `Error ${i}`,
        code: 2322,
      }));
      const result: TypeCheckResult = { errors, warnings: [], success: false };
      const proposals = mapper.fromTypeErrors(result);
      expect(proposals.length).toBe(1);
      expect(proposals[0].title).toContain('8 个类型错误');
    });

    it('should generate separate proposals for errors <=5 per file', () => {
      const result: TypeCheckResult = {
        errors: [
          { file: 'src/a.ts', line: 1, column: 1, message: 'Error 1', code: 2322 },
          { file: 'src/a.ts', line: 2, column: 1, message: 'Error 2', code: 2322 },
          { file: 'src/b.ts', line: 1, column: 1, message: 'Error 3', code: 2322 },
        ],
        warnings: [],
        success: false,
      };
      const proposals = mapper.fromTypeErrors(result);
      expect(proposals.length).toBe(3);
    });

    it('should group errors by file correctly', () => {
      const result: TypeCheckResult = {
        errors: [
          { file: 'src/a.ts', line: 1, column: 1, message: 'E1', code: 2322 },
          { file: 'src/a.ts', line: 2, column: 1, message: 'E2', code: 2322 },
          { file: 'src/b.ts', line: 1, column: 1, message: 'E3', code: 2322 },
          { file: 'src/b.ts', line: 2, column: 1, message: 'E4', code: 2322 },
          { file: 'src/b.ts', line: 3, column: 1, message: 'E5', code: 2322 },
          { file: 'src/b.ts', line: 4, column: 1, message: 'E6', code: 2322 },
        ],
        warnings: [],
        success: false,
      };
      const proposals = mapper.fromTypeErrors(result);
      // a.ts: 2 errors (separate proposals), b.ts: 4 errors (separate proposals)
      // 2 + 4 = 6 proposals
      expect(proposals.length).toBe(6);
    });

    it('should include file path in proposal target', () => {
      const result: TypeCheckResult = {
        errors: [{ file: 'src/test.ts', line: 1, column: 1, message: 'Error', code: 2322 }],
        warnings: [],
        success: false,
      };
      const proposals = mapper.fromTypeErrors(result);
      expect(proposals[0].target.file).toBe('src/test.ts');
    });
  });

  describe('fromLintIssues()', () => {
    it('should return empty array for no issues', () => {
      const result: LintResult = createEmptyLintResult();
      const proposals = mapper.fromLintIssues(result);
      expect(proposals).toEqual([]);
    });

    it('should return empty array for only warnings', () => {
      const result: LintResult = {
        errors: [],
        warnings: [{ file: 'src/a.ts', line: 1, column: 1, message: 'Warning', rule: 'no-unused', severity: 'warning' }],
        success: true,
        fatalErrorCount: 0,
      };
      const proposals = mapper.fromLintIssues(result);
      expect(proposals.length).toBe(1);
    });

    it('should generate proposal for single lint issue', () => {
      const result: LintResult = {
        errors: [{ file: 'src/a.ts', line: 1, column: 1, message: 'Error', rule: 'no-console', severity: 'error' }],
        warnings: [],
        success: false,
        fatalErrorCount: 0,
      };
      const proposals = mapper.fromLintIssues(result);
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe('improve_code');
    });

    it('should generate merged proposal when >10 issues per file', () => {
      const errors = Array.from({ length: 12 }, (_, i) => ({
        file: 'src/large.ts',
        line: i + 1,
        column: 1,
        message: `Issue ${i}`,
        rule: 'some-rule',
        severity: 'error' as const,
      }));
      const result: LintResult = { errors, warnings: [], success: false, fatalErrorCount: 0 };
      const proposals = mapper.fromLintIssues(result);
      expect(proposals.length).toBe(1);
      expect(proposals[0].title).toContain('12 issues');
    });

    it('should generate separate proposals for <=10 issues per file', () => {
      const errors = Array.from({ length: 5 }, (_, i) => ({
        file: 'src/a.ts',
        line: i + 1,
        column: 1,
        message: `Error ${i}`,
        rule: 'rule',
        severity: 'error' as const,
      }));
      const result: LintResult = { errors, warnings: [], success: false, fatalErrorCount: 0 };
      const proposals = mapper.fromLintIssues(result);
      expect(proposals.length).toBe(5);
    });

    it('should include both errors and warnings in merged count', () => {
      const result: LintResult = {
        errors: Array.from({ length: 6 }, (_, i) => ({
          file: 'src/a.ts',
          line: i + 1,
          column: 1,
          message: `Error ${i}`,
          rule: 'rule',
          severity: 'error' as const,
        })),
        warnings: Array.from({ length: 5 }, (_, i) => ({
          file: 'src/a.ts',
          line: i + 10,
          column: 1,
          message: `Warning ${i}`,
          rule: 'rule',
          severity: 'warning' as const,
        })),
        success: false,
        fatalErrorCount: 0,
      };
      const proposals = mapper.fromLintIssues(result);
      // 6 errors + 5 warnings = 11 > 10, so merged
      expect(proposals.length).toBe(1);
      expect(proposals[0].title).toContain('11 issues');
    });

    it('should handle mixed errors and warnings per file', () => {
      const result: LintResult = {
        errors: [{ file: 'src/a.ts', line: 1, column: 1, message: 'Err', rule: 'r', severity: 'error' as const }],
        warnings: [{ file: 'src/a.ts', line: 2, column: 1, message: 'Warn', rule: 'r', severity: 'warning' as const }],
        success: false,
        fatalErrorCount: 0,
      };
      const proposals = mapper.fromLintIssues(result);
      expect(proposals.length).toBe(2);
    });
  });

  describe('fromLargeFiles()', () => {
    it('should return empty array when no large files', () => {
      const report: FileSizeReport = {
        files: [
          { path: 'src/small.ts', lines: 100, isLarge: false },
          { path: 'src/medium.ts', lines: 300, isLarge: false },
        ],
        threshold: 500,
      };
      const proposals = mapper.fromLargeFiles(report);
      expect(proposals).toEqual([]);
    });

    it('should generate proposal for large file', () => {
      const report: FileSizeReport = {
        files: [{ path: 'src/large.ts', lines: 600, isLarge: true }],
        threshold: 500,
      };
      const proposals = mapper.fromLargeFiles(report);
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe('improve_architecture');
    });

    it('should generate proposal for multiple large files', () => {
      const report: FileSizeReport = {
        files: [
          { path: 'src/a.ts', lines: 600, isLarge: true },
          { path: 'src/b.ts', lines: 800, isLarge: true },
          { path: 'src/small.ts', lines: 100, isLarge: false },
        ],
        threshold: 500,
      };
      const proposals = mapper.fromLargeFiles(report);
      expect(proposals.length).toBe(2);
    });

    it('should include line count in title', () => {
      const report: FileSizeReport = {
        files: [{ path: 'src/large.ts', lines: 750, isLarge: true }],
        threshold: 500,
      };
      const proposals = mapper.fromLargeFiles(report);
      expect(proposals[0].title).toContain('750');
    });

    it('should use report threshold not config', () => {
      const report: FileSizeReport = {
        files: [{ path: 'src/large.ts', lines: 600, isLarge: true }],
        threshold: 550,
      };
      const proposals = mapper.fromLargeFiles(report);
      expect(proposals[0].description).toContain('550');
    });

    it('should include file path in target', () => {
      const report: FileSizeReport = {
        files: [{ path: 'src/large.ts', lines: 600, isLarge: true }],
        threshold: 500,
      };
      const proposals = mapper.fromLargeFiles(report);
      expect(proposals[0].target.file).toBe('src/large.ts');
    });
  });

  describe('path shortening (private)', () => {
    it('should shorten paths with /src/ prefix', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 80, // above threshold, no overall proposal
        uncoveredFiles: ['/project/src/stratix-systemzone/observer/InputPreprocessor.ts'],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals[0].title).toContain('observer/InputPreprocessor.ts');
      expect(proposals[0].title).not.toContain('/project/');
    });

    it('should shorten long paths with ellipsis', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 80, // above threshold, no overall proposal
        uncoveredFiles: ['/very/long/path/to/some/deeply/nested/directory/file.ts'],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals[0].title).toContain('.../');
    });
  });

  describe('proposal structure', () => {
    it('should set proposal status to pending', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 30,
        uncoveredFiles: [],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals[0].status).toBe('pending');
    });

    it('should generate unique proposal IDs', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 30,
        uncoveredFiles: ['src/a.ts', 'src/b.ts'],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      const ids = proposals.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should set timestamp from context', () => {
      const timestamp = new Date('2024-01-01T00:00:00Z');
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 30,
        uncoveredFiles: [],
        threshold: 50,
      };
      const context = createContext({ timestamp });
      const proposals = mapper.fromCoverage(report, context);
      expect(proposals[0].timestamp).toEqual(timestamp);
    });

    it('should use current date when no context timestamp', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 30,
        uncoveredFiles: [],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals[0].timestamp).toBeInstanceOf(Date);
    });
  });

  describe('edge cases', () => {
    it('should handle empty uncovered files array', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 30,
        uncoveredFiles: [],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals.length).toBe(1); // overall coverage proposal
    });

    it('should handle warnings only in lint', () => {
      const result: LintResult = {
        errors: [],
        warnings: [
          { file: 'src/a.ts', line: 1, column: 1, message: 'Warn', rule: 'r', severity: 'warning' },
        ],
        success: true,
        fatalErrorCount: 0,
      };
      const proposals = mapper.fromLintIssues(result);
      expect(proposals.length).toBe(1);
      expect(proposals[0].title).toContain('warning');
    });

    it('should handle undefined context in fromCoverage', () => {
      const report: CoverageReport = {
        ...createEmptyCoverageReport(),
        totalStatements: 100,
        coveredStatements: 30,
        uncoveredFiles: [],
        threshold: 50,
      };
      const proposals = mapper.fromCoverage(report);
      expect(proposals.length).toBe(1);
    });

    it('should handle context without timestamp in fromTypeErrors', () => {
      const result: TypeCheckResult = {
        errors: [{ file: 'src/a.ts', line: 1, column: 1, message: 'E', code: 2322 }],
        warnings: [],
        success: false,
      };
      const proposals = mapper.fromTypeErrors(result);
      expect(proposals[0].timestamp).toBeInstanceOf(Date);
    });
  });

  describe('integration - full scan result mapping', () => {
    it('should combine proposals from all sources', () => {
      const scanResult: ScanResult = {
        timestamp: new Date(),
        coverage: {
          totalStatements: 100,
          totalBranches: 50,
          totalFunctions: 20,
          totalLines: 100,
          coveredStatements: 30,
          coveredBranches: 20,
          coveredFunctions: 10,
          coveredLines: 30,
          uncoveredFiles: ['src/uncovered.ts'],
          threshold: 50,
        },
        types: {
          errors: [{ file: 'src/type-error.ts', line: 10, column: 1, message: 'Type error', code: 2322 }],
          warnings: [],
          success: false,
        },
        lint: {
          errors: [{ file: 'src/lint-error.ts', line: 1, column: 1, message: 'Lint error', rule: 'no-console', severity: 'error' }],
          warnings: [],
          success: false,
          fatalErrorCount: 0,
        },
        sizes: {
          files: [{ path: 'src/large.ts', lines: 600, isLarge: true }],
          threshold: 500,
        },
      };

      const context = createContext({ scanResult });
      const proposals = mapper.mapFromScanResult(context);

      // Coverage: 1 (overall) + 1 (uncovered file) = 2
      // Types: 1
      // Lint: 1
      // Sizes: 1
      // Total: 5
      expect(proposals.length).toBe(5);

      const types = new Set(proposals.map((p) => p.type));
      expect(types).toContain('improve_test');
      expect(types).toContain('improve_code');
      expect(types).toContain('improve_architecture');
    });
  });
});
