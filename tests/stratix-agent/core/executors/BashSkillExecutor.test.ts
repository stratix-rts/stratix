import { BashSkillExecutor } from '@/stratix-agent/core/executors/BashSkillExecutor';
import { SkillDefinition, ExecutionContext } from '@/stratix-agent/types';
import { exec } from 'child_process';
import { SafetyValidator } from '@/stratix-agent/core/SafetyValidator';

jest.mock('child_process');
jest.mock('@/stratix-agent/core/SafetyValidator');

describe('BashSkillExecutor', () => {
  let executor: BashSkillExecutor;
  let mockSkill: SkillDefinition;
  let mockContext: ExecutionContext;
  let progressCallbacks: any[];

  beforeEach(() => {
    executor = new BashSkillExecutor();
    mockSkill = {
      skillId: 'bash_exec',
      name: 'Bash Execute',
      description: 'Execute bash commands',
      parameters: [],
      executor: 'bash',
    };
    progressCallbacks = [];
    mockContext = {
      agentId: 'test-agent',
      progressCallback: (p: any) => progressCallbacks.push(p),
    };
    jest.clearAllMocks();
  });

  describe('successful execution', () => {
    test('executes command and returns stdout', async () => {
      (SafetyValidator.validateBashCommand as jest.Mock).mockReturnValue({ valid: true });
      (exec as unknown as jest.Mock).mockImplementation((cmd: string, opts: any, callback: any) => {
        callback(null, 'hello world\n', '');
      });

      const result = await executor.execute(mockSkill, { command: 'echo hello world' }, mockContext);

      expect(result.stdout).toBe('hello world');
      expect(result.stderr).toBe('');
      expect(result.success).toBe(true);
      expect(result.preview.type).toBe('text');
      expect(result.preview.content).toBe('hello world');
    });

    test('trims stdout and stderr', async () => {
      (SafetyValidator.validateBashCommand as jest.Mock).mockReturnValue({ valid: true });
      (exec as unknown as jest.Mock).mockImplementation((cmd: string, opts: any, callback: any) => {
        callback(null, '  output  ', '  error  ');
      });

      const result = await executor.execute(mockSkill, { command: 'some-cmd' }, mockContext);

      expect(result.stdout).toBe('output');
      expect(result.stderr).toBe('error');
    });

    test('sends progress callbacks', async () => {
      (SafetyValidator.validateBashCommand as jest.Mock).mockReturnValue({ valid: true });
      (exec as unknown as jest.Mock).mockImplementation((cmd: string, opts: any, callback: any) => {
        callback(null, 'done', '');
      });

      await executor.execute(mockSkill, { command: 'echo done' }, mockContext);

      expect(progressCallbacks).toHaveLength(2);
      expect(progressCallbacks[0].stage).toBe('processing');
      expect(progressCallbacks[1].stage).toBe('completed');
    });

    test('uses custom cwd when provided', async () => {
      (SafetyValidator.validateBashCommand as jest.Mock).mockReturnValue({ valid: true });
      (exec as unknown as jest.Mock).mockImplementation((cmd: string, opts: any, callback: any) => {
        callback(null, 'ok', '');
      });

      await executor.execute(mockSkill, { command: 'pwd', cwd: '/tmp' }, mockContext);

      expect(exec).toHaveBeenCalledWith(
        'pwd',
        expect.objectContaining({ cwd: '/tmp' }),
        expect.any(Function)
      );
    });

    test('caps timeout at 120 seconds', async () => {
      (SafetyValidator.validateBashCommand as jest.Mock).mockReturnValue({ valid: true });
      (exec as unknown as jest.Mock).mockImplementation((cmd: string, opts: any, callback: any) => {
        callback(null, 'ok', '');
      });

      await executor.execute(mockSkill, { command: 'sleep 1', timeout: 200 }, mockContext);

      expect(exec).toHaveBeenCalledWith(
        'sleep 1',
        expect.objectContaining({ timeout: 120000 }),
        expect.any(Function)
      );
    });

    test('uses provided timeout when under 120s', async () => {
      (SafetyValidator.validateBashCommand as jest.Mock).mockReturnValue({ valid: true });
      (exec as unknown as jest.Mock).mockImplementation((cmd: string, opts: any, callback: any) => {
        callback(null, 'ok', '');
      });

      await executor.execute(mockSkill, { command: 'sleep 1', timeout: 10 }, mockContext);

      expect(exec).toHaveBeenCalledWith(
        'sleep 1',
        expect.objectContaining({ timeout: 10000 }),
        expect.any(Function)
      );
    });
  });

  describe('command failure', () => {
    test('rejects when command errors', async () => {
      (SafetyValidator.validateBashCommand as jest.Mock).mockReturnValue({ valid: true });
      (exec as unknown as jest.Mock).mockImplementation((cmd: string, opts: any, callback: any) => {
        callback(new Error('Command not found'), '', 'bash: cmd: command not found');
      });

      await expect(executor.execute(mockSkill, { command: 'cmd' }, mockContext))
        .rejects.toThrow('Command failed');
    });

    test('sends failed progress on error', async () => {
      (SafetyValidator.validateBashCommand as jest.Mock).mockReturnValue({ valid: true });
      (exec as unknown as jest.Mock).mockImplementation((cmd: string, opts: any, callback: any) => {
        callback(new Error('fail'), '', 'stderr content');
      });

      try {
        await executor.execute(mockSkill, { command: 'bad-cmd' }, mockContext);
      } catch {
        // expected
      }

      const failedProgress = progressCallbacks.find(p => p.stage === 'failed');
      expect(failedProgress).toBeDefined();
    });
  });

  describe('safety validation', () => {
    test('blocks unsafe commands', async () => {
      (SafetyValidator.validateBashCommand as jest.Mock).mockReturnValue({
        valid: false,
        reason: 'Recursive delete (rm -rf)',
      });

      await expect(executor.execute(mockSkill, { command: 'rm -rf /' }, mockContext))
        .rejects.toThrow('Command blocked: Recursive delete (rm -rf)');

      expect(exec).not.toHaveBeenCalled();
    });

    test('passes context to SafetyValidator', async () => {
      (SafetyValidator.validateBashCommand as jest.Mock).mockReturnValue({ valid: true });
      (exec as unknown as jest.Mock).mockImplementation((cmd: string, opts: any, callback: any) => {
        callback(null, 'ok', '');
      });

      await executor.execute(mockSkill, { command: 'echo hello' }, mockContext);

      expect(SafetyValidator.validateBashCommand).toHaveBeenCalledWith('echo hello', mockContext);
    });
  });
});
