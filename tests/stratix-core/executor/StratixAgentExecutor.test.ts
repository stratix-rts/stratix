import { StratixAgentExecutor } from '@/stratix-core/executor/StratixAgentExecutor';
import type { StratixAgentConfig, StratixCommandData, StratixSkillConfig } from '@/stratix-core/stratix-protocol';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('StratixAgentExecutor', () => {
  let executor: StratixAgentExecutor;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    executor = new StratixAgentExecutor();
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  const createMockAgentConfig = (overrides?: Partial<StratixAgentConfig>): StratixAgentConfig => ({
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
    skills: [
      {
        skillId: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        parameters: [],
        prompt: 'Execute test with {{param1}}',
      },
    ],
    configStatus: 'ready',
    ...overrides,
  });

  const createMockCommand = (overrides?: Partial<StratixCommandData>): StratixCommandData => ({
    commandId: 'cmd-1',
    skillId: 'test-skill',
    agentId: 'agent-1',
    params: { param1: 'value1' },
    executeAt: Date.now(),
    ...overrides,
  });

  describe('constructor', () => {
    test('creates instance', () => {
      expect(executor).toBeInstanceOf(StratixAgentExecutor);
    });
  });

  describe('execute', () => {
    test('returns error when stratixConfig is missing', async () => {
      const agentConfig = createMockAgentConfig({
        stratixConfig: undefined,
      });
      const command = createMockCommand();

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stratix config not found for agent');
    });

    test('returns success when LLM call succeeds', async () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand();

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'LLM response' } }],
          }),
      });

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(true);
      expect(result.data).toBe('LLM response');
    });

    test('replaces template variables in prompt', async () => {
      const agentConfig = createMockAgentConfig({
        skills: [
          {
            skillId: 'test-skill',
            name: 'Test Skill',
            description: 'A test skill',
            parameters: [],
            prompt: 'Hello {{name}}, you are {{age}} years old',
          },
        ],
      });
      const command = createMockCommand({ skillId: 'test-skill', params: { name: 'Alice', age: 30 } });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Response' } }],
          }),
      });

      await executor.execute(command, agentConfig);

      // Check that fetch was called with correct messages
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Alice'),
        })
      );
    });

    test('returns error when LLM call fails', async () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('LLM API error: 401');
    });

    test('handles network errors', async () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand();

      mockFetch.mockRejectedValue(new Error('Network failure'));

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network failure');
    });

    test('handles invalid JSON response', async () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand();

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(false);
    });

    test('uses history when provided in options', async () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand();

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Response' } }],
          }),
      });

      const history = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];

      await executor.execute(command, agentConfig, { history });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Hello'),
        })
      );
    });

    test('builds user message from params when no skill found', async () => {
      const agentConfig = createMockAgentConfig();
      const command = createMockCommand({ skillId: 'non-existent-skill' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Response' } }],
          }),
      });

      const result = await executor.execute(command, agentConfig);

      expect(result.success).toBe(true);
    });
  });

  describe('validate', () => {
    test('returns error when stratixConfig is missing', () => {
      const agentConfig = createMockAgentConfig({
        stratixConfig: undefined,
      });
      const command = createMockCommand();

      const result = executor.validate(command, agentConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Stratix config not found for agent');
    });

    test('returns error when provider is missing', () => {
      const agentConfig = createMockAgentConfig({
        stratixConfig: {
          provider: '' as any,
          model: 'gpt-4',
          apiKey: 'test-key',
        },
      });
      const command = createMockCommand();

      const result = executor.validate(command, agentConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Provider is required');
    });

    test('returns error when model is missing', () => {
      const agentConfig = createMockAgentConfig({
        stratixConfig: {
          provider: 'openai',
          model: '',
          apiKey: 'test-key',
        },
      });
      const command = createMockCommand();

      const result = executor.validate(command, agentConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Model is required');
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
    test('returns error when stratixConfig is missing', async () => {
      const agentConfig = createMockAgentConfig({
        stratixConfig: undefined,
      });

      const result = await executor.testConnection(agentConfig);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Stratix config not found');
    });

    test('returns success when connection succeeds', async () => {
      const agentConfig = createMockAgentConfig();

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'test' } }],
          }),
      });

      const result = await executor.testConnection(agentConfig);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
    });

    test('returns error when connection fails', async () => {
      const agentConfig = createMockAgentConfig();

      mockFetch.mockRejectedValue(new Error('Connection timeout'));

      const result = await executor.testConnection(agentConfig);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection timeout');
    });

    test('returns error when API returns error status', async () => {
      const agentConfig = createMockAgentConfig();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const result = await executor.testConnection(agentConfig);

      expect(result.success).toBe(false);
      expect(result.message).toContain('LLM API error: 500');
    });
  });
});
