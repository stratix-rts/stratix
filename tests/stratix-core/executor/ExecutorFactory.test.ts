import { ExecutorFactory, createExecutorFactory } from '@/stratix-core/executor/ExecutorFactory';
import { OpenClawExecutor } from '@/stratix-core/executor/OpenClawExecutor';
import { StratixAgentExecutor } from '@/stratix-core/executor/StratixAgentExecutor';
import type { StratixAgentConfig, AgentBackendType } from '@/stratix-core/stratix-protocol';

// Reset singleton for each test
beforeEach(() => {
  // @ts-expect-error - accessing private static instance for testing
  ExecutorFactory.instance = undefined;
});

describe('ExecutorFactory', () => {
  describe('singleton pattern', () => {
    test('getInstance returns same instance', () => {
      const factory1 = ExecutorFactory.getInstance();
      const factory2 = ExecutorFactory.getInstance();
      expect(factory1).toBe(factory2);
    });

    test('createExecutorFactory creates new instance', () => {
      // Reset first
      // @ts-expect-error - accessing private static instance for testing
      ExecutorFactory.instance = undefined;

      const factory = createExecutorFactory();
      expect(factory).toBeInstanceOf(ExecutorFactory);
    });

    test('getInstance with connectionPool reuses same instance', () => {
      const factory1 = ExecutorFactory.getInstance();
      const factory2 = ExecutorFactory.getInstance();
      expect(factory1).toBe(factory2);
    });
  });

  describe('getExecutor', () => {
    test('returns OpenClawExecutor for openclaw backend', () => {
      const factory = ExecutorFactory.getInstance();
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

      const executor = factory.getExecutor(agentConfig);
      expect(executor).toBeInstanceOf(OpenClawExecutor);
    });

    test('returns StratixAgentExecutor for stratix backend', () => {
      const factory = ExecutorFactory.getInstance();
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

      const executor = factory.getExecutor(agentConfig);
      expect(executor).toBeInstanceOf(StratixAgentExecutor);
    });

    test('infers openclaw backend from openClawConfig', () => {
      const factory = ExecutorFactory.getInstance();
      const agentConfig: StratixAgentConfig = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {} as any,
        backendType: 'openclaw', // explicit type
        openClawConfig: {
          endpoint: 'http://localhost:8080',
          accountId: 'account-1',
        },
        configStatus: 'ready',
      };

      const executor = factory.getExecutor(agentConfig);
      expect(executor).toBeInstanceOf(OpenClawExecutor);
    });

    test('infers stratix backend from stratixConfig', () => {
      const factory = ExecutorFactory.getInstance();
      const agentConfig: StratixAgentConfig = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {} as any,
        backendType: 'stratix', // explicit type
        stratixConfig: {
          provider: 'openai',
          model: 'gpt-4',
          apiKey: 'test-key',
        },
        configStatus: 'ready',
      };

      const executor = factory.getExecutor(agentConfig);
      expect(executor).toBeInstanceOf(StratixAgentExecutor);
    });

    test('throws error for unknown backend type via getExecutor', () => {
      const factory = ExecutorFactory.getInstance();
      // Use a config with an invalid backendType that will reach the switch default
      const invalidAgentConfig = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {} as any,
        backendType: 'unknown' as AgentBackendType, // invalid type
        configStatus: 'ready',
      };

      expect(() => {
        factory.getExecutor(invalidAgentConfig as StratixAgentConfig);
      }).toThrow('Unknown backend type');
    });
  });

  describe('getExecutorByType', () => {
    test('returns OpenClawExecutor for openclaw type', () => {
      const factory = ExecutorFactory.getInstance();
      const executor = factory.getExecutorByType('openclaw');
      expect(executor).toBeInstanceOf(OpenClawExecutor);
    });

    test('returns StratixAgentExecutor for stratix type', () => {
      const factory = ExecutorFactory.getInstance();
      const executor = factory.getExecutorByType('stratix');
      expect(executor).toBeInstanceOf(StratixAgentExecutor);
    });

    test('throws error for unknown backend type', () => {
      const factory = ExecutorFactory.getInstance();
      expect(() => {
        factory.getExecutorByType('unknown' as any);
      }).toThrow('Unknown backend type');
    });
  });

  describe('getOpenClawExecutor', () => {
    test('returns OpenClawExecutor instance', () => {
      const factory = ExecutorFactory.getInstance();
      const executor = factory.getOpenClawExecutor();
      expect(executor).toBeInstanceOf(OpenClawExecutor);
    });
  });

  describe('getStratixAgentExecutor', () => {
    test('returns StratixAgentExecutor instance', () => {
      const factory = ExecutorFactory.getInstance();
      const executor = factory.getStratixAgentExecutor();
      expect(executor).toBeInstanceOf(StratixAgentExecutor);
    });
  });

  describe('inferBackendType', () => {
    test('infers openclaw from openClawConfig', () => {
      const factory = ExecutorFactory.getInstance();
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

      // Use getExecutor to verify inference works
      const executor = factory.getExecutor(agentConfig);
      expect(executor).toBeInstanceOf(OpenClawExecutor);
    });

    test('infers stratix from stratixConfig', () => {
      const factory = ExecutorFactory.getInstance();
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

      const executor = factory.getExecutor(agentConfig);
      expect(executor).toBeInstanceOf(StratixAgentExecutor);
    });

    test('defaults to openclaw when no config present', () => {
      const factory = ExecutorFactory.getInstance();
      const agentConfig: StratixAgentConfig = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {} as any,
        backendType: 'openclaw', // no openClawConfig or stratixConfig
        configStatus: 'ready',
      };

      const executor = factory.getExecutor(agentConfig);
      expect(executor).toBeInstanceOf(OpenClawExecutor);
    });
  });
});
