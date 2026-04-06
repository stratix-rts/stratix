/**
 * ProjectScanner.test.ts - 确定性扫描测试
 * Phase 1: Step 3 - ProjectScanner + ProposalMapper 测试
 */

import { EventEmitter } from 'events';

// -------------------------------------------------------------------------
// Mock child_process with proper Jest mock
// -------------------------------------------------------------------------
class MockChildProcess extends EventEmitter {
  stdout = new MockReadable();
  stderr = new MockReadable();
  kill = jest.fn();
  on = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.on(event, handler);
    return this;
  });
  off = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.off(event, handler);
    return this;
  });
}

class MockReadable extends EventEmitter {
  on = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.on(event, handler);
    return this;
  });
  off = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.off(event, handler);
    return this;
  });
  pipe = jest.fn(() => this);
}

const mockProc = new MockChildProcess();

jest.mock('child_process', () => ({
  spawn: jest.fn(() => mockProc),
}));

import { spawn } from 'child_process';
import { ProjectScanner } from '../ProjectScanner';
import { ProposalMapper } from '../ProposalMapper';
import type { CoverageReport, TypeCheckResult, LintResult, FileSizeReport, ScanResult } from '../../types';
import type { MappingContext } from '../types';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('ProjectScanner', () => {
  let scanner: ProjectScanner;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock proc state
    mockProc.kill.mockClear();
    mockProc.stdout.on.mockClear();
    mockProc.stderr.on.mockClear();
    mockProc.on.mockClear();
    mockProc.stdout.removeAllListeners();
    mockProc.stderr.removeAllListeners();
    mockProc.removeAllListeners();

    scanner = new ProjectScanner({
      timeoutMs: 5000,
      cwd: '/fake/project',
      cacheEnabled: false,
    });
  });

  // -------------------------------------------------------------------------
  // Helper to simulate spawn output
  // -------------------------------------------------------------------------
  const simulateSpawnOutput = (
    stdout: string,
    stderr: string,
    exitCode: number | null = 0
  ) => {
    // Simulate data events first
    if (stdout) {
      mockProc.stdout.emit('data', stdout);
    }
    if (stderr) {
      mockProc.stderr.emit('data', stderr);
    }
    // Then simulate close
    mockProc.emit('close', exitCode);
  };

  describe('runTestCoverage', () => {
    it('parses jest JSON coverage output correctly', async () => {
      // Implementation extracts statementCount/hitCount/fnCount/hitFnCount from coverage data
      // A file is uncovered only when hitCount === 0 AND statementCount > 0
      const coverageJson = JSON.stringify({
        coverageMap: {
          '/fake/project/src/utils.ts': {
            path: '/fake/project/src/utils.ts',
            statementMap: {},
            fnMap: {},
            branchMap: {},
            s: { '0': 1, '1': 0, '2': 1 },
            f: { '0': 1, '1': 0 },
            b: { '0': [1, 0] },
            statementCount: 3,
            hitCount: 2,
            fnCount: 2,
            hitFnCount: 1,
            branchCount: 1,
            hitBranchCount: 1,
            lines: { '1': 1, '2': 0, '3': 1 },
          },
          '/fake/project/src/never-called.ts': {
            path: '/fake/project/src/never-called.ts',
            statementMap: {},
            fnMap: {},
            branchMap: {},
            s: {},
            f: {},
            b: {},
            statementCount: 5,
            hitCount: 0, // No statements hit = uncovered
            fnCount: 1,
            hitFnCount: 0,
            branchCount: 0,
            hitBranchCount: 0,
            lines: {},
          },
        },
      });

      const promise = scanner.runTestCoverage();
      simulateSpawnOutput(coverageJson, '', 0);
      const report = await promise;

      expect(report.totalStatements).toBe(8);
      expect(report.coveredStatements).toBe(2);
      expect(report.totalFunctions).toBe(3);
      expect(report.coveredFunctions).toBe(1);
      expect(report.uncoveredFiles).toContain('/fake/project/src/never-called.ts');
      expect(report.threshold).toBe(50);
    });

    it('returns empty report when no coverage data', async () => {
      const promise = scanner.runTestCoverage();
      simulateSpawnOutput('{}', '', 0);
      const report = await promise;

      expect(report.totalStatements).toBe(0);
      expect(report.coveredStatements).toBe(0);
      expect(report.uncoveredFiles).toHaveLength(0);
    });

    it('handles empty stdout gracefully', async () => {
      const promise = scanner.runTestCoverage();
      simulateSpawnOutput('', '', 0);
      const report = await promise;

      expect(report.totalStatements).toBe(0);
    });
  });

  describe('runTypeCheck', () => {
    it('parses TypeScript error output correctly', async () => {
      const tscStderr = `src/utils.ts(10,5): error TS2304: Cannot find name 'foo'.`;

      const promise = scanner.runTypeCheck();
      simulateSpawnOutput('', tscStderr, 1);
      const result = await promise;

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.success).toBe(false);
      expect(result.errors[0].code).toBe(2304);
      expect(result.errors[0].file).toContain('utils.ts');
    });

    it('returns success when no errors', async () => {
      const promise = scanner.runTypeCheck();
      simulateSpawnOutput('', '', 0);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('parses multiple errors from same file', async () => {
      const tscStderr = `src/utils.ts(10,5): error TS2304: Cannot find name 'foo'.
src/utils.ts(20,10): error TS2339: Property 'bar' does not exist.`;

      const promise = scanner.runTypeCheck();
      simulateSpawnOutput('', tscStderr, 1);
      const result = await promise;

      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('runLint', () => {
    it('parses ESLint JSON output correctly', async () => {
      const eslintJson = JSON.stringify([
        {
          filePath: '/fake/project/src/utils.ts',
          messages: [
            {
              line: 10,
              column: 5,
              message: 'Missing semicolon',
              ruleId: 'semi',
              severity: 2,
            },
            {
              line: 15,
              column: 1,
              message: 'Unexpected console statement',
              ruleId: 'no-console',
              severity: 1,
            },
          ],
          errorCount: 1,
          warningCount: 1,
        },
      ]);

      const promise = scanner.runLint();
      simulateSpawnOutput(eslintJson, '', 1);
      const result = await promise;

      expect(result.errors.length).toBe(1);
      expect(result.warnings.length).toBe(1);
      expect(result.errors[0].rule).toBe('semi');
      expect(result.errors[0].severity).toBe('error');
      expect(result.warnings[0].rule).toBe('no-console');
      expect(result.warnings[0].severity).toBe('warning');
      expect(result.success).toBe(false);
    });

    it('returns empty result when no issues', async () => {
      const promise = scanner.runLint();
      simulateSpawnOutput('[]', '', 0);
      const result = await promise;

      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.success).toBe(true);
    });
  });

  describe('timeout protection', () => {
    it('kills process on timeout', async () => {
      jest.useFakeTimers();

      const promise = scanner.runTestCoverage();
      jest.advanceTimersByTime(6000);

      await expect(promise).rejects.toThrow(/timed out/);
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });
  });

  describe('scanAll', () => {
    it('runs all scans and returns combined result', async () => {
      const promise = scanner.scanAll();
      simulateSpawnOutput(JSON.stringify({ coverageMap: {} }), '', 0);
      const result = await promise;

      expect(result.scanResult).toBeDefined();
      expect(result.scanResult.timestamp).toBeInstanceOf(Date);
      expect(result.duration).toBeDefined();
      expect(typeof result.duration.total).toBe('number');
      expect(typeof result.duration.coverage).toBe('number');
      expect(typeof result.duration.typecheck).toBe('number');
      expect(typeof result.duration.lint).toBe('number');
      expect(typeof result.duration.fileSizes).toBe('number');
    });

    it('returns partial results when some scans fail', async () => {
      const fastScanner = new ProjectScanner({
        timeoutMs: 100,
        cwd: '/fake/project',
        cacheEnabled: false,
      });
      const result = await fastScanner.scanAll();

      // Even if commands fail, we should get partial results
      expect(result.scanResult).toBeDefined();
      expect(result.scanResult.coverage).toBeDefined();
      expect(result.scanResult.types).toBeDefined();
      expect(result.scanResult.lint).toBeDefined();
      expect(result.scanResult.sizes).toBeDefined();
    });
  });

  describe('getConfig', () => {
    it('returns scanner config', () => {
      const config = scanner.getConfig();
      expect(config.timeoutMs).toBe(5000);
      expect(config.cwd).toBe('/fake/project');
      expect(config.cacheEnabled).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('clears internal cache', () => {
      scanner.clearCache();
      // Should not throw
      expect(() => scanner.clearCache()).not.toThrow();
    });
  });

  describe('getCacheStatus', () => {
    it('returns cache status', () => {
      const status = scanner.getCacheStatus();
      expect(status).toHaveProperty('size');
      expect(status).toHaveProperty('keys');
    });
  });
});

describe('ProposalMapper', () => {
  let mapper: ProposalMapper;

  beforeEach(() => {
    mapper = new ProposalMapper({
      coverageThreshold: 50,
      fileSizeThreshold: 500,
      lintErrorWeight: 2,
      lintWarningWeight: 1,
    });
  });

  const createMappingContext = (overrides: Partial<ScanResult> = {}): MappingContext => ({
    timestamp: new Date(),
    scanResult: {
      timestamp: new Date(),
      coverage: {
        totalStatements: 0, totalBranches: 0, totalFunctions: 0, totalLines: 0,
        coveredStatements: 0, coveredBranches: 0, coveredFunctions: 0, coveredLines: 0,
        uncoveredFiles: [], threshold: 50,
        ...overrides.coverage,
      } as CoverageReport,
      types: {
        errors: [], warnings: [], success: true,
        ...overrides.types,
      } as TypeCheckResult,
      lint: {
        errors: [], warnings: [], success: true, fatalErrorCount: 0,
        ...overrides.lint,
      } as LintResult,
      sizes: {
        files: [], threshold: 500,
        ...overrides.sizes,
      } as FileSizeReport,
      ...overrides,
    } as ScanResult,
    projectRoot: '/fake/project',
  });

  describe('fromCoverage', () => {
    it('generates proposal when coverage is below threshold', () => {
      const ctx = createMappingContext({
        coverage: {
          totalStatements: 100,
          totalBranches: 50,
          totalFunctions: 20,
          totalLines: 100,
          coveredStatements: 30,
          coveredBranches: 15,
          coveredFunctions: 5,
          coveredLines: 30,
          uncoveredFiles: [],
          threshold: 50,
        },
      });

      const proposals = mapper.fromCoverage(ctx.scanResult.coverage, ctx);

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].type).toBe('improve_test');
      expect(proposals[0].title).toContain('覆盖率不足');
    });

    it('does not generate proposal when coverage is above threshold', () => {
      const ctx = createMappingContext({
        coverage: {
          totalStatements: 100,
          totalBranches: 50,
          totalFunctions: 20,
          totalLines: 100,
          coveredStatements: 80,
          coveredBranches: 40,
          coveredFunctions: 16,
          coveredLines: 80,
          uncoveredFiles: [],
          threshold: 50,
        },
      });

      const proposals = mapper.fromCoverage(ctx.scanResult.coverage, ctx);
      expect(proposals).toHaveLength(0);
    });

    it('generates individual proposals for uncovered files', () => {
      const ctx = createMappingContext({
        coverage: {
          totalStatements: 100,
          totalBranches: 50,
          totalFunctions: 20,
          totalLines: 100,
          coveredStatements: 80,
          coveredBranches: 40,
          coveredFunctions: 16,
          coveredLines: 80,
          uncoveredFiles: ['src/utils.ts'],
          threshold: 50,
        },
      });

      const proposals = mapper.fromCoverage(ctx.scanResult.coverage, ctx);
      expect(proposals.some((p) => p.target.file === 'src/utils.ts')).toBe(true);
    });
  });

  describe('fromTypeErrors', () => {
    it('generates proposals for type errors', () => {
      const ctx = createMappingContext({
        types: {
          errors: [
            { file: 'src/utils.ts', line: 10, column: 5, message: "Cannot find name 'foo'", code: 2304 },
            { file: 'src/utils.ts', line: 20, column: 10, message: "Property 'bar' does not exist", code: 2339 },
          ],
          warnings: [],
          success: false,
        },
      });

      const proposals = mapper.fromTypeErrors(ctx.scanResult.types, ctx);

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals.every((p) => p.type === 'improve_code')).toBe(true);
    });

    it('returns empty when no type errors', () => {
      const ctx = createMappingContext();
      const proposals = mapper.fromTypeErrors(ctx.scanResult.types, ctx);
      expect(proposals).toHaveLength(0);
    });

    it('merges many errors in same file into one proposal', () => {
      const manyErrors = Array.from({ length: 10 }, (_, i) => ({
        file: 'src/utils.ts',
        line: i + 1,
        column: 1,
        message: `Error ${i}`,
        code: 2304,
      }));

      const ctx = createMappingContext({
        types: { errors: manyErrors, warnings: [], success: false },
      });

      const proposals = mapper.fromTypeErrors(ctx.scanResult.types, ctx);

      expect(proposals.length).toBe(1);
      expect(proposals[0].title).toContain('10 个类型错误');
    });

    it('generates individual proposals for few errors per file', () => {
      const fewErrors = [
        { file: 'src/utils.ts', line: 10, column: 5, message: "Error 1", code: 2304 },
        { file: 'src/utils.ts', line: 20, column: 5, message: "Error 2", code: 2304 },
      ];

      const ctx = createMappingContext({
        types: { errors: fewErrors, warnings: [], success: false },
      });

      const proposals = mapper.fromTypeErrors(ctx.scanResult.types, ctx);

      // With 2 errors (<= 5), should generate individual proposals
      expect(proposals.length).toBe(2);
    });
  });

  describe('fromLintIssues', () => {
    it('generates proposals for lint errors', () => {
      const ctx = createMappingContext({
        lint: {
          errors: [
            { file: 'src/utils.ts', line: 10, column: 5, message: 'Missing semicolon', rule: 'semi', severity: 'error' as const },
          ],
          warnings: [],
          success: false,
          fatalErrorCount: 0,
        },
      });

      const proposals = mapper.fromLintIssues(ctx.scanResult.lint, ctx);

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals.every((p) => p.type === 'improve_code')).toBe(true);
    });

    it('generates proposals for lint warnings', () => {
      const ctx = createMappingContext({
        lint: {
          errors: [],
          warnings: [
            { file: 'src/utils.ts', line: 15, column: 1, message: 'Unexpected console', rule: 'no-console', severity: 'warning' as const },
          ],
          success: false,
          fatalErrorCount: 0,
        },
      });

      const proposals = mapper.fromLintIssues(ctx.scanResult.lint, ctx);

      expect(proposals.length).toBeGreaterThan(0);
    });

    it('returns empty when no lint issues', () => {
      const ctx = createMappingContext();
      const proposals = mapper.fromLintIssues(ctx.scanResult.lint, ctx);
      expect(proposals).toHaveLength(0);
    });
  });

  describe('fromLargeFiles', () => {
    it('generates proposals for files over threshold', () => {
      const ctx = createMappingContext({
        sizes: {
          files: [
            { path: '/fake/project/src/big-file.ts', lines: 800, isLarge: true },
            { path: '/fake/project/src/small-file.ts', lines: 100, isLarge: false },
          ],
          threshold: 500,
        },
      });

      const proposals = mapper.fromLargeFiles(ctx.scanResult.sizes, ctx);

      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe('improve_architecture');
      expect(proposals[0].title).toContain('800 行');
    });

    it('returns empty when no large files', () => {
      const ctx = createMappingContext({
        sizes: {
          files: [
            { path: '/fake/project/src/small.ts', lines: 100, isLarge: false },
          ],
          threshold: 500,
        },
      });

      const proposals = mapper.fromLargeFiles(ctx.scanResult.sizes, ctx);
      expect(proposals).toHaveLength(0);
    });
  });

  describe('mapFromScanResult', () => {
    it('combines all mappings', () => {
      const ctx = createMappingContext({
        coverage: {
          totalStatements: 100,
          totalBranches: 50,
          totalFunctions: 20,
          totalLines: 100,
          coveredStatements: 30,
          coveredBranches: 15,
          coveredFunctions: 5,
          coveredLines: 30,
          uncoveredFiles: [],
          threshold: 50,
        },
        types: {
          errors: [{ file: 'src/main.ts', line: 1, column: 1, message: 'Error', code: 2304 }],
          warnings: [],
          success: false,
        },
        lint: {
          errors: [],
          warnings: [],
          success: true,
          fatalErrorCount: 0,
        },
        sizes: {
          files: [],
          threshold: 500,
        },
      });

      const proposals = mapper.mapFromScanResult(ctx);

      expect(proposals.length).toBeGreaterThan(0);
      proposals.forEach((p) => {
        expect(p.type).toMatch(/^improve_(code|test|architecture)$/);
        expect(p.status).toBe('pending');
        expect(p.selection).toBeDefined();
        expect(p.id).toBeDefined();
        expect(p.timestamp).toBeInstanceOf(Date);
      });
    });
  });

  describe('getConfig', () => {
    it('returns current config', () => {
      const config = mapper.getConfig();
      expect(config.coverageThreshold).toBe(50);
      expect(config.fileSizeThreshold).toBe(500);
      expect(config.lintErrorWeight).toBe(2);
      expect(config.lintWarningWeight).toBe(1);
    });
  });
});

describe('ProjectScanner + ProposalMapper integration', () => {
  it('scanner and mapper work together', async () => {
    const scanner = new ProjectScanner({ cacheEnabled: false, timeoutMs: 100, cwd: '/fake/project' });
    const mapper = new ProposalMapper();

    const result = await scanner.scanAll();

    expect(result.scanResult).toBeDefined();
    expect(result.scanResult.timestamp).toBeInstanceOf(Date);
    expect(result.scanResult.coverage).toBeDefined();
    expect(result.scanResult.types).toBeDefined();
    expect(result.scanResult.lint).toBeDefined();
    expect(result.scanResult.sizes).toBeDefined();

    // ProposalMapper should accept any scan result without throwing
    const proposals = mapper.mapFromScanResult({
      timestamp: new Date(),
      scanResult: result.scanResult,
      projectRoot: '/fake/project',
    });

    expect(Array.isArray(proposals)).toBe(true);
  });
});
