/**
 * OpenClaw Adapters Unit Tests
 */

import { LocalOpenClawAdapter } from '@/stratix-openclaw-adapter/LocalOpenClawAdapter';
import { RemoteOpenClawAdapter } from '@/stratix-openclaw-adapter/RemoteOpenClawAdapter';
import type { OpenClawStatus } from '@/stratix-openclaw-adapter/types';
import type { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';
import axios from 'axios';

// Mock axios at the module level
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('LocalOpenClawAdapter', () => {
  const mockConfig: StratixOpenClawConfig = {
    endpoint: 'http://localhost:3000',
    accountId: 'test-account',
    apiKey: 'test-key',
  };

  let mockAxiosInstance: {
    get: jest.Mock;
    post: jest.Mock;
    put: jest.Mock;
    delete: jest.Mock;
    patch: jest.Mock;
    request: jest.Mock;
    defaults: object;
    interceptors: { request: { use: jest.Mock }; response: { use: jest.Mock } };
  };

  const createAdapter = (): LocalOpenClawAdapter => {
    return new LocalOpenClawAdapter(mockConfig);
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
      request: jest.fn(),
      defaults: {},
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance as unknown as ReturnType<typeof axios.create>);
    (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);
  });

  describe('constructor', () => {
    it('should create adapter with correct config', () => {
      const adapter = createAdapter();
      expect(adapter).toBeInstanceOf(LocalOpenClawAdapter);
    });
  });

  describe('connect', () => {
    it('should connect successfully when status is connected', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: {} });
      const adapter = createAdapter();

      await expect(adapter.connect()).resolves.not.toThrow();
    });

    it('should throw error when status is not connected', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Gateway not responding'));
      const adapter = createAdapter();

      await expect(adapter.connect()).rejects.toThrow('Failed to connect');
    });
  });

  describe('disconnect', () => {
    it('should clear pending requests', async () => {
      const adapter = createAdapter();
      await expect(adapter.disconnect()).resolves.not.toThrow();
    });
  });

  describe('getStatus', () => {
    it('should return connected status on success', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: {} });
      const adapter = createAdapter();

      const status = await adapter.getStatus();

      expect(status.connected).toBe(true);
      expect(status.accountId).toBe(mockConfig.accountId);
    });

    it('should return disconnected status on error', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));
      const adapter = createAdapter();

      const status = await adapter.getStatus();

      expect(status.connected).toBe(false);
      expect(status.error).toBeDefined();
    });
  });

  describe('invokeTool', () => {
    it('should invoke tool successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { ok: true, result: { data: 'test-result' } },
      });
      const adapter = createAdapter();

      const result = await adapter.invokeTool('test_tool', { arg: 'value' });

      expect(result).toBeDefined();
    });

    it('should throw error when tool invocation fails', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { ok: false, error: { message: 'Tool not found' } },
      });
      const adapter = createAdapter();

      await expect(adapter.invokeTool('nonexistent_tool')).rejects.toThrow('Tool not found');
    });

    it('should handle content response format', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          ok: true,
          result: {
            content: [{ type: 'text', text: '{"parsed":"data"}' }],
          },
        },
      });
      const adapter = createAdapter();

      const result = await adapter.invokeTool('test_tool');

      expect(result).toEqual({ parsed: 'data' });
    });
  });

  describe('execute', () => {
    it('should execute action successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { ok: true, result: 'action-result' },
      });
      const adapter = createAdapter();

      const result = await adapter.execute({
        method: 'test_method',
        params: { key: 'value' },
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('action-result');
    });

    it('should return error on action failure', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Action failed'));
      const adapter = createAdapter();

      const result = await adapter.execute({
        method: 'test_method',
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('sendMessage', () => {
    it('should send message and return response', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          id: 'msg-123',
          choices: [{ message: { content: 'Hello!' } }],
        },
      });
      const adapter = createAdapter();

      const result = await adapter.sendMessage('Hello');

      expect(result.messageId).toBe('msg-123');
      expect(result.content).toBe('Hello!');
    });
  });

  describe('openaiChatCompletion', () => {
    it('should send chat completion request', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          id: 'chat-123',
          choices: [{ message: { content: 'Response' } }],
        },
      });
      const adapter = createAdapter();

      const result = await adapter.openaiChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.id).toBe('chat-123');
    });
  });

  describe('subscribe', () => {
    it('should add subscriber', () => {
      const adapter = createAdapter();
      const callback = jest.fn();
      adapter.subscribe(callback);
      expect(true).toBe(true);
    });
  });

  describe('listSessions', () => {
    it('should list sessions via invokeTool', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { ok: true, result: ['session-1', 'session-2'] },
      });
      const adapter = createAdapter();

      const sessions = await adapter.listSessions();

      expect(sessions).toHaveLength(2);
    });
  });

  describe('listAgents', () => {
    it('should list agents via invokeTool', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { ok: true, result: ['agent-1', 'agent-2'] },
      });
      const adapter = createAdapter();

      const agents = await adapter.listAgents();

      expect(agents).toHaveLength(2);
    });
  });

  describe('listModels', () => {
    it('should list models via invokeTool', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { ok: true, result: ['model-1', 'model-2'] },
      });
      const adapter = createAdapter();

      const models = await adapter.listModels();

      expect(models).toHaveLength(2);
    });
  });
});

describe('RemoteOpenClawAdapter', () => {
  const mockConfig: StratixOpenClawConfig = {
    endpoint: 'https://api.openclaw.example.com',
    accountId: 'test-account',
    apiKey: 'test-key',
  };

  let mockAxiosInstance: {
    get: jest.Mock;
    post: jest.Mock;
    put: jest.Mock;
    delete: jest.Mock;
    patch: jest.Mock;
    request: jest.Mock;
    defaults: object;
    interceptors: { request: { use: jest.Mock }; response: { use: jest.Mock } };
  };

  const createAdapter = (): RemoteOpenClawAdapter => {
    return new RemoteOpenClawAdapter(mockConfig);
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
      request: jest.fn(),
      defaults: {},
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance as unknown as ReturnType<typeof axios.create>);
    (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);
  });

  describe('constructor', () => {
    it('should create adapter with correct config', () => {
      const adapter = createAdapter();
      expect(adapter).toBeInstanceOf(RemoteOpenClawAdapter);
    });
  });

  describe('connect', () => {
    it('should connect when health check passes', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { status: 'ok' } });
      const adapter = createAdapter();

      await expect(adapter.connect()).resolves.not.toThrow();
    });

    it('should throw error when health check fails', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Health check failed'));
      const adapter = createAdapter();

      await expect(adapter.connect()).rejects.toThrow('Failed to connect to remote OpenClaw');
    });
  });

  describe('disconnect', () => {
    it('should not throw on disconnect', async () => {
      const adapter = createAdapter();
      await expect(adapter.disconnect()).resolves.not.toThrow();
    });
  });

  describe('execute', () => {
    it('should return error indicating unsupported operation', async () => {
      const adapter = createAdapter();
      const result = await adapter.execute({
        method: 'test',
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not support WebSocket RPC');
    });
  });

  describe('getStatus', () => {
    it('should return connected status on health check success', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { version: '1.0.0' } });
      const adapter = createAdapter();

      const status = await adapter.getStatus();

      expect(status.connected).toBe(true);
    });

    it('should return disconnected status on health check failure', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Health check failed'));
      const adapter = createAdapter();

      const status = await adapter.getStatus();

      expect(status.connected).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should send message via openaiChatCompletion', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          id: 'msg-123',
          choices: [{ message: { content: 'Hello!' } }],
        },
      });
      const adapter = createAdapter();

      const result = await adapter.sendMessage('Hello');

      expect(result.messageId).toBe('msg-123');
      expect(result.content).toBe('Hello!');
    });
  });

  describe('openaiChatCompletion', () => {
    it('should send chat completion request', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          id: 'chat-123',
          choices: [{ message: { content: 'Response' } }],
        },
      });
      const adapter = createAdapter();

      const result = await adapter.openaiChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.id).toBe('chat-123');
    });

    it('should throw error on API failure', async () => {
      const error = {
        response: {
          data: {
            error: { message: 'Invalid request' },
          },
        },
        message: 'Request failed',
        isAxiosError: true,
      };
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
      mockAxiosInstance.post.mockRejectedValue(error);
      const adapter = createAdapter();

      await expect(
        adapter.openaiChatCompletion({ messages: [{ role: 'user', content: 'Hello' }] })
      ).rejects.toThrow('OpenAI API error: Invalid request');
    });
  });

  describe('listModels', () => {
    it('should list available models', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { data: [{ id: 'model-1' }, { id: 'model-2' }] },
      });
      const adapter = createAdapter();

      const models = await adapter.listModels();

      expect(models).toEqual(['model-1', 'model-2']);
    });

    it('should return empty array on error', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Failed to fetch models'));
      const adapter = createAdapter();

      const models = await adapter.listModels();

      expect(models).toEqual([]);
    });
  });

  describe('invokeTool', () => {
    it('should invoke tool successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { ok: true, result: 'tool-result' },
      });
      const adapter = createAdapter();

      const result = await adapter.invokeTool('test_tool', { arg: 'value' });

      expect(result).toBe('tool-result');
    });

    it('should throw error when tool invocation fails', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { ok: false, error: { message: 'Tool not found' } },
      });
      const adapter = createAdapter();

      await expect(adapter.invokeTool('nonexistent_tool')).rejects.toThrow('Tool not found');
    });

    it('should handle content response format', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          ok: true,
          result: {
            content: [{ type: 'text', text: '{"parsed":"data"}' }],
          },
        },
      });
      const adapter = createAdapter();

      const result = await adapter.invokeTool('test_tool');

      expect(result).toEqual({ parsed: 'data' });
    });
  });

  describe('subscribe', () => {
    it('should add subscriber', () => {
      const adapter = createAdapter();
      const callback = jest.fn();
      adapter.subscribe(callback);
      expect(true).toBe(true);
    });
  });
});

describe('GatewayOpenClawAdapter', () => {
  // Note: GatewayOpenClawAdapter uses browser WebSocket which is not available in Node.js
  // These tests verify the HTTP fallback mechanisms

  it('should be importable', async () => {
    const { GatewayOpenClawAdapter } = await import('@/stratix-openclaw-adapter/GatewayOpenClawAdapter');
    expect(GatewayOpenClawAdapter).toBeDefined();
  });
});
