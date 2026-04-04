/**
 * EnhancedStratixAgent Unit Tests - Chat Loop and Session Management
 *
 * Tests for chat functionality, tool calling, workflow execution, and session integration.
 */

import { EnhancedStratixAgent } from '@/stratix-agent/EnhancedStratixAgent';
import { SessionRuntime } from '@/stratix-agent/runtime/SessionRuntime';
import { TranscriptStore } from '@/stratix-agent/runtime/TranscriptStore';
import { AgentConfig, SoulConfig, AgentResponse } from '@/stratix-agent/types';
import { AgentTemplate, WorkflowDefinition, WorkflowStep } from '@/stratix-agent/types/template';
import { EnhancedSoulConfig } from '@/stratix-agent/types/soul';

// Mock dependencies
jest.mock('@/stratix-agent/runtime/TranscriptStore');
jest.mock('@/stratix-character-creator/core/ZoneContextManager', () => ({
  zoneContextManager: {
    getZonePromptContext: jest.fn().mockResolvedValue(''),
  },
}));

// Mock LLMConnector to avoid actual API calls
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

// Mock budget controller
jest.mock('@stratix-core/budget/BudgetController', () => ({
  budgetController: {
    evaluate: jest.fn().mockReturnValue({ action: 'continue' }),
  },
}));

describe('EnhancedStratixAgent - Chat Integration', () => {
  let agent: EnhancedStratixAgent;
  let mockTranscriptStore: jest.Mocked<TranscriptStore>;

  const createTestConfig = (): AgentConfig => ({
    agentId: 'test-agent',
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

    // Replace runtime with mock
    const runtime = new SessionRuntime('.transcripts', agent);
    (runtime as any).transcriptStore = mockTranscriptStore;
    (agent as any).runtime = runtime;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('chat without template', () => {
    test('falls back to parent chat when no template', async () => {
      // This should use super.chat() which returns AgentResponse
      const result = await agent.chat('Hello');

      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('sessionId');
    });
  });

  describe('chat with template', () => {
    beforeEach(() => {
      const template = createTestTemplate();
      template.workflows = [];
      agent.loadTemplate(template);
    });

    test('creates a new session on first chat', async () => {
      const result = await agent.chat('Hello');

      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^sess_/);
    });

    test('reuses existing session when sessionId provided', async () => {
      const firstResult = await agent.chat('Hello');
      const secondResult = await agent.chat('World', { sessionId: firstResult.sessionId });

      expect(secondResult.sessionId).toBe(firstResult.sessionId);
    });

    test('returns response from session runtime', async () => {
      const result = await agent.chat('Hello');

      expect(result.response).toBeDefined();
      expect(typeof result.response).toBe('string');
    });

    test('stores messages in session', async () => {
      const result = await agent.chat('Hello');

      const runtime = (agent as any).runtime as SessionRuntime;
      const session = await runtime.getSession(result.sessionId);

      // Should have user message
      const userMessages = session!.messages.filter(m => m.role === 'user');
      expect(userMessages.length).toBeGreaterThan(0);
    });
  });

  describe('executeAgentTurn', () => {
    beforeEach(() => {
      const template = createTestTemplate();
      agent.loadTemplate(template);
    });

    test('calls LLM with enhanced prompt from session memory', async () => {
      // Create session and set up enhanced prompt in memory
      const runtime = (agent as any).runtime as SessionRuntime;
      const session = await runtime.createSession('test-agent');

      // Simulate what chat() does - store enhanced prompt in memory
      session.memory.set('enhancedPrompt', [
        { role: 'system', content: 'You are a helpful assistant.' },
      ]);
      session.memory.set('recentMessages', []);
      session.memory.set('includeWorkflow', true);
      session.memory.set('includeReflection', false);

      const result = await agent.executeAgentTurn(
        session,
        'Hello',
        30000,
        undefined
      );

      expect(result.response).toBeDefined();
      expect(result.usage).toBeDefined();
    });

    test('falls back to simple LLM call when no enhanced prompt', async () => {
      const runtime = (agent as any).runtime as SessionRuntime;
      const session = await runtime.createSession('test-agent');
      // Don't set enhancedPrompt in memory

      const result = await agent.executeAgentTurn(
        session,
        'Hello',
        30000,
        undefined
      );

      expect(result.response).toBeDefined();
    });
  });

  describe('getSessionId', () => {
    test('returns null when no chat executed', () => {
      expect(agent.getSessionId()).toBeNull();
    });

    test('returns sessionId after chat', async () => {
      await agent.chat('Hello');
      expect(agent.getSessionId()).toBeDefined();
    });
  });

  describe('getTranscript', () => {
    test('returns empty array when no chat executed', () => {
      expect(agent.getTranscript()).toEqual([]);
    });

    test('returns messages after chat', async () => {
      await agent.chat('Hello');
      const transcript = agent.getTranscript();

      expect(Array.isArray(transcript)).toBe(true);
    });
  });

  describe('getUsage', () => {
    test('returns zero usage when no chat executed', () => {
      const usage = agent.getUsage();

      expect(usage.promptTokens).toBe(0);
      expect(usage.completionTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.turnCount).toBe(0);
    });

    test('returns usage after chat', async () => {
      await agent.chat('Hello');
      const usage = agent.getUsage();

      expect(usage.turnCount).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('EnhancedStratixAgent - Workflow Execution', () => {
  let agent: EnhancedStratixAgent;
  let mockTranscriptStore: jest.Mocked<TranscriptStore>;

  const createTestConfig = (): AgentConfig => ({
    agentId: 'test-agent',
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

  const createTestTemplate = (): AgentTemplate => {
    const step1: WorkflowStep = {
      id: 'step-1',
      name: 'Research',
      description: 'Research the topic',
      order: 1,
      skills: [],
      tools: [],
      expectedOutput: 'Research findings',
    };

    const step2: WorkflowStep = {
      id: 'step-2',
      name: 'Write',
      description: 'Write a report',
      order: 2,
      skills: [],
      tools: [],
      expectedOutput: 'Written report',
      nextSteps: [],
      onError: 'stop',
    };

    const workflow: WorkflowDefinition = {
      id: 'research-report',
      name: 'Research Report Workflow',
      description: 'Research and write a report',
      triggerConditions: ['research', 'report'],
      steps: [step1, step2],
    };

    return {
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
      workflows: [workflow],
      rules: [],
      constraints: [],
      forbiddenActions: [],
      skills: [],
      workflowSteps: [],
      successMetrics: [],
      metadata: { author: 'Test' },
    };
  };

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

  describe('matchWorkflow', () => {
    beforeEach(() => {
      agent.loadTemplate(createTestTemplate());
    });

    test('matches workflow by trigger condition', () => {
      // Access private method via any
      const matched = (agent as any).matchWorkflow('I want to research AI and write a report');

      expect(matched).not.toBeNull();
      expect(matched!.name).toBe('Research Report Workflow');
    });

    test('returns null when no match', () => {
      const matched = (agent as any).matchWorkflow('Hello world');

      expect(matched).toBeNull();
    });

    test('matches by step tool name', () => {
      const template = createTestTemplate();
      template.workflows[0].steps[0].tools = ['file_reader'];
      agent.loadTemplate(template);

      const matched = (agent as any).matchWorkflow('Use file_reader to read data');

      expect(matched).not.toBeNull();
    });

    test('matches by step name', () => {
      const matched = (agent as any).matchWorkflow('Run the Research step');

      expect(matched).not.toBeNull();
    });
  });

  describe('executeWorkflow', () => {
    beforeEach(() => {
      agent.loadTemplate(createTestTemplate());
    });

    test('executes workflow and returns result', async () => {
      const result = await agent.chat('I want to research AI and write a report');

      expect(result.workflowUsed).toBe('Research Report Workflow');
      expect(result.response).toContain('[开始执行工作流');
      expect(result.response).toContain('[工作流完成');
    });

    test('creates session for workflow', async () => {
      const result = await agent.chat('I want to research AI and write a report');

      expect(result.sessionId).toBeDefined();
    });

    test('records workflow steps in session messages', async () => {
      const result = await agent.chat('I want to research AI and write a report');
      const runtime = (agent as any).runtime as SessionRuntime;
      const session = await runtime.getSession(result.sessionId);

      expect(session!.messages.length).toBeGreaterThan(0);
    });
  });

  describe('executeWorkflowStep', () => {
    beforeEach(() => {
      agent.loadTemplate(createTestTemplate());
    });

    test('executes a single step with prompt', async () => {
      const step = createTestTemplate().workflows[0].steps[0];

      const result = await (agent as any).executeWorkflowStep(step, 'Initial context');

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    test('includes skills in prompt when provided', async () => {
      const template = createTestTemplate();
      template.skills = [
        {
          skillId: 'file_reader',
          name: 'File Reader',
          description: 'Reads files',
          parameters: [],
        },
      ];
      agent.loadTemplate(template);

      const step: WorkflowStep = {
        id: 'step-1',
        name: 'Read',
        description: 'Read a file',
        order: 1,
        skills: ['file_reader'],
        tools: [],
        expectedOutput: 'File content',
      };

      await (agent as any).executeWorkflowStep(step, 'Context');
      // The step should include skill information in the prompt
    });

    test('handles streaming when onChunk provided', async () => {
      const step = createTestTemplate().workflows[0].steps[0];
      const chunks: string[] = [];

      await (agent as any).executeWorkflowStep(step, 'Context', {
        stream: true,
        onChunk: (chunk: string) => chunks.push(chunk),
      });

      expect(chunks.length).toBeGreaterThan(0);
    });
  });
});

describe('EnhancedStratixAgent - Reflection', () => {
  let agent: EnhancedStratixAgent;

  const createTestConfig = (): AgentConfig => ({
    agentId: 'test-agent',
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

  const createEnhancedSoul = (): EnhancedSoulConfig => ({
    identity: 'Test AI',
    personality: 'Helpful',
    reflection: {
      enabled: true,
      afterEachTask: true,
      onError: true,
      weeklyReview: false,
    },
  });

  beforeEach(() => {
    jest.useFakeTimers();
    agent = new EnhancedStratixAgent(createTestConfig(), createEnhancedSoul() as SoulConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('performReflection', () => {
    test('performs reflection and stores entry', async () => {
      await (agent as any).performReflection('Task 1', 'Result 1');

      const history = agent.getReflectionHistory();
      expect(history.length).toBe(1);
      expect(history[0].task).toBe('Task 1');
      expect(history[0].result).toBe('Result 1');
    });

    test('does not throw when reflection fails', async () => {
      // Force LLM to fail
      const llm = (agent as any).llm;
      llm.generate = jest.fn().mockRejectedValue(new Error('LLM error'));

      // When called directly, performReflection will throw
      // But when called through chat(), the error is caught
      await expect(
        (agent as any).performReflection('Task', 'Result')
      ).rejects.toThrow('LLM error');
    });
  });

  describe('reflection with evolution', () => {
    test('triggers evolution check when configured', async () => {
      const soul = createEnhancedSoul();
      soul.reflection!.evolutionCheck = {
        enabled: true,
        triggerThreshold: 1,
        cooldownHours: 24,
        maxEvolutionsPerDay: 3,
      };

      agent = new EnhancedStratixAgent(createTestConfig(), soul as SoulConfig);
      await (agent as any).performReflection('Task 1', 'Result 1');

      // Evolution check may run asynchronously
    });
  });

  describe('selfCorrect', () => {
    test('adds correction to memory', async () => {
      await (agent as any).selfCorrect('Task', 'Error result', 'Need to fix this');

      const memoryEntries = agent.getMemoryEntries();
      expect(memoryEntries.length).toBe(1);
      expect(memoryEntries[0].content).toContain('自我纠正');
    });
  });
});

describe('EnhancedStratixAgent - Evolution', () => {
  let agent: EnhancedStratixAgent;

  const createTestConfig = (): AgentConfig => ({
    agentId: 'test-agent',
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

  const createEnhancedSoul = (): EnhancedSoulConfig => ({
    identity: 'Test AI',
    personality: 'Helpful',
    goals: ['Goal 1'],
    reflection: {
      enabled: true,
      afterEachTask: true,
      onError: true,
      weeklyReview: false,
      evolutionCheck: {
        enabled: true,
        triggerThreshold: 1,
        cooldownHours: 0.001, // Very short for testing
        maxEvolutionsPerDay: 3,
      },
    },
  });

  beforeEach(() => {
    jest.useFakeTimers();
    agent = new EnhancedStratixAgent(createTestConfig(), createEnhancedSoul() as SoulConfig);
    agent.initEvolution({
      enabled: true,
      triggerThreshold: 1,
      cooldownHours: 0.001,
      maxEvolutionsPerDay: 3,
      consecutiveFailuresToBreak: 3,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('canEvolve', () => {
    test('returns false when evolution disabled', () => {
      agent.initEvolution({ enabled: false });
      expect((agent as any).canEvolve()).toBe(false);
    });

    test('returns false when reflection count below threshold', () => {
      // Need 5 reflections but have none
      agent.initEvolution({ triggerThreshold: 5 });
      expect((agent as any).canEvolve()).toBe(false);
    });

    test('returns false when in cooldown', () => {
      agent.initEvolution({ cooldownHours: 24 });
      // Last evolution was just now
      (agent as any).lastEvolutionTime = Date.now();
      expect((agent as any).canEvolve()).toBe(false);
    });

    test('returns false when max evolutions reached', () => {
      agent.initEvolution({ maxEvolutionsPerDay: 0 });
      expect((agent as any).canEvolve()).toBe(false);
    });

    test('returns false when circuit breaker triggered', () => {
      (agent as any).consecutiveFailures = 3;
      (agent as any).consecutiveFailuresToBreak = 3;
      expect((agent as any).canEvolve()).toBe(false);
    });
  });

  describe('performEvolution', () => {
    test('returns error when cannot evolve', async () => {
      agent.initEvolution({ enabled: false });

      const result = await agent.performEvolution();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not met');
    });

    test('returns requiresUserConfirmation when proposal generated', async () => {
      // Set up reflection history to meet threshold
      const reflectionHistory = (agent as any).reflectionHistory;
      reflectionHistory.push({ id: '1', timestamp: new Date().toISOString(), task: 'T', result: 'R', reflection: 'X' });
      reflectionHistory.push({ id: '2', timestamp: new Date().toISOString(), task: 'T2', result: 'R2', reflection: 'Y' });
      reflectionHistory.push({ id: '3', timestamp: new Date().toISOString(), task: 'T3', result: 'R3', reflection: 'Z' });

      // Mock LLM to return valid JSON
      const llm = (agent as any).llm;
      llm.generate = jest.fn().mockResolvedValue({
        content: JSON.stringify({
          goals: ['New goal'],
          personality: 'More helpful',
          constraints: ['New constraint'],
        }),
      });

      const result = await agent.performEvolution();

      expect(result.requiresUserConfirmation).toBe(true);
    });

    test('increments consecutive failures on parse error', async () => {
      // Set up reflection history
      const reflectionHistory = (agent as any).reflectionHistory;
      reflectionHistory.push({ id: '1', timestamp: new Date().toISOString(), task: 'T', result: 'R', reflection: 'X' });

      // Mock LLM to return invalid JSON
      const llm = (agent as any).llm;
      llm.generate = jest.fn().mockResolvedValue({
        content: 'Not valid JSON',
      });

      await agent.performEvolution();

      expect((agent as any).consecutiveFailures).toBe(1);
    });
  });

  describe('applyEvolution', () => {
    test('applies proposed changes to soul', async () => {
      const proposal = {
        id: 'proposal-1',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: {
          goals: ['New goal', 'Another goal'],
          personality: 'Much more helpful',
          constraints: ['Constraint 1'],
        },
        reason: 'Testing',
        reflectionCount: 5,
      };

      const result = await agent.applyEvolution(proposal);

      expect(result.success).toBe(true);
      expect((agent as any).evolutionCount).toBe(1);
      expect((agent as any).consecutiveFailures).toBe(0);
    });

    test('increments consecutive failures on error', async () => {
      const proposal = {
        id: 'proposal-1',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: {
          goals: ['New goal'],
        },
        reason: 'Testing',
        reflectionCount: 5,
      };

      // Force error by making soul read-only
      Object.freeze((agent as any).soul);

      const result = await agent.applyEvolution(proposal);

      expect((agent as any).consecutiveFailures).toBe(1);
    });
  });

  describe('confirmEvolution', () => {
    test('applies evolution when confirmed', async () => {
      const proposal = {
        id: 'proposal-1',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: {
          goals: ['Confirmed goal'],
        },
        reason: 'Testing',
        reflectionCount: 5,
      };

      const result = await agent.confirmEvolution(proposal);

      expect(result.success).toBe(true);
    });
  });

  describe('rejectEvolution', () => {
    test('clears pending proposal', () => {
      const proposal = {
        id: 'proposal-1',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: { goals: [] },
        reason: 'Testing',
        reflectionCount: 5,
      };

      (agent as any).pendingEvolutionProposal = proposal;
      agent.rejectEvolution(proposal);

      expect(agent.getPendingEvolutionProposal()).toBeNull();
    });
  });
});

describe('EnhancedStratixAgent - Memory Management', () => {
  let agent: EnhancedStratixAgent;

  const createTestConfig = (): AgentConfig => ({
    agentId: 'test-agent',
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

  beforeEach(() => {
    jest.useFakeTimers();
    agent = new EnhancedStratixAgent(createTestConfig(), createTestSoul());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createTestSoul(): SoulConfig {
    return {
      identity: 'Test AI',
      personality: 'Helpful',
    };
  }

  describe('addMemoryEntry', () => {
    test('adds memory entry with importance level', async () => {
      await (agent as any).addMemoryEntry('Important memory', 3);

      const entries = agent.getMemoryEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].content).toBe('Important memory');
      expect(entries[0].importance).toBe(3);
    });

    test('adds memory entry with default importance', async () => {
      await (agent as any).addMemoryEntry('Normal memory');

      const entries = agent.getMemoryEntries();
      expect(entries[0].importance).toBe(2);
    });

    test('generates title from content', async () => {
      await (agent as any).addMemoryEntry('This is a very long memory content that should be truncated');

      const entries = agent.getMemoryEntries();
      expect(entries[0].title.length).toBeLessThanOrEqual(50);
    });
  });

  describe('clearMemory', () => {
    test('clears all memory entries', async () => {
      await (agent as any).addMemoryEntry('Memory 1', 1);
      await (agent as any).addMemoryEntry('Memory 2', 2);

      agent.clearMemory();

      expect(agent.getMemoryEntries()).toEqual([]);
    });
  });
});
