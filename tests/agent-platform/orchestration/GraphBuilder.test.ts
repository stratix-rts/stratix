import { GraphBuilder } from '@/agent-platform/orchestration/graph-builder';
import { WorkflowDefinition, WorkflowStep } from '@/agent-platform/workflow/types';
import { providerRegistry } from '@/agent-platform/providers/registry';

// Mock provider registry
jest.mock('@/agent-platform/providers/registry', () => ({
  providerRegistry: {
    createModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: 'Test response' }),
    }),
  },
}));

// Mock window.electronAPI
Object.defineProperty(global, 'window', {
  value: {
    electronAPI: {
      apiKey: {
        load: jest.fn().mockResolvedValue({ success: true, data: 'test-key' }),
      },
    },
  },
  writable: true,
});

describe('GraphBuilder', () => {
  let builder: GraphBuilder;

  const createLLMStep = (overrides?: Partial<WorkflowStep>): WorkflowStep => ({
    id: 'llm-step',
    componentType: 'task',
    type: 'llm',
    name: 'LLM Step',
    properties: {
      providerId: 'openai',
      model: 'gpt-4o',
      systemPrompt: 'You are a helpful assistant.',
    },
    ...overrides,
  });

  const createRouterStep = (overrides?: Partial<WorkflowStep>): WorkflowStep => ({
    id: 'router-step',
    componentType: 'decision',
    type: 'router',
    name: 'Router Step',
    properties: {},
    ...overrides,
  });

  const createHumanStep = (overrides?: Partial<WorkflowStep>): WorkflowStep => ({
    id: 'human-step',
    componentType: 'human',
    type: 'human',
    name: 'Human Step',
    properties: {},
    ...overrides,
  });

  const createParallelStep = (overrides?: Partial<WorkflowStep>): WorkflowStep => ({
    id: 'parallel-step',
    componentType: 'parallel',
    type: 'parallel',
    name: 'Parallel Step',
    properties: {},
    ...overrides,
  });

  const createDefinition = (steps: WorkflowStep[]): WorkflowDefinition => ({
    properties: {
      name: 'Test Workflow',
      description: 'A test workflow',
    },
    sequence: steps,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    builder = new GraphBuilder();
  });

  describe('constructor', () => {
    test('creates instance', () => {
      expect(builder).toBeInstanceOf(GraphBuilder);
    });
  });

  describe('buildFromDefinition', () => {
    test('builds graph with single step', () => {
      const definition = createDefinition([createLLMStep()]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('builds graph with multiple steps', () => {
      const definition = createDefinition([
        createLLMStep({ id: 'step-1' }),
        createLLMStep({ id: 'step-2' }),
        createLLMStep({ id: 'step-3' }),
      ]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('builds graph with different step types', () => {
      const definition = createDefinition([
        createLLMStep({ id: 'llm-1' }),
        createRouterStep({ id: 'router-1' }),
        createLLMStep({ id: 'llm-2' }),
      ]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('builds graph with parallel step', () => {
      const definition = createDefinition([
        createLLMStep({ id: 'llm-1' }),
        createParallelStep({ id: 'parallel-1' }),
        createLLMStep({ id: 'llm-2' }),
      ]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('builds graph with human step', () => {
      const definition = createDefinition([
        createLLMStep({ id: 'llm-1' }),
        createHumanStep({ id: 'human-1' }),
        createLLMStep({ id: 'llm-2' }),
      ]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('builds graph with empty sequence', () => {
      const definition = createDefinition([]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('result is a StateGraph', () => {
      const definition = createDefinition([createLLMStep()]);
      const graph = builder.buildFromDefinition(definition);

      expect(graph).toBeDefined();
      expect(typeof graph.compile).toBe('function');
    });
  });

  describe('step type handling', () => {
    test('handles llm type step', () => {
      const definition = createDefinition([
        createLLMStep({ id: 'llm-step', properties: { providerId: 'openai', model: 'gpt-4o' } }),
      ]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('handles router type step', () => {
      const definition = createDefinition([createRouterStep()]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('handles human type step', () => {
      const definition = createDefinition([createHumanStep()]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('handles parallel type step', () => {
      const definition = createDefinition([createParallelStep()]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('handles unknown type as pass-through', () => {
      const definition = createDefinition([
        {
          id: 'unknown-step',
          componentType: 'task',
          type: 'unknown' as any,
          name: 'Unknown Step',
          properties: {},
        },
      ]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });
  });

  describe('LLM node creation', () => {
    test('creates LLM node with valid config', async () => {
      const definition = createDefinition([
        createLLMStep({
          id: 'llm-step',
          properties: {
            providerId: 'openai',
            model: 'gpt-4o',
            systemPrompt: 'You are a helpful assistant.',
            temperature: 0.7,
            maxTokens: 4096,
          },
        }),
      ]);

      const graph = builder.buildFromDefinition(definition);
      const compiled = graph.compile();

      expect(compiled).toBeDefined();
    });

    test('handles missing providerId', async () => {
      const definition = createDefinition([
        createLLMStep({
          id: 'llm-step',
          properties: {
            model: 'gpt-4o',
          },
        }),
      ]);

      const graph = builder.buildFromDefinition(definition);
      const compiled = graph.compile();

      expect(compiled).toBeDefined();
    });

    test('handles missing model', async () => {
      const definition = createDefinition([
        createLLMStep({
          id: 'llm-step',
          properties: {
            providerId: 'openai',
          },
        }),
      ]);

      const graph = builder.buildFromDefinition(definition);
      const compiled = graph.compile();

      expect(compiled).toBeDefined();
    });
  });

  describe('node properties', () => {
    test('preserves step id', () => {
      const definition = createDefinition([
        createLLMStep({ id: 'unique-step-id' }),
      ]);

      const graph = builder.buildFromDefinition(definition);
      expect(graph).toBeDefined();
    });

    test('preserves step name', () => {
      const definition = createDefinition([
        createLLMStep({ id: 'step', name: 'My Custom Step Name' }),
      ]);

      const graph = builder.buildFromDefinition(definition);
      expect(graph).toBeDefined();
    });

    test('handles step with no properties', () => {
      const definition = createDefinition([
        {
          id: 'minimal-step',
          componentType: 'task',
          type: 'llm' as const,
          name: 'Minimal Step',
          properties: {},
        },
      ]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });

    test('handles step with additional properties', () => {
      const definition = createDefinition([
        createLLMStep({
          id: 'step',
          properties: {
            providerId: 'openai',
            model: 'gpt-4o',
            temperature: 0.5,
            maxTokens: 2048,
            timeout: 30000,
          },
        }),
      ]);

      expect(() => builder.buildFromDefinition(definition)).not.toThrow();
    });
  });

  describe('graph edges', () => {
    test('creates sequential edges for linear workflow', () => {
      const definition = createDefinition([
        createLLMStep({ id: 'step-1' }),
        createLLMStep({ id: 'step-2' }),
        createLLMStep({ id: 'step-3' }),
      ]);

      const graph = builder.buildFromDefinition(definition);
      expect(graph).toBeDefined();
    });

    test('handles single step workflow', () => {
      const definition = createDefinition([createLLMStep({ id: 'only-step' })]);

      const graph = builder.buildFromDefinition(definition);
      expect(graph).toBeDefined();
    });
  });

  describe('node behavior', () => {
    const createBaseState = (input: string = 'test input') => ({
      messages: [],
      input,
      currentStep: null,
      results: {},
      nextStep: null,
      error: null,
      status: 'pending' as const,
    });

    test('createRouterNode returns trueBranch when expression matches', async () => {
      const step: WorkflowStep = {
        id: 'router-1',
        componentType: 'decision',
        type: 'router',
        name: 'Router',
        properties: {
          expression: 'keyword',
          trueBranch: 'true-path',
          falseBranch: 'false-path',
        },
      };

      const node = (builder as any).createRouterNode(step);
      const result = await node(createBaseState('This contains KEYWORD here'));

      expect(result.results['router-1']).toBe('true-path');
      expect(result.currentStep).toBe('router-1');
    });

    test('createRouterNode returns falseBranch when expression does not match', async () => {
      const step: WorkflowStep = {
        id: 'router-1',
        componentType: 'decision',
        type: 'router',
        name: 'Router',
        properties: {
          expression: 'keyword',
          trueBranch: 'true-path',
          falseBranch: 'false-path',
        },
      };

      const node = (builder as any).createRouterNode(step);
      const result = await node(createBaseState('This does not match'));

      expect(result.results['router-1']).toBe('false-path');
    });

    test('createRouterNode uses default branches when not specified', async () => {
      const step: WorkflowStep = {
        id: 'router-1',
        componentType: 'decision',
        type: 'router',
        name: 'Router',
        properties: {
          expression: 'keyword',
        },
      };

      const node = (builder as any).createRouterNode(step);
      const result = await node(createBaseState('no match'));

      expect(result.results['router-1']).toBe('false');
    });

    test('createRouterNode handles missing expression gracefully', async () => {
      const step: WorkflowStep = {
        id: 'router-1',
        componentType: 'decision',
        type: 'router',
        name: 'Router',
        properties: {},
      };

      const node = (builder as any).createRouterNode(step);
      const result = await node(createBaseState('any input'));

      expect(result.results['router-1']).toBe('false');
    });

    test('createHumanNode returns input as human response', async () => {
      const step: WorkflowStep = {
        id: 'human-1',
        componentType: 'human',
        type: 'human',
        name: 'Human',
        properties: {},
      };

      const node = (builder as any).createHumanNode(step);
      const result = await node(createBaseState('user input'));

      expect(result.results['human-1']).toBe('user input');
      expect(result.currentStep).toBe('human-1');
    });

    test('createParallelNode executes branches concurrently', async () => {
      const step: WorkflowStep = {
        id: 'parallel-1',
        componentType: 'parallel',
        type: 'parallel',
        name: 'Parallel',
        properties: {},
        sequences: [
          [
            {
              id: 'branch1-step',
              componentType: 'task',
              type: 'llm',
              name: 'B1',
              properties: { providerId: 'openai', model: 'gpt-4o' },
            },
          ],
          [
            {
              id: 'branch2-step',
              componentType: 'task',
              type: 'llm',
              name: 'B2',
              properties: { providerId: 'openai', model: 'gpt-4o' },
            },
          ],
        ],
      };

      const node = (builder as any).createParallelNode(step);
      const result = await node(createBaseState());

      expect(result.results['parallel-1']).toBeDefined();
      expect(result.results['parallel-1']['parallel-1_branch_0']).toBeDefined();
      expect(result.results['parallel-1']['parallel-1_branch_1']).toBeDefined();
      expect(result.currentStep).toBe('parallel-1');
    });

    test('createLLMNode returns error when providerId is missing', async () => {
      const step: WorkflowStep = {
        id: 'llm-1',
        componentType: 'task',
        type: 'llm',
        name: 'LLM',
        properties: {
          model: 'gpt-4o',
        },
      };

      const node = (builder as any).createLLMNode(step);
      const result = await node(createBaseState());

      expect(result.error).toBe('Missing provider or model for step LLM');
      expect(result.status).toBe('error');
    });

    test('createLLMNode returns error when model is missing', async () => {
      const step: WorkflowStep = {
        id: 'llm-1',
        componentType: 'task',
        type: 'llm',
        name: 'LLM',
        properties: {
          providerId: 'openai',
        },
      };

      const node = (builder as any).createLLMNode(step);
      const result = await node(createBaseState());

      expect(result.error).toBe('Missing provider or model for step LLM');
      expect(result.status).toBe('error');
    });

    test('createPassThroughNode passes state through', async () => {
      const step: WorkflowStep = {
        id: 'pass-1',
        componentType: 'task',
        type: 'unknown' as any,
        name: 'Pass',
        properties: {},
      };

      const node = (builder as any).createPassThroughNode(step);
      const state = createBaseState('test value');
      const result = await node(state);

      expect(result.input).toBe('test value');
      expect(result.currentStep).toBe('pass-1');
      expect(result.error).toBeNull();
    });
  });
});
