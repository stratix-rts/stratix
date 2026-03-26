/**
 * ProviderRegistry Unit Tests
 */

import { ProviderRegistry, providerRegistry } from '@/agent-platform/providers/registry';
import type { ProviderConfig, CreateProviderOptions } from '@/agent-platform/providers/types';

// Mock the adapters
jest.mock('@/agent-platform/providers/adapters', () => ({
  OpenAIAdapter: jest.fn().mockImplementation(() => ({
    getConfig: () => ({
      id: 'openai',
      name: 'OpenAI',
      icon: '🤖',
      requiresApiKey: true,
      defaultEndpoint: 'https://api.openai.com/v1',
      models: ['gpt-4', 'gpt-3.5-turbo'],
      langchainClass: 'ChatOpenAI',
      langchainModule: '@langchain/openai',
      envKey: 'OPENAI_API_KEY',
    }),
    getModels: () => ['gpt-4', 'gpt-3.5-turbo'],
    validateOptions: () => ({ valid: true }),
    createModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: 'test response' })
    }),
  })),
  AnthropicAdapter: jest.fn().mockImplementation(() => ({
    getConfig: () => ({
      id: 'anthropic',
      name: 'Anthropic',
      icon: '🧠',
      requiresApiKey: true,
      defaultEndpoint: 'https://api.anthropic.com',
      models: ['claude-3-opus', 'claude-3-sonnet'],
      langchainClass: 'ChatAnthropic',
      langchainModule: '@langchain/anthropic',
      envKey: 'ANTHROPIC_API_KEY',
    }),
    getModels: () => ['claude-3-opus', 'claude-3-sonnet'],
    validateOptions: () => ({ valid: true }),
    createModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: 'test response' })
    }),
  })),
  GoogleAdapter: jest.fn().mockImplementation(() => ({
    getConfig: () => ({
      id: 'google',
      name: 'Google',
      icon: '🔍',
      requiresApiKey: true,
      defaultEndpoint: 'https://generativelanguage.googleapis.com',
      models: ['gemini-pro'],
      langchainClass: 'ChatGoogleGenerativeAI',
      langchainModule: '@langchain/google-genai',
      envKey: 'GOOGLE_API_KEY',
    }),
    getModels: () => ['gemini-pro'],
    validateOptions: () => ({ valid: true }),
    createModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: 'test response' })
    }),
  })),
  DeepSeekAdapter: jest.fn().mockImplementation(() => ({
    getConfig: () => ({
      id: 'deepseek',
      name: 'DeepSeek',
      icon: '🔭',
      requiresApiKey: true,
      defaultEndpoint: 'https://api.deepseek.com',
      models: ['deepseek-chat'],
      langchainClass: 'ChatDeepSeek',
      langchainModule: '@langchain/deepseek',
      envKey: 'DEEPSEEK_API_KEY',
    }),
    getModels: () => ['deepseek-chat'],
    validateOptions: () => ({ valid: true }),
    createModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: 'test response' })
    }),
  })),
  QwenAdapter: jest.fn().mockImplementation(() => ({
    getConfig: () => ({
      id: 'qwen',
      name: 'Qwen',
      icon: '🌊',
      requiresApiKey: true,
      defaultEndpoint: 'https://dashscope.aliyuncs.com',
      models: ['qwen-turbo'],
      langchainClass: 'ChatTongyi',
      langchainModule: '@langchain/community',
      envKey: 'DASHSCOPE_API_KEY',
    }),
    getModels: () => ['qwen-turbo'],
    validateOptions: () => ({ valid: true }),
    createModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: 'test response' })
    }),
  })),
  MoonshotAdapter: jest.fn().mockImplementation(() => ({
    getConfig: () => ({
      id: 'moonshot',
      name: 'Moonshot',
      icon: '🌙',
      requiresApiKey: true,
      defaultEndpoint: 'https://api.moonshot.cn',
      models: ['moonshot-v1-8k'],
      langchainClass: 'ChatMoonshot',
      langchainModule: '@langchain/community',
      envKey: 'MOONSHOT_API_KEY',
    }),
    getModels: () => ['moonshot-v1-8k'],
    validateOptions: () => ({ valid: true }),
    createModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: 'test response' })
    }),
  })),
  StepFunAdapter: jest.fn().mockImplementation(() => ({
    getConfig: () => ({
      id: 'stepfun',
      name: 'StepFun',
      icon: '🪜',
      requiresApiKey: true,
      defaultEndpoint: 'https://api.stepfun.com',
      models: ['step-1v8k'],
      langchainClass: 'ChatStepFun',
      langchainModule: '@langchain/community',
      envKey: 'STEPFUN_API_KEY',
    }),
    getModels: () => ['step-1v8k'],
    validateOptions: () => ({ valid: true }),
    createModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: 'test response' })
    }),
  })),
  OllamaAdapter: jest.fn().mockImplementation(() => ({
    getConfig: () => ({
      id: 'ollama',
      name: 'Ollama',
      icon: '🦙',
      requiresApiKey: false,
      defaultEndpoint: 'http://localhost:11434',
      models: ['llama2', 'mistral'],
      langchainClass: 'ChatOllama',
      langchainModule: '@langchain/community',
      envKey: null,
    }),
    getModels: () => ['llama2', 'mistral'],
    validateOptions: () => ({ valid: true }),
    createModel: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: 'test response' })
    }),
  })),
}));

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should register default providers', () => {
      const openaiConfig = registry.getConfig('openai');
      expect(openaiConfig).toBeDefined();
      expect(openaiConfig?.id).toBe('openai');

      const anthropicConfig = registry.getConfig('anthropic');
      expect(anthropicConfig).toBeDefined();
      expect(anthropicConfig?.id).toBe('anthropic');
    });

    it('should register all 8 default providers', () => {
      const configs = registry.getAllConfigs();
      expect(configs.length).toBe(8);
    });
  });

  describe('register', () => {
    it('should register a new provider adapter', () => {
      const mockAdapter = {
        getConfig: () => ({
          id: 'custom',
          name: 'Custom Provider',
          icon: '🔧',
          requiresApiKey: true,
          defaultEndpoint: 'https://custom.api',
          models: ['custom-model'],
          langchainClass: 'ChatCustom',
          langchainModule: 'custom',
          envKey: 'CUSTOM_API_KEY',
        }),
        getModels: () => ['custom-model'],
        validateOptions: () => ({ valid: true }),
        createModel: jest.fn(),
      };

      registry.register('custom', mockAdapter as any);
      const config = registry.getConfig('custom');
      expect(config).toBeDefined();
      expect(config?.id).toBe('custom');
    });
  });

  describe('getAdapter', () => {
    it('should return adapter for known provider', () => {
      const adapter = registry.getAdapter('openai');
      expect(adapter).toBeDefined();
    });

    it('should return undefined for unknown provider', () => {
      const adapter = registry.getAdapter('unknown-provider');
      expect(adapter).toBeUndefined();
    });
  });

  describe('getConfig', () => {
    it('should return config for known provider', () => {
      const config = registry.getConfig('openai');
      expect(config).toBeDefined();
      expect(config?.id).toBe('openai');
      expect(config?.name).toBe('OpenAI');
    });

    it('should return undefined for unknown provider', () => {
      const config = registry.getConfig('unknown');
      expect(config).toBeUndefined();
    });
  });

  describe('getAllConfigs', () => {
    it('should return all registered configs', () => {
      const configs = registry.getAllConfigs();
      expect(configs).toHaveLength(8);
      expect(configs.map(c => c.id)).toContain('openai');
      expect(configs.map(c => c.id)).toContain('anthropic');
    });
  });

  describe('getModels', () => {
    it('should return models for known provider', () => {
      const models = registry.getModels('openai');
      expect(models).toContain('gpt-4');
      expect(models).toContain('gpt-3.5-turbo');
    });

    it('should return empty array for unknown provider', () => {
      const models = registry.getModels('unknown');
      expect(models).toEqual([]);
    });
  });

  describe('createModel', () => {
    it('should create model with valid options', () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      };

      const model = registry.createModel(options);
      expect(model).toBeDefined();
    });

    it('should throw error for unknown provider', () => {
      const options: CreateProviderOptions = {
        providerId: 'unknown-provider',
        model: 'some-model',
      };

      expect(() => registry.createModel(options)).toThrow('Unknown provider: unknown-provider');
    });

    it('should throw error for invalid options', () => {
      // Mock adapter with invalid options
      const mockAdapter = {
        getConfig: () => ({
          id: 'invalid',
          name: 'Invalid',
          icon: '❌',
          requiresApiKey: true,
          defaultEndpoint: 'https://invalid.api',
          models: [],
          langchainClass: 'ChatInvalid',
          langchainModule: 'invalid',
          envKey: null,
        }),
        getModels: () => [],
        validateOptions: () => ({ valid: false, error: 'Invalid API key format' }),
        createModel: jest.fn(),
      };

      registry.register('invalid', mockAdapter as any);

      const options: CreateProviderOptions = {
        providerId: 'invalid',
        model: 'invalid-model',
        apiKey: 'invalid-key',
      };

      expect(() => registry.createModel(options)).toThrow('Invalid API key format');
    });
  });

  describe('createAndStore', () => {
    it('should create and store instance', async () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      };

      const instance = await registry.createAndStore('instance-1', options);
      expect(instance).toBeDefined();
      expect(instance.config).toBeDefined();
      expect(instance.llm).toBeDefined();
    });

    it('should throw error for unknown provider', async () => {
      const options: CreateProviderOptions = {
        providerId: 'unknown',
        model: 'model',
      };

      await expect(registry.createAndStore('instance-1', options)).rejects.toThrow('Unknown provider: unknown');
    });

    it('should retrieve stored instance', async () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      };

      await registry.createAndStore('test-instance', options);
      const retrieved = registry.getInstance('test-instance');
      expect(retrieved).toBeDefined();
    });

    it('should return undefined for non-existent instance', () => {
      const instance = registry.getInstance('non-existent');
      expect(instance).toBeUndefined();
    });
  });

  describe('removeInstance', () => {
    it('should remove stored instance', async () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      };

      await registry.createAndStore('to-remove', options);
      const removed = registry.removeInstance('to-remove');
      expect(removed).toBe(true);
      expect(registry.getInstance('to-remove')).toBeUndefined();
    });

    it('should return false for non-existent instance', () => {
      const removed = registry.removeInstance('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('should return success on successful connection', async () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      };

      const result = await registry.testConnection(options);
      expect(result.success).toBe(true);
      expect(result.latency).toBeDefined();
    });

    it('should return error on failed connection', async () => {
      // Override createModel to throw error
      const mockAdapter = {
        getConfig: () => ({
          id: 'fail',
          name: 'Fail',
          icon: '❌',
          requiresApiKey: true,
          defaultEndpoint: 'https://fail.api',
          models: [],
          langchainClass: 'ChatFail',
          langchainModule: 'fail',
          envKey: null,
        }),
        getModels: () => [],
        validateOptions: () => ({ valid: true }),
        createModel: jest.fn().mockImplementation(() => {
          throw new Error('Connection failed');
        }),
      };

      registry.register('fail', mockAdapter as any);

      const result = await registry.testConnection({
        providerId: 'fail',
        model: 'fail-model',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
    });
  });
});

describe('providerRegistry singleton', () => {
  it('should export a singleton instance', () => {
    expect(providerRegistry).toBeDefined();
    expect(providerRegistry).toBeInstanceOf(ProviderRegistry);
  });
});
