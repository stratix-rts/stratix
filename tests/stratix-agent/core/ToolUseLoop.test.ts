import { ToolUseLoop } from '@/stratix-agent/core/ToolUseLoop';
import { SkillRegistry } from '@/stratix-agent/core/SkillRegistry';
import { ChatMessage, ToolDefinition, ExecutionContext } from '@/stratix-agent/types';

describe('ToolUseLoop', () => {
  let mockSkillRegistry: jest.Mocked<SkillRegistry>;
  let mockLLMConnector: any;
  let context: ExecutionContext;

  beforeEach(() => {
    jest.useFakeTimers();
    mockSkillRegistry = {
      execute: jest.fn(),
    } as any;

    mockLLMConnector = {
      generateWithTools: jest.fn(),
    };

    context = { agentId: 'test-agent' };
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  const createMockTool = (name: string): ToolDefinition => ({
    name,
    description: `Test tool ${name}`,
    input_schema: {
      type: 'object',
      properties: {},
    },
  });

  test('executes tool call and returns result', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Use the calculator' }
    ];
    const tools = [createMockTool('calculator')];

    let callCount = 0;
    mockLLMConnector.generateWithTools.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: 'Let me calculate',
          tool_calls: [{
            type: 'tool_use' as const,
            id: 'call_1',
            name: 'calculator',
            input: { operation: 'add', a: 2, b: 3 }
          }],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        };
      }
      return {
        content: 'The result is 5',
        tool_calls: [],
        usage: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
      };
    });

    mockSkillRegistry.execute.mockResolvedValue({
      success: true,
      skillId: 'calculator',
      result: { result: 5 },
      executionTime: 10,
    });

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);
    const result = await loop.execute(messages, tools, context);

    expect(result.success).toBe(true);
    expect(result.finalContent).toBe('The result is 5');
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0].result).toEqual({ result: 5 });
  });

  test('returns when LLM produces no tool calls', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' }
    ];
    const tools = [createMockTool('calculator')];

    mockLLMConnector.generateWithTools.mockResolvedValue({
      content: 'Hello! How can I help you?',
      tool_calls: [],
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);
    const result = await loop.execute(messages, tools, context);

    expect(result.success).toBe(true);
    expect(result.finalContent).toBe('Hello! How can I help you?');
    expect(result.toolCalls.length).toBe(0);
  });

  test('handles tool execution error gracefully with continueOnError', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Use the calculator' }
    ];
    const tools = [createMockTool('calculator')];

    let callCount = 0;
    mockLLMConnector.generateWithTools.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: 'Let me try',
          tool_calls: [{
            type: 'tool_use' as const,
            id: 'call_1',
            name: 'calculator',
            input: { operation: 'divide', a: 1, b: 0 }
          }],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        };
      }
      return {
        content: 'Got an error but continuing',
        tool_calls: [],
        usage: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
      };
    });

    mockSkillRegistry.execute.mockRejectedValue(new Error('Division by zero'));

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, { continueOnError: true });
    const result = await loop.execute(messages, tools, context);

    expect(result.success).toBe(true);
  });

  test('respects maxIterations limit', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Keep calling tools' }
    ];
    const tools = [createMockTool('tool1')];

    mockLLMConnector.generateWithTools.mockResolvedValue({
      content: 'Calling tool',
      tool_calls: [{
        type: 'tool_use' as const,
        id: 'call_1',
        name: 'tool1',
        input: {}
      }],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    mockSkillRegistry.execute.mockResolvedValue({
      success: true,
      skillId: 'tool1',
      result: { result: 'ok' },
      executionTime: 10,
    });

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, { maxIterations: 3 });
    const result = await loop.execute(messages, tools, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Maximum iterations exceeded');
    expect(result.totalIterations).toBe(3);
  });

  test('aborts when abort() is called', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Do something' }
    ];
    const tools = [createMockTool('tool1')];

    let resolveFirstCall: (value: any) => void;
    const firstCallPromise = new Promise(resolve => {
      resolveFirstCall = resolve;
    });

    let callCount = 0;
    mockLLMConnector.generateWithTools.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return firstCallPromise!;
      }
      return { content: 'Done', tool_calls: [] };
    });

    mockSkillRegistry.execute.mockResolvedValue({
      success: true,
      skillId: 'tool1',
      result: { result: 'ok' },
      executionTime: 10,
    });

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, { maxTotalTime: 60000 });

    const executePromise = loop.execute(messages, tools, context);

    await jest.advanceTimersByTimeAsync(20);

    loop.abort();

    resolveFirstCall!({
      content: 'Calling tool',
      tool_calls: [{
        type: 'tool_use' as const,
        id: 'call_1',
        name: 'tool1',
        input: {}
      }],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const result = await executePromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Execution aborted');
  });

  test('circuit breaker triggers after consecutive errors', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Use tools' }
    ];
    const tools = [
      createMockTool('flaky_tool_1'),
      createMockTool('flaky_tool_2'),
      createMockTool('flaky_tool_3'),
    ];

    let callCount = 0;
    mockLLMConnector.generateWithTools.mockImplementation(async () => {
      callCount++;
      const toolIndex = (callCount - 1) % 3;
      return {
        content: 'Trying',
        tool_calls: [{
          type: 'tool_use' as const,
          id: `call_${callCount}`,
          name: `flaky_tool_${toolIndex + 1}`,
          input: {}
        }],
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
    });

    mockSkillRegistry.execute.mockRejectedValue(new Error('Tool error'));

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, {
      maxConsecutiveErrors: 3,
      continueOnError: true,
    });

    const result = await loop.execute(messages, tools, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Circuit breaker triggered');
  });

  test('skips duplicate tool calls in same iteration', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Use calculator' }
    ];
    const tools = [createMockTool('calculator')];

    let callCount = 0;
    mockLLMConnector.generateWithTools.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: 'Calculating',
          tool_calls: [
            { type: 'tool_use' as const, id: 'call_1', name: 'calculator', input: { op: 'add', a: 1, b: 2 } },
            { type: 'tool_use' as const, id: 'call_2', name: 'calculator', input: { op: 'add', a: 3, b: 4 } },
          ],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        };
      }
      return {
        content: 'Done calculating',
        tool_calls: [],
        usage: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
      };
    });

    mockSkillRegistry.execute.mockResolvedValue({
      success: true,
      skillId: 'calculator',
      result: { result: 3 },
      executionTime: 10,
    });

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);
    const result = await loop.execute(messages, tools, context);

    expect(mockSkillRegistry.execute).toHaveBeenCalledTimes(1);
  });

  test('handles LLM call failure', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Use tool' }
    ];
    const tools = [createMockTool('tool1')];

    mockLLMConnector.generateWithTools.mockRejectedValue(new Error('LLM API error'));

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);
    const result = await loop.execute(messages, tools, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('LLM call failed');
  });

  test('respects maxTotalTime timeout', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Slow operation' }
    ];
    const tools = [createMockTool('tool1')];

    mockLLMConnector.generateWithTools.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 50));
      return {
        content: 'Still running',
        tool_calls: [{
          type: 'tool_use' as const,
          id: 'call_1',
          name: 'tool1',
          input: {}
        }],
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
    });

    mockSkillRegistry.execute.mockResolvedValue({
      success: true,
      skillId: 'tool1',
      result: { result: 'ok' },
      executionTime: 10,
    });

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, { maxTotalTime: 30 });
    const executePromise = loop.execute(messages, tools, context);
    jest.runAllTimers();
    const result = await executePromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Maximum execution time exceeded');
  });

  test('respects maxTotalTokens budget', async () => {
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
        usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
      };
    });

    mockSkillRegistry.execute.mockResolvedValue({
      success: true,
      skillId: 'tool1',
      result: { result: 'ok' },
      executionTime: 10,
    });

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, { maxTotalTokens: 300 });
    const result = await loop.execute(messages, tools, context);

    // Should fail when token budget exceeded
    expect(result.success).toBe(false);
    expect(result.error).toContain('Token budget exceeded');
  });

  test('unknown tool returns error in result', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Use unknown tool' }
    ];
    const tools = [createMockTool('known_tool')];

    mockLLMConnector.generateWithTools.mockResolvedValue({
      content: 'Calling unknown',
      tool_calls: [{
        type: 'tool_use' as const,
        id: 'call_1',
        name: 'unknown_tool',
        input: {}
      }],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    // Skill registry doesn't have the tool, so it should error
    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector);
    const result = await loop.execute(messages, tools, context);

    expect(result.toolCalls[0].error).toContain('Unknown tool');
  });

  test('stops on error when continueOnError is false', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Use tool' }
    ];
    const tools = [createMockTool('tool1')];

    mockLLMConnector.generateWithTools.mockResolvedValue({
      content: 'Error occurred',
      tool_calls: [{
        type: 'tool_use' as const,
        id: 'call_1',
        name: 'tool1',
        input: {}
      }],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    mockSkillRegistry.execute.mockRejectedValue(new Error('Tool error'));

    const loop = new ToolUseLoop(mockSkillRegistry, mockLLMConnector, { continueOnError: false });
    const result = await loop.execute(messages, tools, context);

    // With continueOnError=false, it should stop after the error
    expect(result.toolCalls[0].error).toBeDefined();
  });
});
