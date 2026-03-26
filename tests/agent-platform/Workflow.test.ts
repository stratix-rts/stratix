/**
 * Workflow Types and Definitions Unit Tests
 */

import type {
  WorkflowStepType,
  WorkflowStatus,
  WorkflowStepProperties,
  WorkflowStep,
  WorkflowDefinition,
  WorkflowPreset,
  WorkflowExecutionResult,
  StepExecutionResult,
  WorkflowExecutionContext,
} from '@/agent-platform/workflow/types';

describe('Workflow Types', () => {
  describe('WorkflowStepType', () => {
    it('should have correct step types', () => {
      const types: WorkflowStepType[] = ['llm', 'tool', 'router', 'human', 'parallel', 'loop'];
      expect(types).toContain('llm');
      expect(types).toContain('tool');
      expect(types).toContain('router');
      expect(types).toContain('human');
      expect(types).toContain('parallel');
      expect(types).toContain('loop');
    });
  });

  describe('WorkflowStatus', () => {
    it('should have correct statuses', () => {
      const statuses: WorkflowStatus[] = ['idle', 'running', 'paused', 'completed', 'error'];
      expect(statuses).toContain('idle');
      expect(statuses).toContain('running');
      expect(statuses).toContain('paused');
      expect(statuses).toContain('completed');
      expect(statuses).toContain('error');
    });
  });

  describe('WorkflowStepProperties', () => {
    it('should accept valid properties', () => {
      const properties: WorkflowStepProperties = {
        providerId: 'openai',
        model: 'gpt-4',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Hello, how are you?',
        tools: ['search', 'calculator'],
        condition: 'input.contains("test")',
        maxIterations: 5,
        timeout: 30000,
        role: 'assistant',
        temperature: 0.7,
        maxTokens: 1000,
      };

      expect(properties.providerId).toBe('openai');
      expect(properties.model).toBe('gpt-4');
      expect(properties.tools).toContain('search');
      expect(properties.maxIterations).toBe(5);
    });

    it('should allow partial properties', () => {
      const properties: WorkflowStepProperties = {
        providerId: 'anthropic',
        model: 'claude-3',
      };

      expect(properties.providerId).toBe('anthropic');
      expect(properties.model).toBe('claude-3');
      expect(properties.tools).toBeUndefined();
    });
  });

  describe('WorkflowStep', () => {
    it('should create a valid workflow step', () => {
      const step: WorkflowStep = {
        id: 'step-1',
        componentType: 'task',
        type: 'llm',
        name: 'Generate Response',
        properties: {
          providerId: 'openai',
          model: 'gpt-4',
        },
      };

      expect(step.id).toBe('step-1');
      expect(step.componentType).toBe('task');
      expect(step.type).toBe('llm');
      expect(step.properties.providerId).toBe('openai');
    });

    it('should support parallel component type', () => {
      const step: WorkflowStep = {
        id: 'parallel-1',
        componentType: 'parallel',
        type: 'parallel',
        name: 'Parallel Tasks',
        properties: {},
        sequences: [],
      };

      expect(step.componentType).toBe('parallel');
      expect(step.sequences).toEqual([]);
    });
  });

  describe('WorkflowDefinition', () => {
    it('should create a valid workflow definition', () => {
      const definition: WorkflowDefinition = {
        properties: {
          name: 'Test Workflow',
          description: 'A test workflow',
          version: '1.0.0',
          author: 'Test Author',
          createdAt: Date.now(),
        },
        sequence: [
          {
            id: 'step-1',
            componentType: 'task',
            type: 'llm',
            name: 'Step 1',
            properties: { providerId: 'openai', model: 'gpt-4' },
          },
          {
            id: 'step-2',
            componentType: 'task',
            type: 'llm',
            name: 'Step 2',
            properties: { providerId: 'anthropic', model: 'claude-3' },
          },
        ],
      };

      expect(definition.properties.name).toBe('Test Workflow');
      expect(definition.sequence).toHaveLength(2);
      expect(definition.sequence[0].id).toBe('step-1');
    });
  });

  describe('WorkflowPreset', () => {
    it('should create a valid workflow preset', () => {
      const preset: WorkflowPreset = {
        id: 'preset-1',
        name: 'Single Agent',
        description: 'A single agent workflow',
        category: 'single-agent',
        icon: '🤖',
        definition: {
          properties: { name: 'Single Agent Workflow' },
          sequence: [],
        },
      };

      expect(preset.id).toBe('preset-1');
      expect(preset.category).toBe('single-agent');
      expect(preset.definition.properties.name).toBe('Single Agent Workflow');
    });

    it('should support all preset categories', () => {
      const categories: Array<WorkflowPreset['category']> = ['single-agent', 'multi-agent', 'automation', 'custom'];

      categories.forEach(category => {
        const preset: WorkflowPreset = {
          id: `preset-${category}`,
          name: `${category} Preset`,
          description: `A ${category} workflow`,
          category,
          definition: { properties: { name: category }, sequence: [] },
        };
        expect(preset.category).toBe(category);
      });
    });
  });

  describe('WorkflowExecutionResult', () => {
    it('should represent successful execution', () => {
      const result: WorkflowExecutionResult = {
        success: true,
        output: 'Final output',
        duration: 5000,
        steps: [
          {
            stepId: 'step-1',
            stepName: 'Step 1',
            status: 'completed',
            output: 'Step 1 output',
            duration: 2000,
            startedAt: Date.now() - 5000,
            completedAt: Date.now() - 3000,
          },
          {
            stepId: 'step-2',
            stepName: 'Step 2',
            status: 'completed',
            output: 'Step 2 output',
            duration: 3000,
            startedAt: Date.now() - 3000,
            completedAt: Date.now(),
          },
        ],
      };

      expect(result.success).toBe(true);
      expect(result.output).toBe('Final output');
      expect(result.steps).toHaveLength(2);
    });

    it('should represent failed execution', () => {
      const result: WorkflowExecutionResult = {
        success: false,
        error: 'Execution failed due to invalid input',
      };

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('StepExecutionResult', () => {
    it('should support all step statuses', () => {
      const statuses: StepExecutionResult['status'][] = ['pending', 'running', 'completed', 'error', 'skipped'];

      statuses.forEach(status => {
        const result: StepExecutionResult = {
          stepId: 'step-1',
          stepName: 'Test Step',
          status,
        };
        expect(result.status).toBe(status);
      });
    });
  });

  describe('WorkflowExecutionContext', () => {
    it('should create context with callbacks', () => {
      const onProgress = jest.fn();
      const onComplete = jest.fn();
      const onError = jest.fn();

      const context: WorkflowExecutionContext = {
        workflowId: 'workflow-1',
        input: 'Test input',
        onProgress,
        onComplete,
        onError,
      };

      expect(context.workflowId).toBe('workflow-1');
      expect(context.input).toBe('Test input');
      expect(context.onProgress).toBe(onProgress);
      expect(context.onComplete).toBe(onComplete);
      expect(context.onError).toBe(onError);
    });

    it('should allow context without callbacks', () => {
      const context: WorkflowExecutionContext = {
        workflowId: 'workflow-1',
        input: 'Test input',
      };

      expect(context.workflowId).toBe('workflow-1');
      expect(context.onProgress).toBeUndefined();
      expect(context.onComplete).toBeUndefined();
    });
  });
});
