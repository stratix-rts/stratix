/**
 * CommandTransformer Unit Tests
 *
 * Tests for the CommandTransformer class which wraps ExecutorFactory
 * for command transformation and execution compatibility.
 */

import { CommandTransformer } from '@/stratix-gateway/command-transformer/CommandTransformer';
import { ExecutorFactory } from '@/stratix-core/executor/ExecutorFactory';
import type { AgentExecutor, ExecutorResult } from '@/stratix-core/executor/AgentExecutor';
import type { StratixCommandData, StratixAgentConfig } from '@/stratix-core/stratix-protocol';
import { ConnectionPool } from '@/stratix-openclaw-adapter';

// Mock the ExecutorFactory
jest.mock('@/stratix-core/executor/ExecutorFactory');
// Mock ConnectionPool
jest.mock('@/stratix-openclaw-adapter', () => ({
  ConnectionPool: jest.fn().mockImplementation(() => ({
    getConnection: jest.fn(),
    releaseConnection: jest.fn(),
  })),
}));

describe('CommandTransformer', () => {
  let mockExecutor: jest.Mocked<AgentExecutor>;
  let mockExecutorFactory: jest.Mocked<ExecutorFactory>;
  let mockConnectionPool: jest.Mocked<ConnectionPool>;

  const mockAgentConfig: StratixAgentConfig = {
    agentId: 'agent-1',
    name: 'Test Agent',
    type: 'dev',
    profile: {
      characterId: 'char-1',
      name: 'Test Character',
      bodyType: 'male',
      parts: {},
    },
    backendType: 'openclaw',
    openClawConfig: {
      endpoint: 'http://localhost:8080',
      accountId: 'account-1',
    },
    configStatus: 'ready',
  };

  const mockCommand: StratixCommandData = {
    commandId: 'cmd-1',
    skillId: 'skill-1',
    agentId: 'agent-1',
    params: { key: 'value' },
    executeAt: Date.now(),
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock executor
    mockExecutor = {
      execute: jest.fn(),
      validate: jest.fn(),
      testConnection: jest.fn(),
    } as any;

    // Create mock executor factory
    mockExecutorFactory = {
      getExecutor: jest.fn().mockReturnValue(mockExecutor),
      getExecutorByType: jest.fn(),
      getOpenClawExecutor: jest.fn(),
      getStratixAgentExecutor: jest.fn(),
    } as any;

    // Create mock connection pool
    mockConnectionPool = {
      getConnection: jest.fn(),
      releaseConnection: jest.fn(),
    } as any;

    // Setup ExecutorFactory.getInstance to return our mock
    (ExecutorFactory.getInstance as jest.Mock).mockReturnValue(mockExecutorFactory);
  });

  describe('constructor', () => {
    it('should create CommandTransformer with provided connection pool', () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      expect(transformer).toBeInstanceOf(CommandTransformer);
    });

    it('should create CommandTransformer without connection pool', () => {
      const transformer = new CommandTransformer();
      expect(transformer).toBeInstanceOf(CommandTransformer);
    });
  });

  describe('transformAndExecute', () => {
    it('should execute command and return data on success', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const expectedData = { result: 'success', data: { message: 'hello' } };
      const executorResult: ExecutorResult = {
        success: true,
        data: expectedData,
      };

      mockExecutor.execute.mockResolvedValue(executorResult);

      const result = await transformer.transformAndExecute(mockCommand, mockAgentConfig);

      expect(mockExecutorFactory.getExecutor).toHaveBeenCalledWith(mockAgentConfig);
      expect(mockExecutor.execute).toHaveBeenCalledWith(mockCommand, mockAgentConfig);
      expect(result).toEqual(expectedData);
    });

    it('should throw error when execution fails', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const executorResult: ExecutorResult = {
        success: false,
        error: 'Execution failed: command not found',
      };

      mockExecutor.execute.mockResolvedValue(executorResult);

      await expect(transformer.transformAndExecute(mockCommand, mockAgentConfig))
        .rejects.toThrow('Execution failed: command not found');
    });

    it('should throw generic error when execution fails without error message', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const executorResult: ExecutorResult = {
        success: false,
      };

      mockExecutor.execute.mockResolvedValue(executorResult);

      await expect(transformer.transformAndExecute(mockCommand, mockAgentConfig))
        .rejects.toThrow('Execution failed');
    });

    it('should pass correct parameters to executor', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const executorResult: ExecutorResult = { success: true, data: {} };
      mockExecutor.execute.mockResolvedValue(executorResult);

      await transformer.transformAndExecute(mockCommand, mockAgentConfig);

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        mockCommand,
        mockAgentConfig
      );
    });
  });

  describe('executeWithResult', () => {
    it('should return ExecutorResult directly', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const executorResult: ExecutorResult = {
        success: true,
        data: { answer: 42 },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };

      mockExecutor.execute.mockResolvedValue(executorResult);

      const result = await transformer.executeWithResult(mockCommand, mockAgentConfig);

      expect(result).toEqual(executorResult);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ answer: 42 });
      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
    });

    it('should return failed result without throwing', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const executorResult: ExecutorResult = {
        success: false,
        error: 'some error',
      };

      mockExecutor.execute.mockResolvedValue(executorResult);

      const result = await transformer.executeWithResult(mockCommand, mockAgentConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('some error');
    });
  });

  describe('validateCommand', () => {
    it('should return validation result from executor', () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const validationResult = { valid: true, errors: [] };

      mockExecutor.validate.mockReturnValue(validationResult);

      const result = transformer.validateCommand(mockCommand, mockAgentConfig);

      expect(mockExecutorFactory.getExecutor).toHaveBeenCalledWith(mockAgentConfig);
      expect(mockExecutor.validate).toHaveBeenCalledWith(mockCommand, mockAgentConfig);
      expect(result).toEqual(validationResult);
    });

    it('should return errors when validation fails', () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const validationResult = {
        valid: false,
        errors: ['commandId is required', 'skillId is missing'],
      };

      mockExecutor.validate.mockReturnValue(validationResult);

      const result = transformer.validateCommand(mockCommand, mockAgentConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it('should pass correct command and config to validate', () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      mockExecutor.validate.mockReturnValue({ valid: true, errors: [] });

      transformer.validateCommand(mockCommand, mockAgentConfig);

      expect(mockExecutor.validate).toHaveBeenCalledWith(
        mockCommand,
        mockAgentConfig
      );
    });
  });

  describe('testConnection', () => {
    it('should return connection test result', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const connectionResult = { success: true, message: 'Connected successfully' };

      mockExecutor.testConnection.mockResolvedValue(connectionResult);

      const result = await transformer.testConnection(mockAgentConfig);

      expect(mockExecutorFactory.getExecutor).toHaveBeenCalledWith(mockAgentConfig);
      expect(mockExecutor.testConnection).toHaveBeenCalledWith(mockAgentConfig);
      expect(result).toEqual(connectionResult);
    });

    it('should return failure result when connection fails', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const connectionResult = { success: false, message: 'Connection refused' };

      mockExecutor.testConnection.mockResolvedValue(connectionResult);

      const result = await transformer.testConnection(mockAgentConfig);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection refused');
    });
  });

  describe('getConnectionPool', () => {
    it('should return the connection pool instance', () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const pool = transformer.getConnectionPool();

      expect(pool).toBe(mockConnectionPool);
    });
  });

  describe('getExecutorFactory', () => {
    it('should return the executor factory instance', () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const factory = transformer.getExecutorFactory();

      expect(factory).toBe(mockExecutorFactory);
    });
  });

  describe('compatibility with CommandOrchestrator replacement', () => {
    it('should support both openclaw and stratix backend types', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);

      // Test with openclaw backend
      const openclawConfig: StratixAgentConfig = {
        ...mockAgentConfig,
        backendType: 'openclaw',
        openClawConfig: { endpoint: 'http://localhost:8080', accountId: 'acc-1' },
      };

      mockExecutor.execute.mockResolvedValue({ success: true, data: {} });
      await transformer.transformAndExecute(mockCommand, openclawConfig);
      expect(mockExecutorFactory.getExecutor).toHaveBeenCalledWith(openclawConfig);

      // Reset and test with stratix backend
      jest.clearAllMocks();
      const stratixConfig: StratixAgentConfig = {
        ...mockAgentConfig,
        backendType: 'stratix',
        stratixConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'key-1' },
      };

      mockExecutor.execute.mockResolvedValue({ success: true, data: {} });
      await transformer.transformAndExecute(mockCommand, stratixConfig);
      expect(mockExecutorFactory.getExecutor).toHaveBeenCalledWith(stratixConfig);
    });

    it('should handle commands with complex parameters', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const complexCommand: StratixCommandData = {
        commandId: 'cmd-complex',
        skillId: 'skill-with-params',
        agentId: 'agent-1',
        params: {
          stringParam: 'hello',
          numberParam: 42,
          boolParam: true,
          arrayParam: [1, 2, 3],
          nestedParam: { key: { deep: 'value' } },
        },
        executeAt: Date.now(),
      };

      mockExecutor.execute.mockResolvedValue({ success: true, data: { result: 'ok' } });

      const result = await transformer.transformAndExecute(complexCommand, mockAgentConfig);

      expect(mockExecutor.execute).toHaveBeenCalledWith(complexCommand, mockAgentConfig);
      expect(result).toEqual({ result: 'ok' });
    });

    it('should handle empty params', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const emptyParamsCommand: StratixCommandData = {
        commandId: 'cmd-empty',
        skillId: 'skill-no-params',
        agentId: 'agent-1',
        params: {},
        executeAt: Date.now(),
      };

      mockExecutor.execute.mockResolvedValue({ success: true, data: null });

      const result = await transformer.transformAndExecute(emptyParamsCommand, mockAgentConfig);

      expect(mockExecutor.execute).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should preserve command executeAt timestamp', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      const timestamp = Date.now();
      const commandWithTimestamp: StratixCommandData = {
        commandId: 'cmd-ts',
        skillId: 'skill-1',
        agentId: 'agent-1',
        params: {},
        executeAt: timestamp,
      };

      mockExecutor.execute.mockResolvedValue({ success: true, data: {} });

      await transformer.transformAndExecute(commandWithTimestamp, mockAgentConfig);

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({ executeAt: timestamp }),
        mockAgentConfig
      );
    });
  });

  describe('error handling edge cases', () => {
    it('should handle executor throwing exception', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      mockExecutor.execute.mockRejectedValue(new Error('Network error'));

      await expect(transformer.transformAndExecute(mockCommand, mockAgentConfig))
        .rejects.toThrow('Network error');
    });

    it('should handle executor returning null data', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      mockExecutor.execute.mockResolvedValue({ success: true, data: null });

      const result = await transformer.transformAndExecute(mockCommand, mockAgentConfig);

      expect(result).toBeNull();
    });

    it('should handle executor returning undefined result', async () => {
      const transformer = new CommandTransformer(mockConnectionPool);
      mockExecutor.execute.mockResolvedValue({ success: true } as ExecutorResult);

      const result = await transformer.transformAndExecute(mockCommand, mockAgentConfig);

      expect(result).toBeUndefined();
    });
  });
});
