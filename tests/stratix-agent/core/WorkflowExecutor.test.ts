/**
 * WorkflowExecutor Unit Tests
 *
 * Tests workflow matching, execution, step processing, and error recovery.
 */

import { WorkflowExecutor } from '@/stratix-agent/core/WorkflowExecutor';
import type { LLMConnector } from '@/stratix-agent/core/LLMConnector';
import type { SkillRegistry } from '@/stratix-agent/core/SkillRegistry';
import type { SessionRuntime } from '@/stratix-agent/runtime/SessionRuntime';
import type { TranscriptStore } from '@/stratix-agent/runtime/TranscriptStore';
import type { AgentTemplate, WorkflowDefinition, WorkflowStep } from '@/stratix-agent/types/template';

const createMockLLM = (): jest.Mocked<LLMConnector> => ({
  generate: jest.fn().mockResolvedValue({ content: 'mocked response', finishReason: 'stop' }),
  generateStream: jest.fn().mockResolvedValue({ content: 'streamed response', finishReason: 'stop' }),
} as unknown as jest.Mocked<LLMConnector>);

const createMockTranscriptStore = (): jest.Mocked<TranscriptStore> => ({
  append: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<TranscriptStore>);

const createMockSessionRuntime = (opts?: { existingSessionId?: string }): jest.Mocked<SessionRuntime> => {
  const sessions = new Map<string, any>();
  if (opts?.existingSessionId) {
    sessions.set(opts.existingSessionId, {
      sessionId: opts.existingSessionId,
      agentId: 'test-agent',
      messages: [],
      status: 'active',
    });
  }
  const transcriptStore = createMockTranscriptStore();
  return {
    createSession: jest.fn().mockImplementation(async (agentId: string) => {
      const session = {
        sessionId: `sess_${Date.now()}`,
        agentId,
        messages: [],
        status: 'active',
      };
      sessions.set(session.sessionId, session);
      return session;
    }),
    getSession: jest.fn().mockImplementation(async (sessionId: string) => {
      return sessions.get(sessionId) || null;
    }),
    getTranscriptStore: jest.fn().mockReturnValue(transcriptStore),
  } as unknown as jest.Mocked<SessionRuntime>;
};

const createMockSkillRegistry = (): jest.Mocked<SkillRegistry> => ({
  getEnabledSkills: jest.fn().mockReturnValue([]),
} as unknown as jest.Mocked<SkillRegistry>);

const createTestStep = (overrides?: Partial<WorkflowStep>): WorkflowStep => ({
  id: 'step-1',
  order: 1,
  name: 'Test Step',
  description: 'A test step',
  expectedOutput: 'test output',
  ...overrides,
});

const createTestWorkflow = (overrides?: Partial<WorkflowDefinition>): WorkflowDefinition => ({
  id: 'wf-1',
  name: 'Test Workflow',
  description: 'A test workflow',
  steps: [createTestStep()],
  ...overrides,
});

const createTestTemplate = (workflows: WorkflowDefinition[]): AgentTemplate => ({
  id: 'test-template',
  name: 'Test Template',
  version: '1.0.0',
  description: 'Test',
  domain: 'engineering',
  tags: [],
  mixins: [],
  identity: 'Test',
  personality: 'Test',
  tone: 'Neutral',
  mission: 'Test',
  workflows,
  rules: [],
  constraints: [],
  forbiddenActions: [],
  skills: [],
  workflowSteps: [],
  successMetrics: [],
  metadata: {},
});

describe('WorkflowExecutor', () => {
  let executor: WorkflowExecutor;
  let mockLLM: jest.Mocked<LLMConnector>;
  let mockRuntime: jest.Mocked<SessionRuntime>;
  let mockSkills: jest.Mocked<SkillRegistry>;

  beforeEach(() => {
    mockLLM = createMockLLM();
    mockRuntime = createMockSessionRuntime();
    mockSkills = createMockSkillRegistry();
    executor = new WorkflowExecutor({
      llm: mockLLM,
      getRuntime: () => mockRuntime,
      skills: mockSkills,
      agentId: 'test-agent',
    });
  });

  describe('matchWorkflow', () => {
    test('returns null when template is null', () => {
      expect(executor.matchWorkflow('hello', null)).toBeNull();
    });

    test('returns null when template has no workflows', () => {
      const template = createTestTemplate([]);
      expect(executor.matchWorkflow('hello', template)).toBeNull();
    });

    test('matches by trigger condition', () => {
      const workflow = createTestWorkflow({
        triggerConditions: ['deploy'],
      });
      const template = createTestTemplate([workflow]);

      expect(executor.matchWorkflow('please deploy the app', template)).toBe(workflow);
      expect(executor.matchWorkflow('DEPLOY now', template)).toBe(workflow);
    });

    test('matches by step tool name', () => {
      const workflow = createTestWorkflow({
        steps: [createTestStep({ tools: ['docker'] })],
      });
      const template = createTestTemplate([workflow]);

      expect(executor.matchWorkflow('use docker', template)).toBe(workflow);
    });

    test('matches by step skill name', () => {
      const workflow = createTestWorkflow({
        steps: [createTestStep({ skills: ['git'] })],
      });
      const template = createTestTemplate([workflow]);

      expect(executor.matchWorkflow('use git', template)).toBe(workflow);
    });

    test('matches by step name', () => {
      const workflow = createTestWorkflow({
        steps: [createTestStep({ name: 'Build Project' })],
      });
      const template = createTestTemplate([workflow]);

      expect(executor.matchWorkflow('build project', template)).toBe(workflow);
    });

    test('returns null when nothing matches', () => {
      const workflow = createTestWorkflow({
        triggerConditions: ['deploy'],
        steps: [createTestStep({ tools: ['docker'] })],
      });
      const template = createTestTemplate([workflow]);

      expect(executor.matchWorkflow('hello world', template)).toBeNull();
    });

    test('returns first matching workflow', () => {
      const wf1 = createTestWorkflow({ id: 'wf-1', triggerConditions: ['deploy'] });
      const wf2 = createTestWorkflow({ id: 'wf-2', triggerConditions: ['build'] });
      const template = createTestTemplate([wf1, wf2]);

      expect(executor.matchWorkflow('deploy app', template)).toBe(wf1);
      expect(executor.matchWorkflow('build app', template)).toBe(wf2);
    });
  });

  describe('executeWorkflow', () => {
    test('executes workflow and creates new session', async () => {
      const workflow = createTestWorkflow({
        steps: [createTestStep({ name: 'Step 1', description: 'Do something' })],
      });

      mockLLM.generate.mockResolvedValue({ content: 'step result', finishReason: 'stop' });

      const result = await executor.executeWorkflow(workflow, 'hello');

      expect(result.sessionId).toBeDefined();
      expect(result.workflowUsed).toBe('Test Workflow');
      expect(result.response).toContain('[开始执行工作流: Test Workflow]');
      expect(result.response).toContain('step result');
      expect(mockRuntime.createSession).toHaveBeenCalledWith('test-agent');
    });

    test('reuses existing session when sessionId provided', async () => {
      const existingSessionId = 'sess_existing_123';
      mockRuntime = createMockSessionRuntime({ existingSessionId });
      executor = new WorkflowExecutor({
        llm: mockLLM,
        getRuntime: () => mockRuntime,
        skills: mockSkills,
        agentId: 'test-agent',
      });

      const workflow = createTestWorkflow({
        steps: [createTestStep()],
      });
      mockLLM.generate.mockResolvedValue({ content: 'result', finishReason: 'stop' });

      const result = await executor.executeWorkflow(workflow, 'hello', { sessionId: existingSessionId });

      expect(result.sessionId).toBe(existingSessionId);
      expect(mockRuntime.getSession).toHaveBeenCalledWith(existingSessionId);
      expect(mockRuntime.createSession).not.toHaveBeenCalled();
    });

    test('creates new session when provided sessionId does not exist', async () => {
      const workflow = createTestWorkflow({
        steps: [createTestStep()],
      });
      mockLLM.generate.mockResolvedValue({ content: 'result', finishReason: 'stop' });

      const result = await executor.executeWorkflow(workflow, 'hello', { sessionId: 'non-existent' });

      expect(mockRuntime.getSession).toHaveBeenCalledWith('non-existent');
      expect(mockRuntime.createSession).toHaveBeenCalledWith('test-agent');
      expect(result.sessionId).not.toBe('non-existent');
    });

    test('executes multiple steps sequentially', async () => {
      const workflow = createTestWorkflow({
        steps: [
          createTestStep({ id: 's1', order: 1, name: 'First' }),
          createTestStep({ id: 's2', order: 2, name: 'Second' }),
        ],
      });

      mockLLM.generate
        .mockResolvedValueOnce({ content: 'first result', finishReason: 'stop' })
        .mockResolvedValueOnce({ content: 'second result', finishReason: 'stop' });

      const result = await executor.executeWorkflow(workflow, 'hello');

      expect(result.response).toContain('[Step 1: First]');
      expect(result.response).toContain('[Step 2: Second]');
      expect(result.response).toContain('first result');
      expect(result.response).toContain('second result');
      expect(mockLLM.generate).toHaveBeenCalledTimes(2);
    });

    test('executes nextSteps when defined', async () => {
      const workflow = createTestWorkflow({
        steps: [
          createTestStep({ id: 's1', order: 1, name: 'First', nextSteps: ['s2'] }),
          createTestStep({ id: 's2', order: 2, name: 'Second' }),
        ],
      });

      mockLLM.generate
        .mockResolvedValueOnce({ content: 'first result', finishReason: 'stop' })
        .mockResolvedValueOnce({ content: 'second result', finishReason: 'stop' });

      const result = await executor.executeWorkflow(workflow, 'hello');

      expect(result.response).toContain('[Step 1: First]');
      expect(result.response).toContain('[Step 2: Second]');
      // Step 1 executes, then nextSteps triggers step 2, then loop also hits step 2
      expect(mockLLM.generate).toHaveBeenCalledTimes(3);
    });

    test('handles step error with stop strategy', async () => {
      const workflow = createTestWorkflow({
        steps: [
          createTestStep({ id: 's1', order: 1, name: 'Error Step', onError: 'stop' }),
        ],
      });

      mockLLM.generate
        .mockResolvedValueOnce({ content: '[ERROR] something went wrong', finishReason: 'stop' })
        .mockResolvedValueOnce({ content: 'error analysis', finishReason: 'stop' });

      const result = await executor.executeWorkflow(workflow, 'hello');

      expect(result.response).toContain('[ERROR]');
      expect(result.response).toContain('error analysis');
    });

    test('handles step exception gracefully', async () => {
      const workflow = createTestWorkflow({
        steps: [
          createTestStep({ id: 's1', order: 1, name: 'Fail Step', onError: 'continue' }),
          createTestStep({ id: 's2', order: 2, name: 'Recovery Step' }),
        ],
      });

      mockLLM.generate
        .mockRejectedValueOnce(new Error('LLM failure'))
        .mockResolvedValueOnce({ content: 'recovery result', finishReason: 'stop' });

      const result = await executor.executeWorkflow(workflow, 'hello');

      expect(result.response).toContain('[ERROR in Step 1]: Error: LLM failure');
      expect(result.response).toContain('recovery result');
    });

    test('saves messages to session and transcript', async () => {
      const workflow = createTestWorkflow({
        steps: [createTestStep()],
      });
      mockLLM.generate.mockResolvedValue({ content: 'result', finishReason: 'stop' });

      const result = await executor.executeWorkflow(workflow, 'user message');

      const transcriptStore = mockRuntime.getTranscriptStore();
      expect(transcriptStore.append).toHaveBeenCalledTimes(2);
      const calls = (transcriptStore.append as jest.Mock).mock.calls;
      expect(calls[0][0].role).toBe('user');
      expect(calls[0][0].content).toBe('user message');
      expect(calls[1][0].role).toBe('assistant');
      expect(calls[1][0].content).toContain('result');
    });
  });

  describe('executeWorkflowStep', () => {
    test('calls LLM with correct prompt', async () => {
      const step = createTestStep({
        name: 'Analyze Code',
        description: 'Analyze the code quality',
        expectedOutput: 'Quality report',
      });

      mockLLM.generate.mockResolvedValue({ content: 'quality report', finishReason: 'stop' });

      const result = await (executor as any).executeWorkflowStep(step, 'some code');

      expect(result).toBe('quality report');
      expect(mockLLM.generate).toHaveBeenCalledTimes(1);
      const messages = (mockLLM.generate as jest.Mock).mock.calls[0][0];
      expect(messages[0].content).toContain('任务: Analyze the code quality');
      expect(messages[0].content).toContain('上下文: some code');
      expect(messages[0].content).toContain('预期输出: Quality report');
    });

    test('includes relevant skills in prompt', async () => {
      const step = createTestStep({
        skills: ['code-review'],
      });

      mockSkills.getEnabledSkills.mockReturnValue([
        { skillId: 'code-review', name: 'Code Review', description: 'Reviews code', parameters: [], executor: 'test' },
        { skillId: 'other-skill', name: 'Other', description: 'Other skill', parameters: [], executor: 'test' },
      ]);

      mockLLM.generate.mockResolvedValue({ content: 'result', finishReason: 'stop' });

      await (executor as any).executeWorkflowStep(step, 'context');

      const messages = (mockLLM.generate as jest.Mock).mock.calls[0][0];
      expect(messages[0].content).toContain('Code Review');
      expect(messages[0].content).not.toContain('Other');
    });

    test('uses stream when stream option provided', async () => {
      const step = createTestStep();
      const onChunk = jest.fn();

      mockLLM.generateStream.mockResolvedValue({ content: 'streamed result', finishReason: 'stop' });

      const result = await (executor as any).executeWorkflowStep(step, 'context', { stream: true, onChunk });

      expect(result).toBe('streamed result');
      expect(mockLLM.generateStream).toHaveBeenCalled();
    });

    test('uses regular generate when stream option missing onChunk', async () => {
      const step = createTestStep();

      mockLLM.generate.mockResolvedValue({ content: 'regular result', finishReason: 'stop' });

      const result = await (executor as any).executeWorkflowStep(step, 'context', { stream: true });

      expect(result).toBe('regular result');
      expect(mockLLM.generate).toHaveBeenCalled();
      expect(mockLLM.generateStream).not.toHaveBeenCalled();
    });
  });

  describe('handleWorkflowError', () => {
    test('calls LLM with error analysis prompt', async () => {
      const step = createTestStep({ name: 'Build Step' });

      mockLLM.generate.mockResolvedValue({ content: 'error solution', finishReason: 'stop' });

      const result = await (executor as any).handleWorkflowError(step, 'build failed');

      expect(result).toBe('error solution');
      const messages = (mockLLM.generate as jest.Mock).mock.calls[0][0];
      expect(messages[0].content).toContain('错误发生在了步骤: Build Step');
      expect(messages[0].content).toContain('build failed');
    });
  });
});
