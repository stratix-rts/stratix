/**
 * TestRunner.test.ts - 测试执行与验证
 * Phase 2: Step 4 - TestRunner 测试验证器
 */

import { EventEmitter } from 'events';

// -------------------------------------------------------------------------
// Mock child_process with proper Jest mock
// -------------------------------------------------------------------------
class MockChildProcess extends EventEmitter {
  stdout = new MockReadable();
  stderr = new MockReadable();
  kill = jest.fn();
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
import { TestRunner, CoverageReport } from '../TestRunner';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('TestRunner', () => {
  let runner: TestRunner;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock proc state
    mockProc.kill.mockClear();
    mockProc.stdout.on.mockClear();
    mockProc.stderr.on.mockClear();

    runner = new TestRunner(5000);
  });

  // -------------------------------------------------------------------------
  // Helper to simulate spawn output
  // -------------------------------------------------------------------------
  const simulateSpawnOutput = (
    stdout: string,
    stderr: string,
    exitCode: number | null = 0
  ) => {
    if (stdout) {
      mockProc.stdout.emit('data', stdout);
    }
    if (stderr) {
      mockProc.stderr.emit('data', stderr);
    }
    mockProc.emit('close', exitCode);
  };

  describe('runTests', () => {
    it('runs tests in the specified directory', async () => {
      const workDir = '/fake/project';

      const jestOutput = JSON.stringify({
        numTotalTests: 10,
        numPassedTests: 8,
        numFailedTests: 1,
        numPendingTests: 1,
        results: [
          {
            assertionResults: [
              {
                title: 'should pass',
                status: 'passed',
                failureMessages: [],
                location: '/fake/project/src/utils.test.ts:10',
              },
              {
                title: 'should fail',
                status: 'failed',
                failureMessages: ['Error: expected 1 to equal 2'],
                location: '/fake/project/src/utils.test.ts:20',
              },
            ],
            status: 'failed',
          },
        ],
      });

      const promise = runner.runTests(workDir);
      simulateSpawnOutput(jestOutput, '', 1);
      const result = await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['test', '--', '--coverage', '--json', '--testPathIgnorePatterns='],
        expect.objectContaining({ cwd: workDir })
      );
      expect(result.passed).toBe(false);
      expect(result.totalTests).toBe(10);
      expect(result.passedTests).toBe(8);
      expect(result.failedTests).toBe(1);
      expect(result.skippedTests).toBe(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].testName).toBe('should fail');
    });

    it('returns passed=true when all tests pass', async () => {
      const jestOutput = JSON.stringify({
        numTotalTests: 5,
        numPassedTests: 5,
        numFailedTests: 0,
        numPendingTests: 0,
        results: [],
      });

      const promise = runner.runTests('/fake/project');
      simulateSpawnOutput(jestOutput, '', 0);
      const result = await promise;

      expect(result.passed).toBe(true);
      expect(result.failedTests).toBe(0);
      expect(result.failures).toHaveLength(0);
    });

    it('handles empty stdout gracefully', async () => {
      const promise = runner.runTests('/fake/project');
      simulateSpawnOutput('', '', 0);
      const result = await promise;

      expect(result.passed).toBe(true);
      expect(result.totalTests).toBe(0);
    });

    it('captures test duration', async () => {
      jest.useRealTimers();

      const jestOutput = JSON.stringify({
        numTotalTests: 3,
        numPassedTests: 3,
        numFailedTests: 0,
        numPendingTests: 0,
        results: [],
      });

      const start = Date.now();
      const promise = runner.runTests('/fake/project');
      simulateSpawnOutput(jestOutput, '', 0);
      const result = await promise;

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('parses multiple failure messages', async () => {
      const jestOutput = JSON.stringify({
        numTotalTests: 10,
        numPassedTests: 7,
        numFailedTests: 3,
        numPendingTests: 0,
        results: [
          {
            assertionResults: [
              {
                title: 'test 1',
                status: 'failed',
                failureMessages: ['Error: test 1 failed'],
                location: 'file1.test.ts:5',
              },
              {
                title: 'test 2',
                status: 'failed',
                failureMessages: ['Error: test 2 failed', 'Error: second error'],
                location: 'file2.test.ts:10',
              },
              {
                title: 'test 3',
                status: 'failed',
                failureMessages: ['Error: test 3 failed'],
                location: 'file3.test.ts:15',
              },
            ],
            status: 'failed',
          },
        ],
      });

      const promise = runner.runTests('/fake/project');
      simulateSpawnOutput(jestOutput, '', 1);
      const result = await promise;

      expect(result.failures).toHaveLength(3);
      expect(result.failures[1].errorMessage).toContain('test 2 failed');
      expect(result.failures[1].errorMessage).toContain('second error');
    });
  });

  describe('runTestsForFiles', () => {
    it('runs tests for specific files', async () => {
      const workDir = '/fake/project';
      const files = ['src/utils.test.ts', 'src/helper.test.ts'];

      const jestOutput = JSON.stringify({
        numTotalTests: 5,
        numPassedTests: 5,
        numFailedTests: 0,
        numPendingTests: 0,
        results: [],
      });

      const promise = runner.runTestsForFiles(workDir, files);
      simulateSpawnOutput(jestOutput, '', 0);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['--testPathPattern=utils.test.ts|helper.test.ts']),
        expect.objectContaining({ cwd: workDir })
      );
    });

    it('handles single file', async () => {
      const jestOutput = JSON.stringify({
        numTotalTests: 2,
        numPassedTests: 2,
        numFailedTests: 0,
        numPendingTests: 0,
        results: [],
      });

      const promise = runner.runTestsForFiles('/fake/project', ['src/single.test.ts']);
      simulateSpawnOutput(jestOutput, '', 0);
      const result = await promise;

      expect(result.passed).toBe(true);
    });

    it('handles empty file list', async () => {
      const jestOutput = JSON.stringify({
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        numPendingTests: 0,
        results: [],
      });

      const promise = runner.runTestsForFiles('/fake/project', []);
      simulateSpawnOutput(jestOutput, '', 0);
      const result = await promise;

      expect(result.totalTests).toBe(0);
    });
  });

  describe('getCoverage', () => {
    it('parses coverage from JSON output', async () => {
      const coverageOutput = JSON.stringify({
        lines: 75.5,
        statements: 80.0,
        branches: 60.0,
        functions: 90.0,
      });

      const promise = runner.getCoverage('/fake/project');
      simulateSpawnOutput(coverageOutput, '', 0);
      const report = await promise;

      expect(report.lines).toBe(75.5);
      expect(report.statements).toBe(80.0);
      expect(report.branches).toBe(60.0);
      expect(report.functions).toBe(90.0);
      expect(report.timestamp).toBeInstanceOf(Date);
    });

    it('extracts coverage from coverageMap when no summary', async () => {
      const coverageOutput = JSON.stringify({
        coverageMap: {
          '/fake/project/src/utils.ts': {
            statementCount: 10,
            hitCount: 8,
            branchCount: 4,
            hitBranchCount: 2,
            fnCount: 5,
            hitFnCount: 4,
            lines: { '1': 1, '2': 1, '3': 0, '4': 1 },
          },
          '/fake/project/src/main.ts': {
            statementCount: 5,
            hitCount: 5,
            branchCount: 2,
            hitBranchCount: 2,
            fnCount: 2,
            hitFnCount: 2,
            lines: { '1': 1, '2': 1 },
          },
        },
      });

      const promise = runner.getCoverage('/fake/project');
      simulateSpawnOutput(coverageOutput, '', 0);
      const report = await promise;

      // utils.ts: 8/10 statements = 80%, 2/4 branches = 50%, 4/5 fns = 80%, 3/4 lines = 75%
      // main.ts: 5/5 statements = 100%, 2/2 branches = 100%, 2/2 fns = 100%, 2/2 lines = 100%
      // Combined: (8+5)/(10+5) = 86.67%, (2+2)/(4+2) = 66.67%, (4+2)/(5+2) = 85.71%, (3+2)/(4+2) = 83.33%
      expect(report.statements).toBeCloseTo(86.67, 1);
      expect(report.branches).toBeCloseTo(66.67, 1);
      expect(report.functions).toBeCloseTo(85.71, 1);
      expect(report.lines).toBeCloseTo(83.33, 1);
    });

    it('returns zero coverage when no coverage data', async () => {
      const promise = runner.getCoverage('/fake/project');
      simulateSpawnOutput('', '', 0);
      const report = await promise;

      expect(report.lines).toBe(0);
      expect(report.statements).toBe(0);
      expect(report.branches).toBe(0);
      expect(report.functions).toBe(0);
    });

    it('throws error when coverage parsing fails with non-zero exit', async () => {
      const promise = runner.getCoverage('/fake/project');
      simulateSpawnOutput('invalid json', '', 1);

      await expect(promise).rejects.toThrow('Failed to parse coverage output');
    });
  });

  describe('compareCoverage', () => {
    it('calculates positive delta correctly', () => {
      const before: CoverageReport = {
        lines: 70,
        statements: 75,
        branches: 60,
        functions: 80,
        timestamp: new Date(),
      };
      const after: CoverageReport = {
        lines: 80,
        statements: 85,
        branches: 70,
        functions: 90,
        timestamp: new Date(),
      };

      const delta = runner.compareCoverage(before, after);

      expect(delta.lines).toBe(10);
      expect(delta.statements).toBe(10);
      expect(delta.branches).toBe(10);
      expect(delta.functions).toBe(10);
    });

    it('calculates negative delta correctly', () => {
      const before: CoverageReport = {
        lines: 80,
        statements: 85,
        branches: 70,
        functions: 90,
        timestamp: new Date(),
      };
      const after: CoverageReport = {
        lines: 70,
        statements: 75,
        branches: 60,
        functions: 80,
        timestamp: new Date(),
      };

      const delta = runner.compareCoverage(before, after);

      expect(delta.lines).toBe(-10);
      expect(delta.statements).toBe(-10);
      expect(delta.branches).toBe(-10);
      expect(delta.functions).toBe(-10);
    });

    it('handles zero delta', () => {
      const report: CoverageReport = {
        lines: 75,
        statements: 80,
        branches: 65,
        functions: 85,
        timestamp: new Date(),
      };

      const delta = runner.compareCoverage(report, report);

      expect(delta.lines).toBe(0);
      expect(delta.statements).toBe(0);
      expect(delta.branches).toBe(0);
      expect(delta.functions).toBe(0);
    });

    it('rounds delta to two decimal places', () => {
      const before: CoverageReport = {
        lines: 66.666,
        statements: 77.777,
        branches: 55.555,
        functions: 88.888,
        timestamp: new Date(),
      };
      const after: CoverageReport = {
        lines: 77.777,
        statements: 88.888,
        branches: 66.666,
        functions: 99.999,
        timestamp: new Date(),
      };

      const delta = runner.compareCoverage(before, after);

      expect(delta.lines).toBe(11.11);
      expect(delta.statements).toBe(11.11);
      expect(delta.branches).toBe(11.11);
      expect(delta.functions).toBe(11.11);
    });
  });

  describe('timeout protection', () => {
    it('kills process on timeout', async () => {
      jest.useFakeTimers();

      const promise = runner.runTests('/fake/project');
      jest.advanceTimersByTime(6000);

      await expect(promise).rejects.toThrow(/timed out/);
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });

    it('kills coverage process on timeout', async () => {
      jest.useFakeTimers();

      const promise = runner.getCoverage('/fake/project');
      jest.advanceTimersByTime(6000);

      await expect(promise).rejects.toThrow(/timed out/);
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });
  });

  describe('custom timeout', () => {
    it('uses custom timeout value', async () => {
      const customRunner = new TestRunner(30000);

      jest.useFakeTimers();

      const promise = customRunner.runTests('/fake/project');
      jest.advanceTimersByTime(31000);

      await expect(promise).rejects.toThrow(/timed out/);

      jest.useRealTimers();
    });
  });
});
