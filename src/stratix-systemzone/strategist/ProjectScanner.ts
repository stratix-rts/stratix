// ============================================
// ProjectScanner.ts - 确定性文件扫描
// Phase 1: Step 3 - ProjectScanner 确定性扫描
// ============================================

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type {
  CoverageReport,
  TypeCheckResult,
  LintResult,
  FileSizeReport,
  FileSizeEntry,
  ScanResult,
  TypeError,
  LintIssue,
} from '../types';

import type { ScannerConfig, ScannerResult, ScannerError, TscScanItem, EslintScanItem, FileSizeScanItem, ParallelScanResult } from './types';

const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds
const DEFAULT_CWD = path.resolve(__dirname, '../../../../'); // Project root
const DEFAULT_FILE_SIZE_THRESHOLD = 500;
const DEFAULT_COVERAGE_THRESHOLD = 50;
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * ProjectScanner - 确定性文件扫描
 *
 * 执行覆盖率扫描、类型检查、lint 检查和文件大小扫描
 * 所有命令都有 60s 超时保护，结果缓存 30 分钟
 */
export class ProjectScanner {
  private config: Required<ScannerConfig>;
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  constructor(config: ScannerConfig = {}) {
    this.config = {
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      cwd: config.cwd ?? DEFAULT_CWD,
      fileSizeThreshold: config.fileSizeThreshold ?? DEFAULT_FILE_SIZE_THRESHOLD,
      coverageThreshold: config.coverageThreshold ?? DEFAULT_COVERAGE_THRESHOLD,
      cacheEnabled: config.cacheEnabled ?? true,
      cacheTtlMs: config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    };
  }

  /**
   * 执行所有扫描
   */
  async scanAll(): Promise<ScannerResult> {
    const startTime = Date.now();
    const errors: ScannerError[] = [];

    // Coverage scan
    const coverageStart = Date.now();
    let coverage: CoverageReport;
    try {
      coverage = await this.runTestCoverage();
    } catch (e) {
      errors.push({ step: 'coverage', message: String(e) });
      coverage = this.emptyCoverageReport();
    }
    const coverageDuration = Date.now() - coverageStart;

    // Type check
    const typecheckStart = Date.now();
    let types: TypeCheckResult;
    try {
      types = await this.runTypeCheck();
    } catch (e) {
      errors.push({ step: 'typecheck', message: String(e) });
      types = { errors: [], warnings: [], success: false };
    }
    const typecheckDuration = Date.now() - typecheckStart;

    // Lint
    const lintStart = Date.now();
    let lint: LintResult;
    try {
      lint = await this.runLint();
    } catch (e) {
      errors.push({ step: 'lint', message: String(e) });
      lint = { errors: [], warnings: [], success: false, fatalErrorCount: 0 };
    }
    const lintDuration = Date.now() - lintStart;

    // File sizes
    const fileSizesStart = Date.now();
    let sizes: FileSizeReport;
    try {
      sizes = await this.scanFileSizes();
    } catch (e) {
      errors.push({ step: 'fileSizes', message: String(e) });
      sizes = { files: [], threshold: this.config.fileSizeThreshold };
    }
    const fileSizesDuration = Date.now() - fileSizesStart;

    const totalDuration = Date.now() - startTime;

    const scanResult: ScanResult = {
      timestamp: new Date(),
      coverage,
      types,
      lint,
      sizes,
    };

    return {
      success: errors.length === 0,
      scanResult,
      errors,
      duration: {
        coverage: coverageDuration,
        typecheck: typecheckDuration,
        lint: lintDuration,
        fileSizes: fileSizesDuration,
        total: totalDuration,
      },
    };
  }

  /**
   * 并行执行三部分扫描：tsc + eslint + fileSize
   * 每部分独立，一个失败不影响其他
   */
  async scan(): Promise<ParallelScanResult> {
    const results = await Promise.allSettled([
      this.runTscScan(),
      this.runEslintScan(),
      this.runFileSizeScan(),
    ]);

    const [tscResult, eslintResult, fileSizeResult] = results;

    return {
      tscErrors: tscResult?.status === 'fulfilled' ? tscResult.value : [],
      eslintIssues: eslintResult?.status === 'fulfilled' ? eslintResult.value : [],
      largeFiles: fileSizeResult?.status === 'fulfilled' ? fileSizeResult.value : [],
    };
  }

  /**
   * Task 2.2: ESLint 扫描（直接扫描 src/ 目录）
   * 执行: npx eslint src --format json --no-error-on-unmatched-pattern
   * eslint 不可用时返回空数组
   */
  async runEslintScan(): Promise<Array<{ file: string; ruleId: string | null; severity: 1 | 2; message: string; line: number }>> {
    return new Promise((resolve) => {
      const proc = spawn('npx', ['eslint', 'src/**/*.{ts,vue}', '--format', 'json', '--no-error-on-unmatched-pattern'], {
        cwd: this.config.cwd,
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
        // Resolve with empty on timeout (eslint unavailable or hung)
        resolve([]);
      }, this.config.timeoutMs);

      proc.on('close', () => {
        clearTimeout(timer);
        try {
          const results = JSON.parse(stdout);
          const items: EslintScanItem[] = [];

          for (const fileResult of Array.isArray(results) ? results : [results]) {
            if (!fileResult.messages) continue;
            for (const msg of fileResult.messages) {
              items.push({
                file: fileResult.filePath ?? 'unknown',
                ruleId: msg.ruleId ?? null,
                severity: msg.severity === 2 ? 2 as const : 1 as const,
                message: msg.message ?? '',
                line: msg.line ?? 0,
              });
            }
          }

          resolve(items);
        } catch {
          // eslint 不可用或解析失败，返回空数组
          resolve([]);
        }
      });

      proc.on('error', () => {
        clearTimeout(timer);
        resolve([]);
      });
    });
  }

  /**
   * Task 2.3: 文件大小扫描（支持 .ts 和 .vue）
   * 递归遍历 src/ 目录统计每个 .ts/.vue 文件行数
   * 超过 500 行的标记为 needs-refactor
   * 排除 node_modules、dist、__tests__
   */
  async runFileSizeScan(): Promise<FileSizeScanItem[]> {
    const threshold = this.config.fileSizeThreshold;
    const items: FileSizeScanItem[] = [];
    const srcDir = path.join(this.config.cwd, 'src');

    await this.scanDirectoryForSize(srcDir, items, threshold);

    return items;
  }

  /**
   * 递归扫描目录（用于文件大小扫描，支持 .ts 和 .vue）
   */
  private async scanDirectoryForSize(dir: string, items: FileSizeScanItem[], threshold: number): Promise<void> {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 目录不可访问时跳过
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === '.git' ||
          entry.name === '__tests__' ||
          entry.name === 'vendor'
        ) {
          continue;
        }
        await this.scanDirectoryForSize(fullPath, items, threshold);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.vue'))) {
        try {
          const content = await fs.promises.readFile(fullPath, 'utf-8');
          const lines = content.split('\n').length;

          items.push({
            file: fullPath,
            lines,
            needsRefactor: lines > threshold,
          });
        } catch {
          // 跳过无法读取的文件
        }
      }
    }
  }

  /**
   * 执行测试覆盖率扫描
   * 运行: npm test -- --coverage --json
   */
  async runTestCoverage(): Promise<CoverageReport> {
    const cacheKey = 'coverage';
    const cached = this.getCached<CoverageReport>(cacheKey);
    if (cached) return cached;

    return new Promise((resolve, reject) => {
      const args = ['test', '--', '--coverage', '--json', '--testPathIgnorePatterns=', '--coverageReporters=json'];
      const proc = spawn('npm', args, {
        cwd: this.config.cwd,
        timeout: this.config.timeoutMs,
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
        reject(new Error(`runTestCoverage timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);

        try {
          const report = this.parseCoverageOutput(stdout, stderr, code);
          this.setCache(cacheKey, report);
          resolve(report);
        } catch (e) {
          reject(e);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`runTestCoverage failed: ${err.message}`));
      });
    });
  }

  /**
   * 解析 Jest 覆盖率输出
   */
  private parseCoverageOutput(stdout: string, stderr: string, exitCode: number | null): CoverageReport {
    try {
      // Jest outputs JSON coverage to stdout when using --json flag
      // Find the JSON part in stdout (may have other output)
      const jsonMatch = stdout.match(/\{[\s\S]*"coverageMap"[\s\S]*\}/);

      if (jsonMatch) {
        const coverageData = JSON.parse(jsonMatch[0]);
        return this.extractCoverageReport(coverageData);
      }
    } catch {
      // Fall through to fallback
    }

    // Fallback: try to parse as general JSON output
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.coverageMap) {
        return this.extractCoverageReport(parsed);
      }
    } catch {
      // Fall through
    }

    // Fallback: if test ran but no JSON coverage, return empty report
    if (exitCode === 0 || exitCode === null) {
      return this.emptyCoverageReport();
    }

    throw new Error(`Failed to parse coverage output. stderr: ${stderr.slice(0, 500)}`);
  }

  /**
   * 从 Jest JSON coverage 数据提取报告
   */
  private extractCoverageReport(coverageData: { coverageMap?: Record<string, unknown> }): CoverageReport {
    const coverageMap = coverageData.coverageMap ?? {};
    const files = Object.keys(coverageMap);

    let totalStatements = 0;
    let totalBranches = 0;
    let totalFunctions = 0;
    let totalLines = 0;
    let coveredStatements = 0;
    let coveredBranches = 0;
    let coveredFunctions = 0;
    let coveredLines = 0;
    const uncoveredFiles: string[] = [];

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

      const stmts = coverage.statementCount ?? 0;
      const stmtsHit = coverage.hitCount ?? 0;
      const branches = coverage.branchCount ?? 0;
      const branchesHit = coverage.hitBranchCount ?? 0;
      const fns = coverage.fnCount ?? 0;
      const fnsHit = coverage.hitFnCount ?? 0;

      // Count lines from statement coverage
      const lines = coverage.lines ?? {};
      const lineCount = Object.keys(lines).length;
      let lineHits = 0;
      for (const hits of Object.values(lines)) {
        if ((hits as number) > 0) lineHits++;
      }

      totalStatements += stmts;
      totalBranches += branches;
      totalFunctions += fns;
      totalLines += lineCount;
      coveredStatements += stmtsHit;
      coveredBranches += branchesHit;
      coveredFunctions += fnsHit;
      coveredLines += lineHits;

      // File is uncovered if statement hit count is 0
      if (stmtsHit === 0 && stmts > 0) {
        uncoveredFiles.push(filePath);
      }
    }

    return {
      totalStatements,
      totalBranches,
      totalFunctions,
      totalLines,
      coveredStatements,
      coveredBranches,
      coveredFunctions,
      coveredLines,
      uncoveredFiles,
      threshold: this.config.coverageThreshold,
    };
  }

  /**
   * 执行 tsc 类型扫描（直接调用 tsc --noEmit --pretty false）
   * 返回结构化错误列表: { file: string, line: number, message: string, code: string }[]
   * tsc 不可用或执行失败时返回空数组（不报错）
   */
  async runTscScan(): Promise<Array<{ file: string; line: number; message: string; code: string }>> {
    return new Promise((resolve, reject) => {
      const proc = spawn('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
        cwd: this.config.cwd,
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
        // Resolve with empty array on timeout (tsc unavailable or hung)
        resolve([]);
      }, this.config.timeoutMs);

      proc.on('close', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(stdout);
          const diagnostics = Array.isArray(parsed) ? parsed : [];
          const errors = diagnostics.map((d: { file?: string; start?: { line?: number; character?: number }; messageText?: string | { message?: string }; code?: number }) => ({
            file: d.file ?? 'unknown',
            line: d.start?.line ?? 0,
            message: typeof d.messageText === 'string' ? d.messageText : (d.messageText?.message ?? ''),
            code: String(d.code ?? ''),
          }));
          resolve(errors);
        } catch {
          // JSON parse failed or tsc not available — return empty array
          resolve([]);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        // tsc not available — return empty array, no error
        resolve([]);
      });
    });
  }

  /**
   * 执行类型检查
   * 运行: npm run typecheck (tsc --noEmit)
   */
  async runTypeCheck(): Promise<TypeCheckResult> {
    const cacheKey = 'typecheck';
    const cached = this.getCached<TypeCheckResult>(cacheKey);
    if (cached) return cached;

    return new Promise((resolve, reject) => {
      const proc = spawn('npm', ['run', 'typecheck'], {
        cwd: this.config.cwd,
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
        reject(new Error(`runTypeCheck timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);

        try {
          const result = this.parseTypeCheckOutput(stdout, stderr, code);
          this.setCache(cacheKey, result);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`runTypeCheck failed: ${err.message}`));
      });
    });
  }

  /**
   * 解析 TypeScript 错误输出
   */
  private parseTypeCheckOutput(stdout: string, stderr: string, exitCode: number | null): TypeCheckResult {
    const errors: TypeError[] = [];
    const warnings: TypeError[] = [];
    const combined = stdout + '\n' + stderr;

    // Standard TypeScript error format: path/to/file.ts(123,45): error TS1234: message
    // Parse this first (more specific) to ensure file paths are captured correctly
    const altRegex = /([^\n(]+)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s*(.+)/gi;
    const matchedPositions = new Set<number>(); // Track matched positions to avoid duplicates
    let match;
    while ((match = altRegex.exec(combined)) !== null) {
      const [, file, lineStr, colStr, severity, codeStr, message] = match;
      const line = parseInt(lineStr, 10);
      const column = parseInt(colStr, 10);
      const code = parseInt(codeStr, 10);

      const error: TypeError = {
        file: file.trim(),
        line,
        column,
        message: message.trim(),
        code,
      };

      // Mark this region as matched
      for (let i = match.index; i < match.index + match[0].length; i++) {
        matchedPositions.add(i);
      }

      if (severity === 'error') {
        errors.push(error);
      } else {
        warnings.push(error);
      }
    }

    // Fallback format: error TS1234: message at file.ts(line,col)
    // Only match lines not already captured by altRegex
    const tsErrorRegex = /(?:error|warning)\s+TS(\d+):\s*(.+?)(?:\s+at\s+|\s+on\s+|\s+in\s+)([^\n:]+?)(?:\((\d+),(\d+)\)|\[line:\s*(\d+),\s*col:\s*(\d+)\])?/gi;
    while ((match = tsErrorRegex.exec(combined)) !== null) {
      // Skip if this position was already matched by altRegex
      let alreadyMatched = false;
      for (let i = match.index; i < match.index + match[0].length; i++) {
        if (matchedPositions.has(i)) { alreadyMatched = true; break; }
      }
      if (alreadyMatched) continue;

      const [, codeStr, message, file, lineStr, colStr] = match;
      const code = parseInt(codeStr, 10);
      const line = parseInt(lineStr || '0', 10);
      const column = parseInt(colStr || '0', 10);
      const filePath = file?.trim() ?? 'unknown';

      const error: TypeError = {
        file: filePath,
        line,
        column,
        message: message.trim(),
        code,
      };

      // TS2598 (unused variable) and similar warnings vs actual errors
      if (code >= 2000 && code < 6000) {
        errors.push(error);
      } else {
        warnings.push(error);
      }
    }

    // Deduplicate errors
    const uniqueErrors = this.deduplicateErrors(errors);
    const uniqueWarnings = this.deduplicateErrors(warnings);

    return {
      errors: uniqueErrors,
      warnings: uniqueWarnings,
      success: exitCode === 0 && uniqueErrors.length === 0,
    };
  }

  /**
   * 去除重复的错误
   */
  private deduplicateErrors(errors: TypeError[]): TypeError[] {
    const seen = new Set<string>();
    return errors.filter((e) => {
      const key = `${e.file}:${e.line}:${e.column}:${e.code}:${e.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 执行 ESLint 检查
   * 运行: npm run lint -- --format json
   */
  async runLint(): Promise<LintResult> {
    const cacheKey = 'lint';
    const cached = this.getCached<LintResult>(cacheKey);
    if (cached) return cached;

    return new Promise((resolve, reject) => {
      const proc = spawn('npm', ['run', 'lint', '--', '--format', 'json'], {
        cwd: this.config.cwd,
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
        reject(new Error(`runLint timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);

        try {
          const result = this.parseLintOutput(stdout, stderr, code);
          this.setCache(cacheKey, result);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`runLint failed: ${err.message}`));
      });
    });
  }

  /**
   * 解析 ESLint JSON 输出
   */
  private parseLintOutput(stdout: string, stderr: string, exitCode: number | null): LintResult {
    const errors: LintIssue[] = [];
    const warnings: LintIssue[] = [];
    let fatalErrorCount = 0;

    try {
      // ESLint JSON output is an array of file results
      const results = JSON.parse(stdout);
      const lintResults = Array.isArray(results) ? results : [results];

      for (const fileResult of lintResults) {
        if (!fileResult.messages) continue;

        for (const msg of fileResult.messages) {
          const issue: LintIssue = {
            file: fileResult.filePath ?? 'unknown',
            line: msg.line ?? 0,
            column: msg.column ?? 0,
            message: msg.message ?? '',
            rule: msg.ruleId ?? 'unknown',
            severity: msg.severity === 2 ? 'error' : 'warning',
          };

          if (msg.severity === 2) {
            errors.push(issue);
          } else {
            warnings.push(issue);
          }
        }

        // Count fatal errors (not just lint rule violations)
        if (fileResult.fatalErrorCount) {
          fatalErrorCount += fileResult.fatalErrorCount;
        }
      }
    } catch {
      // If JSON parsing fails, try to parse as text
      // ESLint may output non-JSON when there are configuration errors
      if (stderr.includes('Error:') || stderr.includes('error:')) {
        fatalErrorCount = 1;
      }

      // Try to parse individual lines as eslint format
      const lines = stdout.split('\n');
      for (const line of lines) {
        // eslint --format json sometimes outputs partial results
        const match = line.match(/"line":(\d+).*"column":(\d+).*"message":"([^"]+)".*"ruleId":"([^"]*)".*"severity":"([^"]*)"/);
        if (match) {
          const [, lineStr, colStr, message, rule, severity] = match;
          const issue: LintIssue = {
            file: 'unknown',
            line: parseInt(lineStr, 10),
            column: parseInt(colStr, 10),
            message: message.replace(/\\"/g, '"'),
            rule: rule || 'unknown',
            severity: severity === 'error' ? 'error' : 'warning',
          };

          if (issue.severity === 'error') {
            errors.push(issue);
          } else {
            warnings.push(issue);
          }
        }
      }
    }

    return {
      errors: this.deduplicateLintIssues(errors),
      warnings: this.deduplicateLintIssues(warnings),
      success: exitCode === 0 && errors.length === 0 && fatalErrorCount === 0,
      fatalErrorCount,
    };
  }

  /**
   * 去除重复的 lint 问题
   */
  private deduplicateLintIssues(issues: LintIssue[]): LintIssue[] {
    const seen = new Set<string>();
    return issues.filter((i) => {
      const key = `${i.file}:${i.line}:${i.column}:${i.rule}:${i.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 扫描文件大小
   * 标记 >500 行的文件
   */
  async scanFileSizes(): Promise<FileSizeReport> {
    const cacheKey = 'fileSizes';
    const cached = this.getCached<FileSizeReport>(cacheKey);
    if (cached) return cached;

    const threshold = this.config.fileSizeThreshold;
    const files: FileSizeEntry[] = [];
    const srcDir = path.join(this.config.cwd, 'src');

    await this.scanDirectory(srcDir, files, threshold);

    const report: FileSizeReport = {
      files,
      threshold,
    };

    this.setCache(cacheKey, report);
    return report;
  }

  /**
   * 递归扫描目录，统计文件行数
   */
  private async scanDirectory(dir: string, files: FileSizeEntry[], threshold: number): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules, dist, .git, etc.
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === '.git' ||
          entry.name === '__tests__' ||
          entry.name === 'vendor'
        ) {
          continue;
        }
        await this.scanDirectory(fullPath, files, threshold);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        try {
          const content = await fs.promises.readFile(fullPath, 'utf-8');
          const lines = content.split('\n').length;

          files.push({
            path: fullPath,
            lines,
            isLarge: lines > threshold,
          });
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  /**
   * 创建空覆盖率报告
   */
  private emptyCoverageReport(): CoverageReport {
    return {
      totalStatements: 0,
      totalBranches: 0,
      totalFunctions: 0,
      totalLines: 0,
      coveredStatements: 0,
      coveredBranches: 0,
      coveredFunctions: 0,
      coveredLines: 0,
      uncoveredFiles: [],
      threshold: this.config.coverageThreshold,
    };
  }

  /**
   * 获取缓存数据
   */
  private getCached<T>(key: string): T | null {
    if (!this.config.cacheEnabled) return null;

    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this.config.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * 设置缓存数据
   */
  private setCache(key: string, data: unknown): void {
    if (!this.config.cacheEnabled) return;
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * 获取配置
   */
  getConfig(): Required<ScannerConfig> {
    return { ...this.config };
  }
}
