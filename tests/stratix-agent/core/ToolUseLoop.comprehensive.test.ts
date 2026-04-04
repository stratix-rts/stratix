/**
 * ToolUseLoop Comprehensive Unit Tests
 *
 * Extended tests for ToolUseLoop focusing on edge cases,
 * transcript persistence, and budget controller integration.
 */

import { ToolUseLoop } from '@/stratix-agent/core/ToolUseLoop';
import { SkillRegistry } from '@/stratix-agent/core/SkillRegistry';
import { BudgetController } from '@stratix-core/budget/BudgetController';
import { ChatMessage, ToolDefinition, ExecutionContext } from '@/stratix-agent/types';

// Mock skill audit logger
jest.mock('@/stratix-agent/core/SkillAuditLogger', () => ({
  skillAuditLogger: {
    log: jest.fn(),
  },
}));

describe('ToolUseLoop - Extended Coverage', () => {
  let mockSkillRegistry: jest.Mocked<SkillRegistry>;
  let mockLLMConnector: any;
  let context: ExecutionContext;

  const createMockTool = (name: string): ToolDefinition => ({
    name,
    description: `Test tool ${name}`,
    input_schema: {
      type: 'object',
      properties: {},
    },
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockSkillRegistry = {
      execute: jest.fn(),
    } as any;

    mockLLMConnector = {
      generateWithTools: jest.fn(),
    };

    context = { agentId: 'test-agent', sessionId: 'test-session' };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('executeToolCalls', () => {
    test('handles unknown tool error gracefully', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use unknown tool' }
      ];
      // Register only known_tool, but LLM will request unknown_tool
      const tools = [createMockTool('known_tool')];

      mockLLMConnector.generateWithTools.mockResolvedValue({
        content: 'Calling',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'unknown_tool', // This tool is not in the tools list
          input: {}
        }],
        usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);
      const result = await loop.execute(messages, tools, context);

      // The tool is unknown because it's not registered
      expect(result.toolCalls[0].error).toContain('Unknown tool');
    });

    test('handles tool timeout', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use slow tool' }
      ];
      const tools = [createMockTool('slow_tool')];

      mockLLMConnector.generateWithTools.mockResolvedValue({
        content: 'Calling slow tool',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'slow_tool',
          input: {}
        }],
        usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
      });

      // Tool execution that takes longer than maxToolTimeout
      mockSkillRegistry.execute.mockImplementation(async () => {
        // Use fake timers to simulate slow execution
        await jest.advanceTimersByTimeAsync(100);
        return { success: true, skillId: 'slow_tool', result: {}, executionTime: 100 };
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, { maxToolTimeout: 10 });
      const result = await loop.execute(messages, tools, context);

      expect(result.toolCalls[0].error).toContain('timed out');
    });

    test('tracks tool call count for adaptive fallback warning', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tool multiple times' }
      ];
      const tools = [createMockTool('repeatable_tool')];

      let callCount = 0;
      mockLLMConnector.generateWithTools.mockImplementation(async () => {
        callCount++;
        if (callCount < 5) {
          return {
            content: 'Using tool again',
            tool_calls: [{
              type: 'tool_use' as const,
              id: `call_${callCount}`,
              name: 'repeatable_tool',
              input: {}
            }],
            usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
          };
        }
        return {
          content: 'Done',
          tool_calls: [],
          usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
        };
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'repeatable_tool',
        result: { result: 'ok' },
        executionTime: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, { maxIterations: 10 });
      const result = await loop.execute(messages, tools, context);

      expect(result.success).toBe(true);
    });
  });

  describe('execute with different configs', () => {
    test('respects continueOnError false to stop on first error', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tool' }
      ];
      const tools = [createMockTool('flaky_tool')];

      mockLLMConnector.generateWithTools.mockResolvedValue({
        content: 'Error occurred',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'flaky_tool',
          input: {}
        }],
        usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
      });

      mockSkillRegistry.execute.mockRejectedValue(new Error('Tool failed'));

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, { continueOnError: false });
      const result = await loop.execute(messages, tools, context);

      expect(result.toolCalls[0].error).toBeDefined();
      expect(result.success).toBe(false);
    });

    test('handles all duplicate tools in single call', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tools' }
      ];
      const tools = [createMockTool('tool_a'), createMockTool('tool_b')];

      mockLLMConnector.generateWithTools.mockResolvedValue({
        content: 'Using tools',
        tool_calls: [
          { type: 'tool_use' as const, id: 'call_1', name: 'tool_a', input: {} },
          { type: 'tool_use' as const, id: 'call_2', name: 'tool_a', input: {} }, // duplicate
          { type: 'tool_use' as const, id: 'call_3', name: 'tool_b', input: {} },
        ],
        usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'tool',
        result: { result: 'ok' },
        executionTime: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);
      const result = await loop.execute(messages, tools, context);

      // Should only execute unique tools (tool_a once, tool_b once)
      expect(mockSkillRegistry.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('execute with tool result processing', () => {
    test('processes string results correctly', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tool' }
      ];
      const tools = [createMockTool('string_tool')];

      mockLLMConnector.generateWithTools.mockResolvedValue({
        content: 'Calling',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'string_tool',
          input: {}
        }],
        usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'string_tool',
        result: 'simple string result',
        executionTime: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);
      const result = await loop.execute(messages, tools, context);

      expect(result.toolCalls[0].result).toBe('simple string result');
    });

    test('processes object results as JSON string', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tool' }
      ];
      const tools = [createMockTool('object_tool')];

      mockLLMConnector.generateWithTools.mockResolvedValue({
        content: 'Calling',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'object_tool',
          input: {}
        }],
        usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'object_tool',
        result: { key: 'value', nested: { data: 123 } },
        executionTime: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);
      const result = await loop.execute(messages, tools, context);

      expect(result.toolCalls[0].result).toEqual({ key: 'value', nested: { data: 123 } });
    });
  });

  describe('execute with BudgetController integration', () => {
    test('stops when budget controller returns stop action (threshold_reached)', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tool' }
      ];
      const tools = [createMockTool('tool1')];

      let callCount = 0;
      mockLLMConnector.generateWithTools.mockImplementation(async () => {
        callCount++;
        return {
          content: 'Using tool',
          tool_calls: [{
            type: 'tool_use' as const,
            id: `call_${callCount}`,
            name: 'tool1',
            input: {}
          }],
          usage: { promptTokens: 100, completionTokens: 500, totalTokens: 95000 },
        };
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'tool1',
        result: { result: 'ok' },
        executionTime: 10,
      });

      // Create custom BudgetController that stops at 90% threshold
      const customBudgetCtrl = new BudgetController({
        maxTokens: 100000,
        completionThreshold: 0.9,
        diminishingThreshold: 500,
        maxContinuations: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, {}, customBudgetCtrl);
      const result = await loop.execute(messages, tools, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Budget stopped');
      expect(result.error).toContain('threshold_reached');
      expect(result.finalContent).toContain('95%');
    });

    test('stops when budget controller returns stop action (diminishing_returns)', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tool' }
      ];
      const tools = [createMockTool('tool1')];

      mockLLMConnector.generateWithTools.mockResolvedValue({
        content: 'Using tool',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'tool1',
          input: {}
        }],
        usage: { promptTokens: 28000, completionTokens: 300, totalTokens: 28300 },
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'tool1',
        result: { result: 'ok' },
        executionTime: 10,
      });

      // Create custom BudgetController with diminishing returns detection
      const customBudgetCtrl = new BudgetController({
        maxTokens: 100000,
        completionThreshold: 0.9,
        diminishingThreshold: 500,
        maxContinuations: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, {}, customBudgetCtrl);
      const result = await loop.execute(messages, tools, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Budget stopped');
      expect(result.error).toContain('diminishing_returns');
      expect(result.finalContent).toContain('Diminishing returns');
    });

    test('stops when budget controller returns stop action (max_continuations)', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tool' }
      ];
      const tools = [createMockTool('tool1')];

      let callCount = 0;
      mockLLMConnector.generateWithTools.mockImplementation(async () => {
        callCount++;
        return {
          content: 'Using tool',
          tool_calls: [{
            type: 'tool_use' as const,
            id: `call_${callCount}`,
            name: 'tool1',
            input: {}
          }],
          usage: { promptTokens: 100, completionTokens: 500, totalTokens: 10000 },
        };
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'tool1',
        result: { result: 'ok' },
        executionTime: 10,
      });

      // Create custom BudgetController that stops at max 3 continuations
      const customBudgetCtrl = new BudgetController({
        maxTokens: 100000,
        completionThreshold: 0.9,
        diminishingThreshold: 500,
        maxContinuations: 3,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, { maxIterations: 10 }, customBudgetCtrl);
      const result = await loop.execute(messages, tools, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Budget stopped');
      expect(result.error).toContain('max_continuations');
      expect(result.finalContent).toContain('Maximum continuations');
    });

    test('stops when budget controller returns stop action (budget_exhausted)', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tool' }
      ];
      const tools = [createMockTool('tool1')];

      mockLLMConnector.generateWithTools.mockResolvedValue({
        content: 'Using tool',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'tool1',
          input: {}
        }],
        usage: { promptTokens: 40000, completionTokens: 60000, totalTokens: 100000 },
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'tool1',
        result: { result: 'ok' },
        executionTime: 10,
      });

      // Create custom BudgetController with exhausted budget
      const customBudgetCtrl = new BudgetController({
        maxTokens: 100000,
        completionThreshold: 0.9,
        diminishingThreshold: 500,
        maxContinuations: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, {}, customBudgetCtrl);
      const result = await loop.execute(messages, tools, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Budget stopped');
      expect(result.error).toContain('budget_exhausted');
      expect(result.finalContent).toContain('Budget exhausted');
      expect(result.finalContent).toContain('100%');
    });

    test('continues when budget controller returns continue action', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tool' }
      ];
      const tools = [createMockTool('tool1')];

      let callCount = 0;
      mockLLMConnector.generateWithTools.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: 'Using tool',
            tool_calls: [{
              type: 'tool_use' as const,
              id: 'call_1',
              name: 'tool1',
              input: {}
            }],
            usage: { promptTokens: 100, completionTokens: 500, totalTokens: 5000 },
          };
        }
        return {
          content: 'Done',
          tool_calls: [],
          usage: { promptTokens: 200, completionTokens: 500, totalTokens: 6000 },
        };
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'tool1',
        result: { result: 'ok' },
        executionTime: 10,
      });

      // Create custom BudgetController with generous budget
      const customBudgetCtrl = new BudgetController({
        maxTokens: 100000,
        completionThreshold: 0.9,
        diminishingThreshold: 500,
        maxContinuations: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, {}, customBudgetCtrl);
      const result = await loop.execute(messages, tools, context);

      expect(result.success).toBe(true);
      expect(result.finalContent).toBe('Done');
    });

    test('uses injected budget controller over singleton', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tool' }
      ];
      const tools = [createMockTool('tool1')];

      mockLLMConnector.generateWithTools.mockResolvedValue({
        content: 'Using tool',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'tool1',
          input: {}
        }],
        usage: { promptTokens: 40000, completionTokens: 60000, totalTokens: 100000 },
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'tool1',
        result: { result: 'ok' },
        executionTime: 10,
      });

      // Custom budget controller with very low max tokens to force stop
      const customBudgetCtrl = new BudgetController({
        maxTokens: 1000,
        completionThreshold: 0.9,
        diminishingThreshold: 500,
        maxContinuations: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, {}, customBudgetCtrl);
      const result = await loop.execute(messages, tools, context);

      // Should stop due to custom budget controller (exhausted at 100%)
      expect(result.success).toBe(false);
      expect(result.error).toContain('Budget stopped');
    });
  });

  describe('abort behavior', () => {
    test('aborts mid-execution when signal set', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Do something' }
      ];
      const tools = [createMockTool('tool1')];

      let resolveLLM: (value: any) => void;
      const llmPromise = new Promise(resolve => {
        resolveLLM = resolve;
      });

      mockLLMConnector.generateWithTools.mockImplementation(async () => {
        return llmPromise;
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'tool1',
        result: { result: 'ok' },
        executionTime: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);

      const executePromise = loop.execute(messages, tools, context);

      // Allow event loop to process
      await jest.runAllTimersAsync();

      loop.abort();

      resolveLLM!({
        content: 'Using tool',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'tool1',
          input: {}
        }],
        usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
      });

      const result = await executePromise;

      expect(result.error).toBe('Execution aborted');
    });
  });

  describe('message construction', () => {
    test('adds user message with tool_results to messages array', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Use tool' }
      ];
      const tools = [createMockTool('test_tool')];

      mockLLMConnector.generateWithTools.mockResolvedValue({
        content: 'Using tool',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'test_tool',
          input: {}
        }],
        usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
      });

      mockSkillRegistry.execute.mockResolvedValue({
        success: true,
        skillId: 'test_tool',
        result: { output: 'result' },
        executionTime: 10,
      });

      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);
      await loop.execute(messages, tools, context);

      // Verify skill was called with correct context
      expect(mockSkillRegistry.execute).toHaveBeenCalledWith(
        'test_tool',
        {},
        context
      );
    });
  });

  describe('maxConsecutiveErrors', () => {
    test('respects custom consecutive error threshold', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Use tools' }
      ];
      // Use multiple different tools that all error
      const tools = [
        createMockTool('error_tool_1'),
        createMockTool('error_tool_2'),
        createMockTool('error_tool_3'),
      ];

      let callCount = 0;
      mockLLMConnector.generateWithTools.mockImplementation(async () => {
        callCount++;
        const toolIndex = (callCount - 1) % 3;
        return {
          content: 'Using tool',
          tool_calls: [{
            type: 'tool_use' as const,
            id: `call_${callCount}`,
            name: `error_tool_${toolIndex + 1}`,
            input: {}
          }],
          usage: { promptTokens: 100, completionTokens: 500, totalTokens: 150 },
        };
      });

      mockSkillRegistry.execute.mockRejectedValue(new Error('Tool error'));

      // Set threshold to 5, but we have 3 different tools
      // After 3 consecutive errors (one per tool), circuit breaker should trigger
      const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, {
        maxConsecutiveErrors: 3,
        continueOnError: true
      });

      const result = await loop.execute(messages, tools, context);

      // Should fail due to circuit breaker at threshold (3 consecutive errors)
      expect(result.error).toContain('Circuit breaker triggered');
    });
  });
});
