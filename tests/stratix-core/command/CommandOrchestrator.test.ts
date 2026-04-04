/**
 * CommandOrchestrator unit tests
 */

import { CommandOrchestrator } from '@/stratix-core/command/CommandOrchestrator';
import { ExecutorFactory } from '@/stratix-core/executor/ExecutorFactory';
import type { AgentExecutor, ExecutorResult } from '@/stratix-core/executor/AgentExecutor';
import type { Command, CommandContext } from '@/stratix-core/command/types';
import type { StratixAgentConfig, StratixCommandData } from '@/stratix-core/stratix-protocol';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    agentId: 'agent-1',
    sessionId: 'session-1',
    args: {},
    ...overrides,
  };
}

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    name: 'test-cmd',
    description: 'A test command',
    source: 'builtin',
    execute: jest.fn().mockResolvedValue({ success: true, output: 'ok' }),
    ...overrides,
  };
}

function makeAgentConfig(overrides: Partial<StratixAgentConfig> = {}): StratixAgentConfig {
  return {
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
    ...overrides,
  };
}

function makeCommandData(overrides: Partial<StratixCommandData> = {}): StratixCommandData {
  return {
    commandId: 'cmd-1',
    skillId: 'skill-1',
    agentId: 'agent-1',
    params: {},
    executeAt: Date.now(),
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Mock executor
// --------------------------------------------------------------------------

function makeMockExecutor(overrides: Partial<{
  executeResult: ExecutorResult;
  validateResult: { valid: boolean; errors: string[] };
  testConnectionResult: { success: boolean; message: string };
  executeThrows: boolean;
  validateThrows: boolean;
  testConnectionThrows: boolean;
}> = {}): jest.Mocked<AgentExecutor> {
  return {
    execute: overrides.executeThrows
      ? jest.fn().mockRejectedValue(new Error('execute error'))
      : jest.fn().mockResolvedValue(overrides.executeResult ?? { success: true, data: 'ok' }),
    validate: overrides.validateThrows
      ? jest.fn().mockRejectedValue(new Error('validate error'))
      : jest.fn().mockReturnValue(overrides.validateResult ?? { valid: true, errors: [] }),
    testConnection: overrides.testConnectionThrows
      ? jest.fn().mockRejectedValue(new Error('testConnection error'))
      : jest.fn().mockResolvedValue(overrides.testConnectionResult ?? { success: true, message: 'ok' }),
  } as jest.Mocked<AgentExecutor>;
}

// --------------------------------------------------------------------------
// Mock factory helper
// --------------------------------------------------------------------------

function withMockFactory(mockExecutor: jest.Mocked<AgentExecutor>) {
  const mockFactory = {
    getExecutor: jest.fn().mockReturnValue(mockExecutor),
    getExecutorByType: jest.fn().mockReturnValue(mockExecutor),
    getOpenClawExecutor: jest.fn().mockReturnValue(mockExecutor),
    getStratixAgentExecutor: jest.fn().mockReturnValue(mockExecutor),
  } as unknown as jest.Mocked<ExecutorFactory>;

  const spy = jest.spyOn(ExecutorFactory, 'getInstance').mockReturnValue(mockFactory as any);

  return { mockFactory, spy };
}

// --------------------------------------------------------------------------
// Tests: register / unregister
// --------------------------------------------------------------------------

describe('CommandOrchestrator', () => {
  describe('register / unregister', () => {
    it('registers a command', () => {
      const orch = new CommandOrchestrator();
      const cmd = makeCommand({ name: 'cmd-1' });
      orch.register(cmd);
      const found = orch.getCommands(makeContext());
      expect(found.some((c) => c.name === 'cmd-1')).toBe(true);
    });

    it('unregister removes a command', () => {
      const orch = new CommandOrchestrator();
      orch.register(makeCommand({ name: 'cmd-1' }));
      orch.unregister('cmd-1');
      const found = orch.getCommands(makeContext());
      expect(found.some((c) => c.name === 'cmd-1')).toBe(false);
    });

    it('unregister on non-existent command is no-op', () => {
      const orch = new CommandOrchestrator();
      expect(() => orch.unregister('ghost')).not.toThrow();
    });

    it('register overwrites existing command with same name', () => {
      const orch = new CommandOrchestrator();
      const cmd1 = makeCommand({ name: 'cmd-1', description: 'first' });
      const cmd2 = makeCommand({ name: 'cmd-1', description: 'second' });
      orch.register(cmd1);
      orch.register(cmd2);
      expect(orch.getCommands(makeContext()).find((c) => c.name === 'cmd-1')?.description).toBe('second');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: getCommands / getCommandNames
  // --------------------------------------------------------------------------

  describe('getCommands / getCommandNames', () => {
    it('returns all registered commands', () => {
      const orch = new CommandOrchestrator();
      orch.register(makeCommand({ name: 'cmd-1' }));
      orch.register(makeCommand({ name: 'cmd-2' }));
      expect(orch.getCommands(makeContext()).map((c) => c.name)).toEqual(['cmd-1', 'cmd-2']);
    });

    it('filters by availability function', () => {
      const orch = new CommandOrchestrator();
      orch.register(
        makeCommand({ name: 'cmd-1', availability: (ctx) => ctx.agentId === 'agent-1' })
      );
      orch.register(
        makeCommand({ name: 'cmd-2', availability: (ctx) => ctx.agentId === 'agent-2' })
      );

      const ctx1 = makeContext({ agentId: 'agent-1' });
      const ctx2 = makeContext({ agentId: 'agent-2' });

      expect(orch.getCommands(ctx1).map((c) => c.name)).toEqual(['cmd-1']);
      expect(orch.getCommands(ctx2).map((c) => c.name)).toEqual(['cmd-2']);
    });

    it('commands without availability are always included', () => {
      const orch = new CommandOrchestrator();
      orch.register(makeCommand({ name: 'cmd-1' }));
      orch.register(
        makeCommand({ name: 'cmd-2', availability: (ctx) => ctx.agentId === 'agent-2' })
      );

      const ctx = makeContext({ agentId: 'agent-1' });
      expect(orch.getCommands(ctx).map((c) => c.name)).toContain('cmd-1');
    });

    it('getCommandNames returns sorted names by source priority', () => {
      const orch = new CommandOrchestrator();
      orch.register(makeCommand({ name: 'a-skill', source: 'skill' }));
      orch.register(makeCommand({ name: 'b-builtin', source: 'builtin' }));
      orch.register(makeCommand({ name: 'c-mcp', source: 'mcp' }));

      const names = orch.getCommandNames(makeContext());
      // SOURCE_PRIORITY: builtin=0, plugin=1, skill=2, workflow=3, mcp=4
      expect(names).toEqual(['b-builtin', 'a-skill', 'c-mcp']);
    });

    it('sorts all sources in correct order', () => {
      const orch = new CommandOrchestrator();
      orch.register(makeCommand({ name: 'mcp', source: 'mcp' }));
      orch.register(makeCommand({ name: 'builtin', source: 'builtin' }));
      orch.register(makeCommand({ name: 'skill', source: 'skill' }));
      orch.register(makeCommand({ name: 'plugin', source: 'plugin' }));
      orch.register(makeCommand({ name: 'workflow', source: 'workflow' }));

      const names = orch.getCommandNames(makeContext());
      expect(names).toEqual(['builtin', 'plugin', 'skill', 'workflow', 'mcp']);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: execute
  // --------------------------------------------------------------------------

  describe('execute', () => {
    it('executes a registered command', async () => {
      const orch = new CommandOrchestrator();
      const executeFn = jest.fn().mockResolvedValue({ success: true, output: 'result' });
      orch.register(makeCommand({ name: 'cmd-1', execute: executeFn }));

      const result = await orch.execute('cmd-1', makeContext());
      expect(executeFn).toHaveBeenCalled();
      expect(result.output).toBe('result');
    });

    it('throws when command not found', async () => {
      const orch = new CommandOrchestrator();
      await expect(orch.execute('ghost', makeContext())).rejects.toThrow('Command not found');
    });

    it('passes context to command execute function', async () => {
      const orch = new CommandOrchestrator();
      const ctx = makeContext({ agentId: 'my-agent', args: { foo: 'bar' } });
      const executeFn = jest.fn().mockResolvedValue({ success: true, output: '' });
      orch.register(makeCommand({ name: 'cmd-1', execute: executeFn }));

      await orch.execute('cmd-1', ctx);
      expect(executeFn).toHaveBeenCalledWith(ctx);
    });

    it('returns CommandResult from execute', async () => {
      const orch = new CommandOrchestrator();
      const result: import('@/stratix-core/command/types').CommandResult = {
        success: true,
        output: 'the output',
      };
      orch.register(makeCommand({ name: 'cmd-1', execute: jest.fn().mockResolvedValue(result) }));

      const res = await orch.execute('cmd-1', makeContext());
      expect(res.success).toBe(true);
      expect(res.output).toBe('the output');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: transformAndExecute (requires ExecutorFactory - tested via integration style)
  // --------------------------------------------------------------------------

  describe('transformAndExecute', () => {
    it('throws when executor throws', async () => {
      const orch = new CommandOrchestrator();
      // Without proper ConnectionPool/ExecutorFactory setup, it will throw on unknown backend
      const cmd: StratixCommandData = {
        commandId: 'cmd-id',
        skillId: 'skill-1',
        agentId: 'agent-1',
        params: {},
        executeAt: Date.now(),
      };

      const agentConfig = {
        agentId: 'agent-1',
        name: 'Test',
        type: 'dev' as const,
        profile: {} as any,
        backendType: 'openclaw' as const,
        configStatus: 'ready' as const,
      };

      // This will throw because ConnectionPool is not properly connected
      await expect(orch.transformAndExecute(cmd, agentConfig)).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Tests: getConnectionPool / getExecutorFactory
  // --------------------------------------------------------------------------

  describe('getConnectionPool / getExecutorFactory', () => {
    it('returns the connection pool', () => {
      const orch = new CommandOrchestrator();
      expect(orch.getConnectionPool()).toBeDefined();
    });

    it('returns the executor factory', () => {
      const orch = new CommandOrchestrator();
      expect(orch.getExecutorFactory()).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Tests: executeWithResult
  // --------------------------------------------------------------------------

  describe('executeWithResult', () => {
    beforeEach(() => {
      // Reset singleton before each test to avoid state pollution
      // @ts-expect-error - accessing private static instance for testing
      ExecutorFactory.instance = undefined;
    });

    afterEach(() => {
      // @ts-expect-error - accessing private static instance for testing
      ExecutorFactory.instance = undefined;
    });

    it('returns ExecutorResult on success', async () => {
      const { mockFactory, spy } = withMockFactory(
        makeMockExecutor({ executeResult: { success: true, data: { result: 42 } } })
      );

      const orch = new CommandOrchestrator();
      const cmd = makeCommandData();
      const config = makeAgentConfig();

      const result = await orch.executeWithResult(cmd, config);

      expect(mockFactory.getExecutor).toHaveBeenCalledWith(config);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ result: 42 });
      spy.mockRestore();
    });

    it('returns ExecutorResult with error on executor failure', async () => {
      const { mockFactory, spy } = withMockFactory(
        makeMockExecutor({ executeResult: { success: false, error: 'skill not found' } })
      );

      const orch = new CommandOrchestrator();
      const result = await orch.executeWithResult(makeCommandData(), makeAgentConfig());

      expect(result.success).toBe(false);
      expect(result.error).toBe('skill not found');
      spy.mockRestore();
    });

    it('propagates errors thrown by executor', async () => {
      const { spy } = withMockFactory(
        makeMockExecutor({ executeThrows: true })
      );

      const orch = new CommandOrchestrator();
      await expect(orch.executeWithResult(makeCommandData(), makeAgentConfig())).rejects.toThrow('execute error');
      spy.mockRestore();
    });

    it('passes correct command and config to executor', async () => {
      const mockExec = makeMockExecutor({ executeResult: { success: true, data: 'data' } });
      const { mockFactory, spy } = withMockFactory(mockExec);

      const orch = new CommandOrchestrator();
      const cmd = makeCommandData({ commandId: 'my-cmd', skillId: 'my-skill' });
      const config = makeAgentConfig({ agentId: 'my-agent' });

      await orch.executeWithResult(cmd, config);

      expect(mockFactory.getExecutor).toHaveBeenCalledWith(config);
      expect(mockExec.execute).toHaveBeenCalledWith(cmd, config, undefined);
      spy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // Tests: validateCommand
  // --------------------------------------------------------------------------

  describe('validateCommand', () => {
    beforeEach(() => {
      // @ts-expect-error - accessing private static instance for testing
      ExecutorFactory.instance = undefined;
    });

    afterEach(() => {
      // @ts-expect-error - accessing private static instance for testing
      ExecutorFactory.instance = undefined;
    });

    it('returns valid: true when validation passes', () => {
      const { spy } = withMockFactory(
        makeMockExecutor({ validateResult: { valid: true, errors: [] } })
      );

      const orch = new CommandOrchestrator();
      const result = orch.validateCommand(makeCommandData(), makeAgentConfig());

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      spy.mockRestore();
    });

    it('returns valid: false with errors when validation fails', () => {
      const { spy } = withMockFactory(
        makeMockExecutor({ validateResult: { valid: false, errors: ['Provider is required', 'Model is required'] } })
      );

      const orch = new CommandOrchestrator();
      const result = orch.validateCommand(makeCommandData(), makeAgentConfig());

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['Provider is required', 'Model is required']);
      spy.mockRestore();
    });

    it('passes command and config to executor validate', () => {
      const mockExec = makeMockExecutor({ validateResult: { valid: true, errors: [] } });
      const { mockFactory, spy } = withMockFactory(mockExec);

      const orch = new CommandOrchestrator();
      const cmd = makeCommandData({ commandId: 'validate-cmd' });
      const config = makeAgentConfig({ agentId: 'validate-agent' });

      orch.validateCommand(cmd, config);

      expect(mockFactory.getExecutor).toHaveBeenCalledWith(config);
      expect(mockExec.validate).toHaveBeenCalledWith(cmd, config);
      spy.mockRestore();
    });

    it('rethrows when executor validate throws', () => {
      const { spy } = withMockFactory(
        makeMockExecutor({ validateThrows: true })
      );

      const orch = new CommandOrchestrator();
      expect(() => orch.validateCommand(makeCommandData(), makeAgentConfig())).toThrow('validate error');
      spy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // Tests: testConnection
  // --------------------------------------------------------------------------

  describe('testConnection', () => {
    beforeEach(() => {
      // @ts-expect-error - accessing private static instance for testing
      ExecutorFactory.instance = undefined;
    });

    afterEach(() => {
      // @ts-expect-error - accessing private static instance for testing
      ExecutorFactory.instance = undefined;
    });

    it('returns success result when connection succeeds', async () => {
      const { spy } = withMockFactory(
        makeMockExecutor({ testConnectionResult: { success: true, message: 'Connected' } })
      );

      const orch = new CommandOrchestrator();
      const result = await orch.testConnection(makeAgentConfig());

      expect(result.success).toBe(true);
      expect(result.message).toBe('Connected');
      spy.mockRestore();
    });

    it('returns failure result when connection fails', async () => {
      const { spy } = withMockFactory(
        makeMockExecutor({ testConnectionResult: { success: false, message: 'Connection refused' } })
      );

      const orch = new CommandOrchestrator();
      const result = await orch.testConnection(makeAgentConfig());

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection refused');
      spy.mockRestore();
    });

    it('passes agent config to executor testConnection', async () => {
      const mockExec = makeMockExecutor({ testConnectionResult: { success: true, message: 'ok' } });
      const { mockFactory, spy } = withMockFactory(mockExec);

      const orch = new CommandOrchestrator();
      const config = makeAgentConfig({ agentId: 'test-agent' });

      await orch.testConnection(config);

      expect(mockFactory.getExecutor).toHaveBeenCalledWith(config);
      expect(mockExec.testConnection).toHaveBeenCalledWith(config);
      spy.mockRestore();
    });

    it('rethrows when executor testConnection throws', async () => {
      const { spy } = withMockFactory(
        makeMockExecutor({ testConnectionThrows: true })
      );

      const orch = new CommandOrchestrator();
      await expect(orch.testConnection(makeAgentConfig())).rejects.toThrow('testConnection error');
      spy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // Tests: transformAndExecute
  // --------------------------------------------------------------------------

  describe('transformAndExecute', () => {
    beforeEach(() => {
      // @ts-expect-error - accessing private static instance for testing
      ExecutorFactory.instance = undefined;
    });

    afterEach(() => {
      // @ts-expect-error - accessing private static instance for testing
      ExecutorFactory.instance = undefined;
    });

    it('returns data when executor returns success', async () => {
      const { spy } = withMockFactory(
        makeMockExecutor({ executeResult: { success: true, data: { answer: 42 } } })
      );

      const orch = new CommandOrchestrator();
      const result = await orch.transformAndExecute(makeCommandData(), makeAgentConfig());

      expect(result).toEqual({ answer: 42 });
      spy.mockRestore();
    });

    it('throws Error when executor returns success: false', async () => {
      const { spy } = withMockFactory(
        makeMockExecutor({ executeResult: { success: false, error: 'execution failed' } })
      );

      const orch = new CommandOrchestrator();
      await expect(orch.transformAndExecute(makeCommandData(), makeAgentConfig())).rejects.toThrow('execution failed');
      spy.mockRestore();
    });

    it('throws Error with default message when executor returns no error field', async () => {
      const { spy } = withMockFactory(
        makeMockExecutor({ executeResult: { success: false } as ExecutorResult })
      );

      const orch = new CommandOrchestrator();
      await expect(orch.transformAndExecute(makeCommandData(), makeAgentConfig())).rejects.toThrow('Execution failed');
      spy.mockRestore();
    });

    it('passes correct arguments to executor', async () => {
      const mockExec = makeMockExecutor({ executeResult: { success: true, data: 'data' } });
      const { mockFactory, spy } = withMockFactory(mockExec);

      const orch = new CommandOrchestrator();
      const cmd = makeCommandData({ commandId: 'transform-cmd' });
      const config = makeAgentConfig({ agentId: 'transform-agent' });

      await orch.transformAndExecute(cmd, config);

      expect(mockFactory.getExecutor).toHaveBeenCalledWith(config);
      expect(mockExec.execute).toHaveBeenCalledWith(cmd, config, undefined);
      spy.mockRestore();
    });
  });
});
