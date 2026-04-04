/**
 * LLMConnector Unit Tests
 * Tests for LLM API connectivity and message handling
 */

import { LLMConnector } from '@/stratix-agent/core/LLMConnector';
import { LLMConfig, ChatMessage, ToolDefinition, SkillDefinition } from '@/stratix-agent/types';

// Mock the retry policy engine
jest.mock('@/stratix-core/retry', () => ({
  retryPolicyEngine: {
    executeWithRetry: jest.fn().mockImplementation(async (request: () => Promise<any>) => request()),
  },
}));

describe('LLMConnector', () => {
  describe('constructor', () => {
    test('creates connector with config', () => {
      const config: LLMConfig = {
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      };
      const connector = new LLMConnector(config);
      expect(connector).toBeInstanceOf(LLMConnector);
    });
  });

  describe('isAnthropic', () => {
    test('returns true for anthropic provider', () => {
      const connector = new LLMConnector({ provider: 'anthropic', model: 'claude-3', apiKey: 'test' });
      expect((connector as any).isAnthropic()).toBe(true);
    });

    test('returns false for openai provider', () => {
      const connector = new LLMConnector({ provider: 'openai', model: 'gpt-4', apiKey: 'test' });
      expect((connector as any).isAnthropic()).toBe(false);
    });
  });

  describe('getDefaultBaseUrl', () => {
    test('returns openai default for openai provider', () => {
      const connector = new LLMConnector({ provider: 'openai', model: 'gpt-4', apiKey: 'test' });
      expect((connector as any).getDefaultBaseUrl()).toBe('https://api.openai.com/v1');
    });

    test('returns anthropic default for anthropic provider', () => {
      const connector = new LLMConnector({ provider: 'anthropic', model: 'claude-3', apiKey: 'test' });
      expect((connector as any).getDefaultBaseUrl()).toBe('https://api.anthropic.com');
    });

    test('returns ollama default for ollama provider', () => {
      const connector = new LLMConnector({ provider: 'ollama', model: 'llama2', apiKey: 'test' });
      expect((connector as any).getDefaultBaseUrl()).toBe('http://localhost:11434/v1');
    });

    test('returns deepseek default for deepseek provider', () => {
      const connector = new LLMConnector({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'test' });
      expect((connector as any).getDefaultBaseUrl()).toBe('https://api.deepseek.com/v1');
    });

    test('returns qwen default for qwen provider', () => {
      const connector = new LLMConnector({ provider: 'qwen', model: 'qwen-turbo', apiKey: 'test' });
      expect((connector as any).getDefaultBaseUrl()).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    });
  });

  describe('skillToTool', () => {
    test('converts SkillDefinition to ToolDefinition', () => {
      const skill: SkillDefinition = {
        skillId: 'file-read',
        name: 'File Read',
        description: 'Read a file from disk',
        parameters: [
          { name: 'path', type: 'string', required: true, description: 'File path' },
          { name: 'encoding', type: 'string', required: false, default: 'utf-8', description: 'File encoding' },
        ],
        executor: 'builtin',
      };

      const tool = LLMConnector.skillToTool(skill);

      expect(tool.name).toBe('file-read');
      expect(tool.description).toBe('Read a file from disk');
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties.path.type).toBe('string');
      expect(tool.input_schema.properties.encoding.type).toBe('string');
      expect(tool.input_schema.required).toEqual(['path']);
    });

    test('maps required parameters correctly', () => {
      const skill: SkillDefinition = {
        skillId: 'test',
        name: 'Test',
        description: 'Test skill',
        parameters: [
          { name: 'required1', type: 'string', required: true },
          { name: 'optional1', type: 'number', required: false },
          { name: 'required2', type: 'boolean', required: true },
        ],
        executor: 'builtin',
      };

      const tool = LLMConnector.skillToTool(skill);

      expect(tool.input_schema.required).toEqual(['required1', 'required2']);
      expect(tool.input_schema.required).not.toContain('optional1');
    });
  });

  describe('skillsToTools', () => {
    test('converts array of SkillDefinition to ToolDefinition[]', () => {
      const skills: SkillDefinition[] = [
        { skillId: 'skill1', name: 'Skill 1', description: 'First', parameters: [], executor: 'builtin' },
        { skillId: 'skill2', name: 'Skill 2', description: 'Second', parameters: [], executor: 'builtin' },
      ];

      const tools = LLMConnector.skillsToTools(skills);

      expect(tools.length).toBe(2);
      expect(tools[0].name).toBe('skill1');
      expect(tools[1].name).toBe('skill2');
    });
  });

  describe('generate (mocked)', () => {
    let mockOpenAI: any;
    let mockAnthropic: any;

    beforeEach(() => {
      jest.clearAllMocks();

      mockOpenAI = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                message: { content: 'OpenAI response' },
                finish_reason: 'stop',
              }],
              usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
            }),
          },
        },
      };

      mockAnthropic = {
        messages: {
          create: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Anthropic response' }],
            usage: { input_tokens: 10, output_tokens: 20 },
            stop_reason: 'end_turn',
          }),
        },
      };
    });

    test('generate returns content for OpenAI', async () => {
      const connector = new LLMConnector({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test',
      });

      (connector as any).openaiClient = mockOpenAI;

      const result = await connector.generate([{ role: 'user', content: 'Hello' }]);

      expect(result.content).toBe('OpenAI response');
      expect(result.finishReason).toBe('stop');
    });

    test('generate returns content for Anthropic', async () => {
      const connector = new LLMConnector({
        provider: 'anthropic',
        model: 'claude-3',
        apiKey: 'test',
      });

      (connector as any).anthropicClient = mockAnthropic;

      const result = await connector.generate([{ role: 'user', content: 'Hello' }]);

      expect(result.content).toBe('Anthropic response');
    });

    test('generate uses custom baseUrl when provided', async () => {
      const connector = new LLMConnector({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test',
        baseUrl: 'https://custom.api.com/v1',
      });

      (connector as any).openaiClient = mockOpenAI;

      await connector.generate([{ role: 'user', content: 'Hello' }]);
    });
  });

  describe('testConnection', () => {
    test('returns success when generate returns content', async () => {
      const connector = new LLMConnector({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test',
      });

      jest.spyOn(connector as any, 'generate').mockResolvedValue({ content: 'Test response' });

      const result = await connector.testConnection();

      expect(result.success).toBe(true);
      expect(result.latency).toBeDefined();
    });

    test('returns failure when no content returned', async () => {
      const connector = new LLMConnector({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test',
      });

      jest.spyOn(connector as any, 'generate').mockResolvedValue({ content: '' });

      const result = await connector.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('No response from model');
    });

    test('returns failure message on error', async () => {
      const connector = new LLMConnector({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test',
      });

      jest.spyOn(connector as any, 'generate').mockRejectedValue(new Error('API Error'));

      const result = await connector.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('API Error');
    });
  });

  describe('generateWithTools', () => {
    test('handles OpenAI tool format', async () => {
      const connector = new LLMConnector({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test',
      });

      const mockResponse = {
        choices: [{
          message: {
            content: 'Using tool',
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'file-read', arguments: '{"path": "/test.txt"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      };

      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue(mockResponse),
          },
        },
      };

      (connector as any).openaiClient = mockClient;

      const tools: ToolDefinition[] = [{
        name: 'file-read',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      }];

      const result = await connector.generateWithTools([{ role: 'user', content: 'Read the file' }], tools);

      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls![0].name).toBe('file-read');
      expect(result.tool_calls![0].input).toEqual({ path: '/test.txt' });
    });

    test('handles Anthropic tool format', async () => {
      const connector = new LLMConnector({
        provider: 'anthropic',
        model: 'claude-3',
        apiKey: 'test',
      });

      const mockResponse = {
        content: [
          { type: 'text', text: 'Reading file' },
          { type: 'tool_use', id: 'tool_1', name: 'file-read', input: { path: '/test.txt' } },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
        stop_reason: 'end_turn',
      };

      const mockClient = {
        messages: {
          create: jest.fn().mockResolvedValue(mockResponse),
        },
      };

      (connector as any).anthropicClient = mockClient;

      const tools: ToolDefinition[] = [{
        name: 'file-read',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      }];

      const result = await connector.generateWithTools([{ role: 'user', content: 'Read the file' }], tools);

      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls![0].name).toBe('file-read');
      expect(result.finishReason).toBe('tool_use');
    });

    test('handles malformed tool arguments gracefully', async () => {
      const connector = new LLMConnector({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test',
      });

      const mockResponse = {
        choices: [{
          message: {
            content: 'Using tool',
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'test', arguments: 'not valid json' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      };

      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue(mockResponse),
          },
        },
      };

      (connector as any).openaiClient = mockClient;

      const result = await connector.generateWithTools([{ role: 'user', content: 'Test' }], []);

      expect(result.tool_calls![0].input).toEqual({});
    });
  });

  describe('generateStream', () => {
    test('handles streaming for OpenAI', async () => {
      const connector = new LLMConnector({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test',
      });

      const chunks = ['Hello', ' world', '!'];
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) {
            yield { choices: [{ delta: { content: chunk } }] };
          }
        },
      };

      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue(mockStream),
          },
        },
      };

      (connector as any).openaiClient = mockClient;

      let fullContent = '';
      const result = await connector.generateStream(
        [{ role: 'user', content: 'Hi' }],
        (chunk) => { fullContent += chunk; }
      );

      expect(fullContent).toBe('Hello world!');
      expect(result.content).toBe('Hello world!');
    });
  });

  describe('message format conversion', () => {
    test('converts user message with tool_results for Anthropic', () => {
      const connector = new LLMConnector({
        provider: 'anthropic',
        model: 'claude-3',
        apiKey: 'test',
      });

      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: 'Use the tool',
          tool_results: [
            { type: 'tool_result', tool_use_id: 'tool_1', content: 'File content' },
          ],
        },
      ];

      const converted = (connector as any).convertToAnthropicFormat(messages);

      expect(converted[0].content).toHaveLength(1);
      expect(converted[0].content[0].type).toBe('tool_result');
      expect(converted[0].content[0].content).toBe('File content');
    });

    test('converts assistant message with tool_calls for Anthropic', () => {
      const connector = new LLMConnector({
        provider: 'anthropic',
        model: 'claude-3',
        apiKey: 'test',
      });

      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: 'Calling tool',
          tool_calls: [
            { type: 'tool_use', id: 'tool_1', name: 'read_file', input: { path: '/test' } },
          ],
        },
      ];

      const converted = (connector as any).convertToAnthropicFormat(messages);

      expect(converted[0].content[0].type).toBe('tool_use');
      expect(converted[0].content[0].name).toBe('read_file');
    });

    test('passes through regular messages unchanged', () => {
      const connector = new LLMConnector({
        provider: 'anthropic',
        model: 'claude-3',
        apiKey: 'test',
      });

      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      const converted = (connector as any).convertToAnthropicFormat(messages);

      expect(converted).toHaveLength(3);
      expect(converted[0].role).toBe('system');
      expect(converted[1].role).toBe('user');
      expect(converted[2].role).toBe('assistant');
    });
  });
});
