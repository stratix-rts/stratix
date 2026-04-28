import { CodeSandboxSkillExecutor } from '@/stratix-agent/core/executors/CodeSandboxSkillExecutor';
import { SkillDefinition, ExecutionContext } from '@/stratix-agent/types';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';

jest.mock('child_process');
jest.mock('fs/promises');

describe('CodeSandboxSkillExecutor', () => {
  let executor: CodeSandboxSkillExecutor;
  let mockSkill: SkillDefinition;
  let mockContext: ExecutionContext;
  let progressCallbacks: any[];

  beforeEach(() => {
    executor = new CodeSandboxSkillExecutor();
    mockSkill = {
      skillId: 'code_execute',
      name: 'Code Execute',
      description: 'Execute code in sandbox',
      parameters: [],
      executor: 'sandbox',
    };
    progressCallbacks = [];
    mockContext = {
      agentId: 'test-agent',
      progressCallback: (p: any) => progressCallbacks.push(p),
    };
    jest.clearAllMocks();
  });

  describe('JavaScript execution', () => {
    test('executes simple expression', async () => {
      const result = await executor.execute(mockSkill, { code: '2 + 3', language: 'javascript' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
    });

    test('executes code with console.log', async () => {
      const result = await executor.execute(mockSkill, {
        code: 'console.log("hello"); return 42;',
        language: 'javascript'
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.logs).toContain('hello');
      expect(result.result).toBe(42);
    });

    test('auto-wraps single expression with return', async () => {
      const result = await executor.execute(mockSkill, { code: 'Math.sqrt(16)', language: 'javascript' }, mockContext);

      expect(result.result).toBe(4);
    });

    test('handles multiple statements', async () => {
      const result = await executor.execute(mockSkill, {
        code: 'const x = 10; const y = 20; return x + y;',
        language: 'javascript'
      }, mockContext);

      expect(result.result).toBe(30);
    });

    test('captures console.error and console.warn', async () => {
      const result = await executor.execute(mockSkill, {
        code: 'console.error("err"); console.warn("warn"); console.info("info"); console.debug("debug"); 1',
        language: 'javascript'
      }, mockContext);

      expect(result.logs).toContain('[error] err');
      expect(result.logs).toContain('[warn] warn');
      expect(result.logs).toContain('[info] info');
      expect(result.logs).toContain('[debug] debug');
    });

    test('rejects forbidden global: process', async () => {
      await expect(executor.execute(mockSkill, {
        code: 'process.exit(0)',
        language: 'javascript'
      }, mockContext)).rejects.toThrow('JavaScript validation failed');
    });

    test('rejects forbidden global: eval', async () => {
      await expect(executor.execute(mockSkill, {
        code: 'eval("1+1")',
        language: 'javascript'
      }, mockContext)).rejects.toThrow('JavaScript validation failed');
    });

    test('rejects dangerous pattern: new Function', async () => {
      await expect(executor.execute(mockSkill, {
        code: 'new Function("return 1")',
        language: 'javascript'
      }, mockContext)).rejects.toThrow('JavaScript validation failed');
    });

    test('rejects dangerous pattern: __proto__', async () => {
      await expect(executor.execute(mockSkill, {
        code: '({}).__proto__',
        language: 'javascript'
      }, mockContext)).rejects.toThrow('JavaScript validation failed');
    });

    test('rejects code exceeding max length', async () => {
      const longCode = '1 + 1;'.repeat(10000);
      await expect(executor.execute(mockSkill, {
        code: longCode,
        language: 'javascript'
      }, mockContext)).rejects.toThrow('Code too long');
    });

    test('handles runtime errors', async () => {
      await expect(executor.execute(mockSkill, {
        code: 'throw new Error("oops");',
        language: 'javascript'
      }, mockContext)).rejects.toThrow('JavaScript execution failed');
    });

    test('handles async Promise rejection', async () => {
      await expect(executor.execute(mockSkill, {
        code: 'Promise.reject(new Error("async error"))',
        language: 'javascript'
      }, mockContext)).rejects.toThrow('Execution error');
    });

    test('handles async Promise resolution', async () => {
      const result = await executor.execute(mockSkill, {
        code: 'Promise.resolve(123)',
        language: 'javascript'
      }, mockContext);

      expect(result.result).toBe(123);
    });

    test('truncates output when exceeding maxOutputSize', async () => {
      const contextWithSmallOutput = {
        ...mockContext,
        sandboxConfig: { maxOutputSize: 20 },
      };

      const result = await executor.execute(mockSkill, {
        code: 'console.log("this is a very long message"); 1',
        language: 'javascript'
      }, contextWithSmallOutput);

      expect(result.logs).toContain('[output truncated]');
    });

    test('sends progress callbacks', async () => {
      await executor.execute(mockSkill, { code: '1 + 1', language: 'javascript' }, mockContext);

      expect(progressCallbacks.length).toBeGreaterThanOrEqual(1);
      expect(progressCallbacks[0].stage).toBe('started');
    });

    test('times out on long-running Promise', async () => {
      jest.useFakeTimers();

      const promise = executor.execute(mockSkill, {
        code: 'new Promise(() => {})',
        language: 'javascript'
      }, mockContext);

      jest.advanceTimersByTime(11000);

      await expect(promise).rejects.toThrow('timeout');

      jest.useRealTimers();
    });
  });

  describe('Python execution', () => {
    test('executes Python successfully', async () => {
      const mockProc = createMockChildProcess();
      (spawn as unknown as jest.Mock).mockReturnValue(mockProc);
      (writeFile as jest.Mock).mockResolvedValue(undefined);
      (unlink as jest.Mock).mockResolvedValue(undefined);

      const promise = executor.execute(mockSkill, { code: 'print("hello")', language: 'python' }, mockContext);

      // Allow async IIFE to register event handlers after writeFile resolves
      await Promise.resolve();
      await Promise.resolve();

      // Simulate successful execution
      mockProc.stdout.emit('data', Buffer.from('hello\n'));
      mockProc.emit('close', 0);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.result).toBe('hello');
      expect(writeFile).toHaveBeenCalled();
    });

    test('rejects when Python exits with error', async () => {
      const mockProc = createMockChildProcess();
      (spawn as unknown as jest.Mock).mockReturnValue(mockProc);
      (writeFile as jest.Mock).mockResolvedValue(undefined);
      (unlink as jest.Mock).mockResolvedValue(undefined);

      const promise = executor.execute(mockSkill, { code: 'print(undefined_var)', language: 'python' }, mockContext);

      await Promise.resolve();
      await Promise.resolve();

      mockProc.stderr.emit('data', Buffer.from('NameError: name undefined_var is not defined'));
      mockProc.emit('close', 1);

      await expect(promise).rejects.toThrow('Python execution failed');
    });

    test('rejects forbidden Python import', async () => {
      await expect(executor.execute(mockSkill, {
        code: 'import os',
        language: 'python'
      }, mockContext)).rejects.toThrow('Python validation failed');
    });

    test('rejects forbidden Python from import', async () => {
      await expect(executor.execute(mockSkill, {
        code: 'from subprocess import call',
        language: 'python'
      }, mockContext)).rejects.toThrow('Python validation failed');
    });

    test('rejects dangerous Python pattern: eval', async () => {
      await expect(executor.execute(mockSkill, {
        code: 'eval("1+1")',
        language: 'python'
      }, mockContext)).rejects.toThrow('Python validation failed');
    });

    test('rejects dangerous Python pattern: open', async () => {
      await expect(executor.execute(mockSkill, {
        code: 'open("/etc/passwd")',
        language: 'python'
      }, mockContext)).rejects.toThrow('Python validation failed');
    });

    test('handles spawn error', async () => {
      const mockProc = createMockChildProcess();
      (spawn as unknown as jest.Mock).mockReturnValue(mockProc);
      (writeFile as jest.Mock).mockResolvedValue(undefined);
      (unlink as jest.Mock).mockResolvedValue(undefined);

      const promise = executor.execute(mockSkill, { code: 'print(1)', language: 'python' }, mockContext);

      await Promise.resolve();
      await Promise.resolve();

      mockProc.emit('error', new Error('spawn ENOENT'));

      await expect(promise).rejects.toThrow('Python spawn error');
    });

    test('truncates output when exceeding maxOutputSize', async () => {
      const mockProc = createMockChildProcess();
      (spawn as unknown as jest.Mock).mockReturnValue(mockProc);
      (writeFile as jest.Mock).mockResolvedValue(undefined);
      (unlink as jest.Mock).mockResolvedValue(undefined);

      const contextWithSmallOutput = {
        ...mockContext,
        sandboxConfig: { maxOutputSize: 10 },
      };

      const promise = executor.execute(mockSkill, { code: 'print("hello world")', language: 'python' }, contextWithSmallOutput);

      await Promise.resolve();
      await Promise.resolve();

      mockProc.stdout.emit('data', Buffer.from('hello world!!!'));
      mockProc.emit('close', 0);

      const result = await promise;

      // Both result and preview are truncated to maxOutputSize bytes
      expect(result.result.length).toBeLessThanOrEqual(10);
      expect(result.preview.content.length).toBeLessThanOrEqual(10);
    });

    test('cleans up temp file on success', async () => {
      const mockProc = createMockChildProcess();
      (spawn as unknown as jest.Mock).mockReturnValue(mockProc);
      (writeFile as jest.Mock).mockResolvedValue(undefined);
      (unlink as jest.Mock).mockResolvedValue(undefined);

      const promise = executor.execute(mockSkill, { code: 'print(1)', language: 'python' }, mockContext);

      await Promise.resolve();
      await Promise.resolve();

      mockProc.stdout.emit('data', Buffer.from('1\n'));
      mockProc.emit('close', 0);

      await promise;

      expect(unlink).toHaveBeenCalled();
    });

    test('cleans up temp file on error', async () => {
      const mockProc = createMockChildProcess();
      (spawn as unknown as jest.Mock).mockReturnValue(mockProc);
      (writeFile as jest.Mock).mockResolvedValue(undefined);
      (unlink as jest.Mock).mockResolvedValue(undefined);

      const promise = executor.execute(mockSkill, { code: 'print(1)', language: 'python' }, mockContext);

      await Promise.resolve();
      await Promise.resolve();

      mockProc.emit('error', new Error('spawn error'));

      try { await promise; } catch { /* expected */ }

      expect(unlink).toHaveBeenCalled();
    });
  });

  describe('unsupported language', () => {
    test('throws for unsupported language', async () => {
      await expect(executor.execute(mockSkill, { code: 'print(1)', language: 'ruby' }, mockContext))
        .rejects.toThrow('Unsupported language');
    });
  });
});

// Helper to create a mock ChildProcess with EventEmitter-like interface
function createMockChildProcess() {
  const handlers: Record<string, Function[]> = {};

  const proc = {
    stdout: {
      on: (event: string, cb: Function) => {
        handlers[`stdout:${event}`] = handlers[`stdout:${event}`] || [];
        handlers[`stdout:${event}`].push(cb);
      },
      emit: (event: string, data: any) => {
        (handlers[`stdout:${event}`] || []).forEach(cb => cb(data));
      },
    },
    stderr: {
      on: (event: string, cb: Function) => {
        handlers[`stderr:${event}`] = handlers[`stderr:${event}`] || [];
        handlers[`stderr:${event}`].push(cb);
      },
      emit: (event: string, data: any) => {
        (handlers[`stderr:${event}`] || []).forEach(cb => cb(data));
      },
    },
    on: (event: string, cb: Function) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
    },
    emit: (event: string, ...args: any[]) => {
      (handlers[event] || []).forEach(cb => cb(...args));
    },
  };

  return proc as any;
}
