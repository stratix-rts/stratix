/**
 * EnhancedStratixAgent Integration Tests
 *
 * Tests for SessionRuntime, BudgetController, and RetryPolicyEngine integrations
 * with EnhancedStratixAgent.
 */

import { EnhancedStratixAgent } from '@/stratix-agent/EnhancedStratixAgent';
import { SessionRuntime } from '@/stratix-agent/runtime/SessionRuntime';
import { TranscriptStore } from '@/stratix-agent/runtime/TranscriptStore';
import { AgentConfig, SoulConfig } from '@/stratix-agent/types';
import { AgentTemplate } from '@/stratix-agent/types/template';

// Mock TranscriptStore
jest.mock('@/stratix-agent/runtime/TranscriptStore');

// Mock ZoneContextManager
jest.mock('@/stratix-character-creator/core/ZoneContextManager', () => ({
  zoneContextManager: {
    getZonePromptContext: jest.fn().mockResolvedValue(''),
  },
}));

// Mock LLMConnector
jest.mock('@/stratix-agent/core/LLMConnector', () => {
  return {
    LLMConnector: jest.fn().mockImplementation(() => ({
      generate: jest.fn().mockResolvedValue({
        content: 'Mock LLM response',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      }),
      generateStream: jest.fn().mockImplementation(function(this: any, _messages: any, onChunk: (chunk: string) => void) {
        onChunk('Mock');
        onChunk(' chunk');
        onChunk(' response');
        return Promise.resolve({
          content: 'Mock chunk response',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        });
      }),
      skillsToTools: jest.fn().mockReturnValue([]),
    })),
  };
});

// Mock budgetController singleton
jest.mock('@stratix-core/budget/BudgetController', () => {
  const mockFn = jest.fn();
  return {
    budgetController: {
      evaluate: mockFn,
    },
    BudgetController: jest.fn().mockImplementation(function(this: any) {
      return { evaluate: mockFn };
    }),
  };
});

// Access the mock for use in tests
const { budgetController } = require('@stratix-core/budget/BudgetController');

describe('EnhancedStratixAgent - BudgetController Integration', () => {
  let agent: EnhancedStratixAgent;
  let mockTranscriptStore: jest.Mocked<TranscriptStore>;

  const createTestConfig = (): AgentConfig => ({
    agentId: 'test-agent-budget',
    name: 'Test Agent',
    type: 'custom',
    provider: 'openai',
    model: 'gpt-4',
    apiKey: 'test-key',
    temperature: 0.7,
    maxTokens: 2000,
    maxShortTerm: 20,
    enableLongTerm: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createTestSoul = (): SoulConfig => ({
    identity: 'Test AI',
    personality: 'Helpful',
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockTranscriptStore = new TranscriptStore('.transcripts') as jest.Mocked<TranscriptStore>;
    mockTranscriptStore.append = jest.fn().mockResolvedValue(undefined);
    mockTranscriptStore.getBySession = jest.fn().mockResolvedValue([]);

    agent = new EnhancedStratixAgent(createTestConfig(), createTestSoul());

    const runtime = new SessionRuntime('.transcripts', agent);
    (runtime as any).transcriptStore = mockTranscriptStore;
    (agent as any).runtime = runtime;

    budgetController.evaluate.mockReset();
    budgetController.evaluate.mockReturnValue({ action: 'continue' });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('chat without template uses parent chat with BudgetController', () => {
    test('falls back to super.chat when no template loaded', async () => {
      // No template loaded - should use super.chat()
      const result = await agent.chat('Hello');

      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('sessionId');
    });

    test('chat without template handles budget evaluation', async () => {
      // Budget returns stop action
      budgetController.evaluate.mockReturnValue({
        action: 'stop',
        reason: 'threshold_reached',
        pctUsed: 0.95,
        remainingBudget: 1000,
        nudgeMessage: 'Budget threshold reached. Consider concluding soon.',
      });

      // When falling back to super.chat(), ToolUseLoop would use BudgetController
      // Since ToolUseLoop is only used when useToolUse=true, this tests the fallback behavior
      const result = await agent.chat('Hello');

      // The result should still be returned (BudgetController affects ToolUseLoop, not the fallback)
      expect(result).toHaveProperty('response');
    });
  });

  describe('chat with template uses SessionRuntime', () => {
    const createTestTemplate = (): AgentTemplate => ({
      id: 'test-template',
      name: 'Test Agent',
      version: '1.0.0',
      description: 'A test agent',
      domain: 'engineering',
      tags: ['test'],
      mixins: [],
      identity: 'You are a test agent.',
      personality: 'Professional',
      tone: 'Neutral',
      mission: 'Help with testing.',
      workflows: [],
      rules: [],
      constraints: [],
      forbiddenActions: [],
      skills: [],
      workflowSteps: [],
      successMetrics: [],
      metadata: { author: 'Test' },
    });

    beforeEach(() => {
      agent.loadTemplate(createTestTemplate());
    });

    test('creates session through SessionRuntime', async () => {
      const result = await agent.chat('Hello');

      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^sess_/);
    });

    test('reuses existing session when sessionId provided', async () => {
      const firstResult = await agent.chat('Hello');
      const secondResult = await agent.chat('World', { sessionId: firstResult.sessionId });

      expect(secondResult.sessionId).toBe(firstResult.sessionId);
    });

    test('stores messages in session through Runtime', async () => {
      const result = await agent.chat('Hello');

      const runtime = (agent as any).runtime as SessionRuntime;
      const session = await runtime.getSession(result.sessionId);

      expect(session).not.toBeNull();
      const userMessages = session!.messages.filter((m: any) => m.role === 'user');
      expect(userMessages.length).toBeGreaterThan(0);
    });

    test('accumulates usage through Runtime', async () => {
      await agent.chat('Hello 1');
      await agent.chat('Hello 2');

      const usage = agent.getUsage();
      expect(usage.turnCount).toBeGreaterThan(0);
    });
  });
});

describe('EnhancedStratixAgent - RetryPolicyEngine Integration via SessionRuntime', () => {
  let agent: EnhancedStratixAgent;
  let mockTranscriptStore: jest.Mocked<TranscriptStore>;

  const createTestConfig = (): AgentConfig => ({
    agentId: 'test-agent-retry',
    name: 'Test Agent',
    type: 'custom',
    provider: 'openai',
    model: 'gpt-4',
    apiKey: 'test-key',
    temperature: 0.7,
    maxTokens: 2000,
    maxShortTerm: 20,
    enableLongTerm: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createTestSoul = (): SoulConfig => ({
    identity: 'Test AI',
    personality: 'Helpful',
  });

  const createTestTemplate = (): AgentTemplate => ({
    id: 'test-template',
    name: 'Test Agent',
    version: '1.0.0',
    description: 'A test agent',
    domain: 'engineering',
    tags: ['test'],
    mixins: [],
    identity: 'You are a test agent.',
    personality: 'Professional',
    tone: 'Neutral',
    mission: 'Help with testing.',
    workflows: [],
    rules: [],
    constraints: [],
    forbiddenActions: [],
    skills: [],
    workflowSteps: [],
    successMetrics: [],
    metadata: { author: 'Test' },
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockTranscriptStore = new TranscriptStore('.transcripts') as jest.Mocked<TranscriptStore>;
    mockTranscriptStore.append = jest.fn().mockResolvedValue(undefined);
    mockTranscriptStore.getBySession = jest.fn().mockResolvedValue([]);

    agent = new EnhancedStratixAgent(createTestConfig(), createTestSoul());
    agent.loadTemplate(createTestTemplate());

    const runtime = new SessionRuntime('.transcripts', agent);
    (runtime as any).transcriptStore = mockTranscriptStore;
    (agent as any).runtime = runtime;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('executeAgentTurn retry behavior', () => {
    test('succeeds on first attempt', async () => {
      const runtime = (agent as any).runtime as SessionRuntime;
      const session = await runtime.createSession('test-agent-retry');

      const result = await agent.executeAgentTurn(session, 'Hello', 30000, undefined);

      expect(result.response).toBeDefined();
      expect(result.usage).toBeDefined();
    });

    test('returns error after max retries via SessionRuntime', async () => {
      // This tests the retry behavior through SessionRuntime.executeTurn
      const runtime = (agent as any).runtime as SessionRuntime;

      // Override the delegate to always fail
      const alwaysFailingDelegate = {
        executeAgentTurn: jest.fn().mockRejectedValue(new Error('Persistent error')),
      };
      (runtime as any).agentDelegate = alwaysFailingDelegate;

      const session = await runtime.createSession('test-agent-retry');

      // With maxRetries=2 (default), should fail after retries exhausted
      const result = await runtime.executeTurn(session.sessionId, 'Hello', { maxRetries: 2 });

      expect(result.response).toContain('Error after 2 retries');
      expect(result.metadata?.error).toBeDefined();
    });

    test('succeeds on retry after transient failure', async () => {
      const runtime = (agent as any).runtime as SessionRuntime;

      let attempts = 0;
      const retryingDelegate = {
        executeAgentTurn: jest.fn().mockImplementation(() => {
          attempts++;
          if (attempts < 2) {
            return Promise.reject(new Error('Transient error'));
          }
          return Promise.resolve({
            response: 'Success after retry',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
          });
        }),
      };
      (runtime as any).agentDelegate = retryingDelegate;

      const session = await runtime.createSession('test-agent-retry');
      const result = await runtime.executeTurn(session.sessionId, 'Hello', { maxRetries: 3 });

      expect(result.response).toBe('Success after retry');
      expect(result.metadata?.retries).toBe(1);
    });
  });

  describe('chat retry integration', () => {
    test('chat with template handles retry through SessionRuntime', async () => {
      const runtime = (agent as any).runtime as SessionRuntime;

      // First call fails, second succeeds
      let callCount = 0;
      const originalExecuteAgentTurn = agent.executeAgentTurn.bind(agent);
      jest.spyOn(agent, 'executeAgentTurn').mockImplementation(async (session: any, message: string, timeout: number, signal?: AbortSignal) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Transient error in chat');
        }
        return originalExecuteAgentTurn(session, message, timeout, signal);
      });

      // The error should be caught and handled
      const result = await agent.chat('Hello');

      // Result should still be returned (error handling in SessionRuntime)
      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('sessionId');
    });
  });
});

describe('EnhancedStratixAgent - SessionRuntime getRecentMessages integration', () => {
  let agent: EnhancedStratixAgent;
  let mockTranscriptStore: jest.Mocked<TranscriptStore>;

  const createTestConfig = (): AgentConfig => ({
    agentId: 'test-agent-messages',
    name: 'Test Agent',
    type: 'custom',
    provider: 'openai',
    model: 'gpt-4',
    apiKey: 'test-key',
    temperature: 0.7,
    maxTokens: 2000,
    maxShortTerm: 20,
    enableLongTerm: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createTestSoul = (): SoulConfig => ({
    identity: 'Test AI',
    personality: 'Helpful',
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockTranscriptStore = new TranscriptStore('.transcripts') as jest.Mocked<TranscriptStore>;
    mockTranscriptStore.append = jest.fn().mockResolvedValue(undefined);
    mockTranscriptStore.getBySession = jest.fn().mockResolvedValue([]);

    agent = new EnhancedStratixAgent(createTestConfig(), createTestSoul());

    const runtime = new SessionRuntime('.transcripts', agent);
    (runtime as any).transcriptStore = mockTranscriptStore;
    (agent as any).runtime = runtime;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('getTranscript returns messages from current session', async () => {
    await agent.chat('Hello');
    await agent.chat('World');

    const transcript = agent.getTranscript();

    expect(Array.isArray(transcript)).toBe(true);
  });

  test('getTranscript returns empty when no chat', () => {
    const transcript = agent.getTranscript();

    expect(transcript).toEqual([]);
  });

  test('getUsage returns zero when no chat', () => {
    const usage = agent.getUsage();

    expect(usage.promptTokens).toBe(0);
    expect(usage.completionTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
    expect(usage.turnCount).toBe(0);
  });

  test('getSessionId returns null when no chat', () => {
    expect(agent.getSessionId()).toBeNull();
  });

  test('getSessionId returns sessionId after chat', async () => {
    // Load template so SessionRuntime is used
    agent.loadTemplate({
      id: 'test-template',
      name: 'Test Agent',
      version: '1.0.0',
      description: 'A test agent',
      domain: 'engineering',
      tags: ['test'],
      mixins: [],
      identity: 'You are a test agent.',
      personality: 'Professional',
      tone: 'Neutral',
      mission: 'Help with testing.',
      workflows: [],
      rules: [],
      constraints: [],
      forbiddenActions: [],
      skills: [],
      workflowSteps: [],
      successMetrics: [],
      metadata: { author: 'Test' },
    });

    await agent.chat('Hello');

    expect(agent.getSessionId()).toBeDefined();
    expect(agent.getSessionId()).toMatch(/^sess_/);
  });
});

describe('EnhancedStratixAgent - executeAgentTurn with enhanced prompt', () => {
  let agent: EnhancedStratixAgent;
  let mockTranscriptStore: jest.Mocked<TranscriptStore>;

  const createTestConfig = (): AgentConfig => ({
    agentId: 'test-agent-turn',
    name: 'Test Agent',
    type: 'custom',
    provider: 'openai',
    model: 'gpt-4',
    apiKey: 'test-key',
    temperature: 0.7,
    maxTokens: 2000,
    maxShortTerm: 20,
    enableLongTerm: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const createTestSoul = (): SoulConfig => ({
    identity: 'Test AI',
    personality: 'Helpful',
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockTranscriptStore = new TranscriptStore('.transcripts') as jest.Mocked<TranscriptStore>;
    mockTranscriptStore.append = jest.fn().mockResolvedValue(undefined);
    mockTranscriptStore.getBySession = jest.fn().mockResolvedValue([]);

    agent = new EnhancedStratixAgent(createTestConfig(), createTestSoul());

    const runtime = new SessionRuntime('.transcripts', agent);
    (runtime as any).transcriptStore = mockTranscriptStore;
    (agent as any).runtime = runtime;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('executeAgentTurn uses enhanced prompt from session memory', async () => {
    const runtime = (agent as any).runtime as SessionRuntime;
    const session = await runtime.createSession('test-agent-turn');

    // Set up enhanced prompt in session memory (as chat() would do)
    session.memory.set('enhancedPrompt', [
      { role: 'system', content: 'You are a helpful assistant.' },
    ]);
    session.memory.set('recentMessages', []);
    session.memory.set('includeWorkflow', true);
    session.memory.set('includeReflection', false);

    const result = await agent.executeAgentTurn(session, 'Hello', 30000, undefined);

    expect(result.response).toBeDefined();
    expect(result.usage).toBeDefined();
  });

  test('executeAgentTurn falls back when no enhanced prompt', async () => {
    const runtime = (agent as any).runtime as SessionRuntime;
    const session = await runtime.createSession('test-agent-turn');
    // Don't set enhancedPrompt in memory

    const result = await agent.executeAgentTurn(session, 'Hello', 30000, undefined);

    expect(result.response).toBeDefined();
  });

  test('executeAgentTurn builds messages with system prompt and recent history', async () => {
    const runtime = (agent as any).runtime as SessionRuntime;
    const session = await runtime.createSession('test-agent-turn');

    session.memory.set('enhancedPrompt', [
      { role: 'system', content: 'You are a helpful assistant.' },
    ]);
    session.memory.set('recentMessages', [
      { role: 'user', content: 'Previous message' },
    ]);
    session.memory.set('includeWorkflow', true);
    session.memory.set('includeReflection', false);

    const result = await agent.executeAgentTurn(session, 'Hello', 30000, undefined);

    expect(result.response).toBeDefined();
  });
});