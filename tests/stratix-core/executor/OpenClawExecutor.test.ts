import { OpenClawExecutor } from '@/stratix-core/executor/OpenClawExecutor';
import { ConnectionPool } from '@/stratix-openclaw-adapter';
import type { StratixAgentConfig, StratixCommandData } from '@/stratix-core/stratix-protocol';
import type { OpenClawAdapterInterface } from '@/stratix-openclaw-adapter';

// Mock the ConnectionPool
jest.mock('@/stratix-openclaw-adapter', () => ({
  ConnectionPool: jest.fn().mockImplementation(() => ({
    getAdapter: jest.fn(),
  })),
}));

// Mock adapter
const mockAdapter: Partial<OpenClawAdapterInterface> = {
  execute: jest.fn(),
  getStatus: jest.fn(),
};

describe('OpenClawExecutor', () => {
  let executor: OpenClawExecutor;
  let mockConnectionPool: jest.Mocked<ConnectionPool>;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new OpenClawExecutor();
    mockConnectionPool = (executor as any).connectionPool;
  });

  const createMockAgentConfig = (overrides?: Partial<StratixAgentConfig>): StratixAgentConfig => ({
    agentId: 'agent-1',
    name: 'Test Agent',
    type: 'dev',
    profile: {} as any,
    backendType: 'openclaw',
    openClawConfig: {
      endpoint: 'http://localhost:8080',
      accountId: 'account-1',
    },
    skills: [
      {
        skillId: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        parameters: [],
        executeScript: JSON.stringify({ action: 'test', params: {} }),
      },
    ],
    configStatus: 'ready',
    ...overrides,
  });

  const createMockCommand = (overrides?: Partial<StratixCommandData>): StratixCommandData => ({
    commandId: 'cmd-1',
    skillId: 'test-skill',
    agentId: 'agent-1',
    params: {},
    executeAt: Date.now(),
    ...overrides,
  });

  describe('constructor', () => {
    test('creates instance with optional connectionPool', () => {
      const customPool = new ConnectionPool();
      const exec = new OpenClawExecutor(customPool);
      expect(exec).toBeInstanceOf(OpenClawExecutor);
    });

    test('creates new ConnectionPool when not provided', () => {
      const exec = new OpenClawExecutor();
      expect(exec).toBeInstanceOf(OpenClawExecutor);
    });
  });

  describe('execute', () => {
    test('returns error when openClawConfig is missing', async () => {
      const agentConfig = createMockAgentConfig({
        openClawConfig: undefined,
      });
      const command = createMockCommand();

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('OpenClaw config not found for agent');
    });

    test('returns error when skill is not found', async () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand({ skillId: 'non-existent-skill' });

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Skill not found: non-existent-skill');
    });

    test('returns error when skill has no executeScript', async () => {
      const agentConfig = createMockAgentConfig({
        skills: [
          {
            skillId: 'test-skill',
            name: 'Test Skill',
            description: 'A test skill',
            parameters: [],
            // No executeScript
          },
        ],
      });
      const command = createMockCommand();

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('has no executeScript');
    });

    test('returns error when required parameters are missing', async () => {
      const agentConfig = createMockAgentConfig({
        skills: [
          {
            skillId: 'test-skill',
            name: 'Test Skill',
            description: 'A test skill',
            parameters: [],
            executeScript: JSON.stringify({ action: 'test', params: { '{{requiredParam}}': true } }),
          },
        ],
      });
      const command = createMockCommand({ params: {} });

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing parameters');
    });

    test('replaces template variables in executeScript', async () => {
      const agentConfig = createMockAgentConfig({
        skills: [
          {
            skillId: 'test-skill',
            name: 'Test Skill',
            description: 'A test skill',
            parameters: [],
            executeScript: JSON.stringify({
              action: 'greet',
              params: { name: '{{name}}' },
            }),
          },
        ],
      });
      const command = createMockCommand({ params: { name: 'Alice' } });

      // Mock adapter
      (mockConnectionPool.getAdapter as jest.Mock).mockResolvedValue(mockAdapter);
      (mockAdapter.execute as jest.Mock).mockResolvedValue({
        success: true,
        data: { greeting: 'Hello Alice' },
      });

      await executor.execute(command, agentConfig);

      // Verify the adapter was called with processed script
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ name: 'Alice' }),
        })
      );
    });

    test('returns error when adapter execution fails', async () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand();

      (mockConnectionPool.getAdapter as jest.Mock).mockResolvedValue(mockAdapter);
      (mockAdapter.execute as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Execution failed',
      });

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Execution failed');
    });

    test('returns success with data when execution succeeds', async () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand();

      (mockConnectionPool.getAdapter as jest.Mock).mockResolvedValue(mockAdapter);
      (mockAdapter.execute as jest.Mock).mockResolvedValue({
        success: true,
        data: { result: 'ok' },
      });

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ result: 'ok' });
    });

    test('handles exceptions and returns error', async () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand();

      (mockConnectionPool.getAdapter as jest.Mock).mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('validate', () => {
    test('returns error when openClawConfig is missing', () => {
      const agentConfig = createMockAgentConfig({
        openClawConfig: undefined,
      });
      const command = createMockCommand();

      const result = executor.validate(command, agentConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('OpenClaw config not found for agent');
    });

    test('returns error when skill is not found', () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand({ skillId: 'non-existent-skill' });

      const result = executor.validate(command, agentConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Skill not found: non-existent-skill');
    });

    test('returns error when skill has no executeScript', () => {
      const agentConfig = createMockAgentConfig({
        skills: [
          {
            skillId: 'test-skill',
            name: 'Test Skill',
            description: 'A test skill',
            parameters: [],
            // No executeScript
          },
        ],
      });
      const command = createMockCommand();

      const result = executor.validate(command, agentConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Skill test-skill has no executeScript');
    });

    test('returns error when required parameters are missing', () => {
      const agentConfig = createMockAgentConfig({
        skills: [
          {
            skillId: 'test-skill',
            name: 'Test Skill',
            description: 'A test skill',
            parameters: [],
            executeScript: JSON.stringify({
              action: 'test',
              params: { '{{requiredParam}}': true },
            }),
          },
        ],
      });
      const command = createMockCommand({ params: {} });

      const result = executor.validate(command, agentConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required parameter: requiredParam');
    });

    test('returns valid when all requirements are met', () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand();

      const result = executor.validate(command, agentConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('testConnection', () => {
    test('returns error when openClawConfig is missing', async () => {
      const agentConfig = createMockAgentConfig({
        openClawConfig: undefined,
      });

      const result = await executor.testConnection(agentConfig);

      expect(result.success).toBe(false);
      expect(result.message).toBe('OpenClaw config not found');
    });

    test('returns success when connection is established', async () => {
      const agentConfig = createMockAgentConfig();

      (mockConnectionPool.getAdapter as jest.Mock).mockResolvedValue(mockAdapter);
      (mockAdapter.getStatus as jest.Mock).mockResolvedValue({
        connected: true,
      });

      const result = await executor.testConnection(agentConfig);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Connected to OpenClaw');
    });

    test('returns error when connection fails', async () => {
      const agentConfig = createMockAgentConfig();

      (mockConnectionPool.getAdapter as jest.Mock).mockResolvedValue(mockAdapter);
      (mockAdapter.getStatus as jest.Mock).mockResolvedValue({
        connected: false,
        error: 'Connection refused',
      });

      const result = await executor.testConnection(agentConfig);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection refused');
    });

    test('handles exception during connection test', async () => {
      const agentConfig = createMockAgentConfig();

      (mockConnectionPool.getAdapter as jest.Mock).mockRejectedValue(
        new Error('Network error')
      );

      const result = await executor.testConnection(agentConfig);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection failed');
    });
  });

  describe('getConnectionPool', () => {
    test('returns the connection pool instance', () => {
      const pool = executor.getConnectionPool();
      expect(pool).toBeDefined();
    });
  });
});
