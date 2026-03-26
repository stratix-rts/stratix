import type { AgentExecutor, ExecutorResult, ExecutorOptions } from '@/stratix-core/executor/AgentExecutor';
import { OpenClawExecutor } from '@/stratix-core/executor/OpenClawExecutor';
import { StratixAgentExecutor } from '@/stratix-core/executor/StratixAgentExecutor';
import type { StratixCommandData, StratixAgentConfig } from '@/stratix-core/stratix-protocol';

/**
 * AgentExecutor is an interface that defines the contract for all executor implementations.
 * These tests verify that the concrete implementations (OpenClawExecutor, StratixAgentExecutor)
 * properly implement the interface contract.
 */
describe('AgentExecutor Interface', () => {
  /**
   * Helper to verify an object implements the AgentExecutor interface
   */
  function implementsAgentExecutor(executor: any): executor is AgentExecutor {
    return (
      typeof executor.execute === 'function' &&
      typeof executor.validate === 'function' &&
      typeof executor.testConnection === 'function'
    );
  }

  describe('OpenClawExecutor implements AgentExecutor', () => {
    let executor: OpenClawExecutor;

    beforeEach(() => {
      executor = new OpenClawExecutor();
    });

    test('has execute method', () => {
      expect(typeof executor.execute).toBe('function');
    });

    test('has validate method', () => {
      expect(typeof executor.validate).toBe('function');
    });

    test('has testConnection method', () => {
      expect(typeof executor.testConnection).toBe('function');
    });

    test('implements AgentExecutor interface', () => {
      expect(implementsAgentExecutor(executor)).toBe(true);
    });

    test('execute returns Promise<ExecutorResult>', async () => {
      const agentConfig: StratixAgentConfig = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {} as any,
        backendType: 'openclaw',
        openClawConfig: {
          endpoint: 'http://localhost:8080',
          accountId: 'account-1',
        },
        configStatus: 'ready',
      };

      const command: StratixCommandData = {
        commandId: 'cmd-1',
        skillId: 'test-skill',
        agentId: 'agent-1',
        params: {},
        executeAt: Date.now(),
      };

      const result = await executor.execute(command, agentConfig);

      // Verify result structure matches ExecutorResult
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
      if (!result.success) {
        expect(result).toHaveProperty('error');
        expect(typeof result.error).toBe('string');
      }
    });

    test('validate returns { valid: boolean; errors: string[] }', () => {
      const agentConfig: StratixAgentConfig = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {} as any,
        backendType: 'openclaw',
        configStatus: 'ready',
      };

      const command: StratixCommandData = {
        commandId: 'cmd-1',
        skillId: 'test-skill',
        agentId: 'agent-1',
        params: {},
        executeAt: Date.now(),
      };

      const result = executor.validate(command, agentConfig);

      expect(result).toHaveProperty('valid');
      expect(typeof result.valid).toBe('boolean');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    test('testConnection returns Promise<{ success: boolean; message: string }>', async () => {
      const agentConfig: StratixAgentConfig = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {} as any,
        backendType: 'openclaw',
        configStatus: 'ready',
      };

      const result = await executor.testConnection(agentConfig);

      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
      expect(result).toHaveProperty('message');
      expect(typeof result.message).toBe('string');
    });
  });

  describe('StratixAgentExecutor implements AgentExecutor', () => {
    let executor: StratixAgentExecutor;

    beforeEach(() => {
      executor = new StratixAgentExecutor();
    });

    test('has execute method', () => {
      expect(typeof executor.execute).toBe('function');
    });

    test('has validate method', () => {
      expect(typeof executor.validate).toBe('function');
    });

    test('has testConnection method', () => {
      expect(typeof executor.testConnection).toBe('function');
    });

    test('implements AgentExecutor interface', () => {
      expect(implementsAgentExecutor(executor)).toBe(true);
    });

    test('execute returns Promise<ExecutorResult>', async () => {
      const agentConfig: StratixAgentConfig = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {} as any,
        backendType: 'stratix',
        stratixConfig: {
          provider: 'openai',
          model: 'gpt-4',
          apiKey: 'test-key',
        },
        configStatus: 'ready',
      };

      const command: StratixCommandData = {
        commandId: 'cmd-1',
        skillId: 'test-skill',
        agentId: 'agent-1',
        params: {},
        executeAt: Date.now(),
      };

      // Mock fetch for this test
      const mockFetch = jest.fn();
      global.fetch = mockFetch;
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'test response' } }],
          }),
      });

      const result = await executor.execute(command, agentConfig);

      // Verify result structure matches ExecutorResult
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
      if (!result.success) {
        expect(result).toHaveProperty('error');
        expect(typeof result.error).toBe('string');
      }
    });

    test('validate returns { valid: boolean; errors: string[] }', () => {
      const agentConfig: StratixAgentConfig = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {} as any,
        backendType: 'stratix',
        stratixConfig: {
          provider: 'openai',
          model: 'gpt-4',
          apiKey: 'test-key',
        },
        configStatus: 'ready',
      };

      const command: StratixCommandData = {
        commandId: 'cmd-1',
        skillId: 'test-skill',
        agentId: 'agent-1',
        params: {},
        executeAt: Date.now(),
      };

      const result = executor.validate(command, agentConfig);

      expect(result).toHaveProperty('valid');
      expect(typeof result.valid).toBe('boolean');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    test('testConnection returns Promise<{ success: boolean; message: string }>', async () => {
      const agentConfig: StratixAgentConfig = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {} as any,
        backendType: 'stratix',
        stratixConfig: {
          provider: 'openai',
          model: 'gpt-4',
          apiKey: 'test-key',
        },
        configStatus: 'ready',
      };

      // Mock fetch for this test
      const mockFetch = jest.fn();
      global.fetch = mockFetch;
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'test' } }],
          }),
      });

      const result = await executor.testConnection(agentConfig);

      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
      expect(result).toHaveProperty('message');
      expect(typeof result.message).toBe('string');
    });
  });
});

describe('ExecutorResult interface', () => {
  test('ExecutorResult should have success boolean', () => {
    const result: ExecutorResult = { success: true };
    expect(result.success).toBe(true);
  });

  test('ExecutorResult should have optional data', () => {
    const result: ExecutorResult = { success: true, data: { key: 'value' } };
    expect(result.data).toEqual({ key: 'value' });
  });

  test('ExecutorResult should have optional error string', () => {
    const result: ExecutorResult = { success: false, error: 'Something went wrong' };
    expect(result.error).toBe('Something went wrong');
  });

  test('ExecutorResult should have optional usage info', () => {
    const result: ExecutorResult = {
      success: true,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    };
    expect(result.usage?.totalTokens).toBe(150);
  });
});

describe('ExecutorOptions interface', () => {
  test('ExecutorOptions should have optional stream boolean', () => {
    const options: ExecutorOptions = { stream: true };
    expect(options.stream).toBe(true);
  });

  test('ExecutorOptions should have optional onChunk callback', () => {
    const onChunk = jest.fn();
    const options: ExecutorOptions = { onChunk };
    expect(options.onChunk).toBe(onChunk);
  });

  test('ExecutorOptions should have optional timeout number', () => {
    const options: ExecutorOptions = { timeout: 30000 };
    expect(options.timeout).toBe(30000);
  });

  test('ExecutorOptions should have optional history array', () => {
    const history = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ];
    const options: ExecutorOptions = { history };
    expect(options.history).toEqual(history);
  });
});
