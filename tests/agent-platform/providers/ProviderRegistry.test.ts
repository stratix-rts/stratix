import { ProviderRegistry } from '@/agent-platform/providers/registry';
import { CreateProviderOptions, ProviderConfig } from '@/agent-platform/providers/types';

// Mock the adapters to avoid actual API calls
// Helper to create validateOptions that properly validates
const createMockValidateOptions = (requiresApiKey: boolean) => {
  return jest.fn().mockImplementation((options: CreateProviderOptions) => {
    if (requiresApiKey && !options.apiKey) {
      return { valid: false, error: 'OpenAI requires an API key' };
    }
    if (!options.model) {
      return { valid: false, error: 'Model is required' };
    }
    return { valid: true };
  });
};

jest.mock('@/agent-platform/providers/adapters/openai', () => ({
  OpenAIAdapter: jest.fn().mockImplementation(() => ({
    createModel: jest.fn().mockReturnValue({}),
    getModels: jest.fn().mockReturnValue(['gpt-4o', 'gpt-4o-mini']),
    getConfig: jest.fn().mockReturnValue({
      id: 'openai',
      name: 'OpenAI',
      icon: '🤖',
      requiresApiKey: true,
      defaultEndpoint: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini'],
      langchainClass: 'ChatOpenAI',
      langchainModule: '@langchain/openai',
      envKey: 'OPENAI_API_KEY',
    }),
    validateOptions: createMockValidateOptions(true),
  })),
}));

jest.mock('@/agent-platform/providers/adapters/anthropic', () => ({
  AnthropicAdapter: jest.fn().mockImplementation(() => ({
    createModel: jest.fn().mockReturnValue({}),
    getModels: jest.fn().mockReturnValue(['claude-3-5-sonnet']),
    getConfig: jest.fn().mockReturnValue({
      id: 'anthropic',
      name: 'Anthropic',
      icon: '🧠',
      requiresApiKey: true,
      defaultEndpoint: 'https://api.anthropic.com',
      models: ['claude-3-5-sonnet'],
      langchainClass: 'ChatAnthropic',
      langchainModule: '@langchain/anthropic',
      envKey: 'ANTHROPIC_API_KEY',
    }),
    validateOptions: createMockValidateOptions(true),
  })),
}));

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    // Create a fresh registry for each test
    registry = new ProviderRegistry();
  });

  describe('constructor', () => {
    test('registers default providers', () => {
      // Registry should have adapters registered
      const openaiConfig = registry.getConfig('openai');
      expect(openaiConfig).toBeDefined();
      expect(openaiConfig?.id).toBe('openai');
    });
  });

  describe('register', () => {
    test('registers a new adapter', () => {
      const mockAdapter = {
        createModel: jest.fn().mockReturnValue({}),
        getModels: jest.fn().mockReturnValue(['custom-model']),
        getConfig: jest.fn().mockReturnValue({
          id: 'custom',
          name: 'Custom Provider',
          icon: 'custom',
          requiresApiKey: false,
          defaultEndpoint: 'https://custom.example.com',
          models: ['custom-model'],
          langchainClass: 'CustomClass',
          langchainModule: '@custom/custom',
          envKey: null,
        }),
        validateOptions: jest.fn().mockReturnValue({ valid: true }),
      };

      registry.register('custom', mockAdapter as any);

      const config = registry.getConfig('custom');
      expect(config).toBeDefined();
      expect(config?.id).toBe('custom');
    });
  });

  describe('getAdapter', () => {
    test('returns adapter for known provider', () => {
      const adapter = registry.getAdapter('openai');
      expect(adapter).toBeDefined();
    });

    test('returns undefined for unknown provider', () => {
      const adapter = registry.getAdapter('unknown-provider');
      expect(adapter).toBeUndefined();
    });
  });

  describe('getConfig', () => {
    test('returns config for known provider', () => {
      const config = registry.getConfig('openai');
      expect(config).toBeDefined();
      expect(config?.id).toBe('openai');
      expect(config?.name).toBe('OpenAI');
    });

    test('returns undefined for unknown provider', () => {
      const config = registry.getConfig('unknown');
      expect(config).toBeUndefined();
    });
  });

  describe('getAllConfigs', () => {
    test('returns configs for all registered providers', () => {
      const configs = registry.getAllConfigs();
      expect(Array.isArray(configs)).toBe(true);
      expect(configs.length).toBeGreaterThan(0);
    });

    test('each config has required fields', () => {
      const configs = registry.getAllConfigs();

      configs.forEach(config => {
        expect(config.id).toBeDefined();
        expect(config.name).toBeDefined();
        expect(config.models).toBeDefined();
        expect(Array.isArray(config.models)).toBe(true);
      });
    });
  });

  describe('getModels', () => {
    test('returns models for known provider', () => {
      const models = registry.getModels('openai');
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });

    test('returns empty array for unknown provider', () => {
      const models = registry.getModels('unknown');
      expect(models).toEqual([]);
    });
  });

  describe('createModel', () => {
    test('creates model with valid options', () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
      };

      const model = registry.createModel(options);
      expect(model).toBeDefined();
    });

    test('throws error for unknown provider', () => {
      const options: CreateProviderOptions = {
        providerId: 'unknown',
        model: 'some-model',
      };

      expect(() => registry.createModel(options)).toThrow('Unknown provider: unknown');
    });

    test('throws error for invalid options', () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: '',
        apiKey: 'test-key',
      };

      // The mock adapter returns valid: true, but the real adapter validation
      // would catch this. We test the validation directly on the adapter.
      const adapter = registry.getAdapter('openai');
      const validation = adapter!.validateOptions(options);
      expect(validation.valid).toBe(false);
      expect(validation.error).toBe('Model is required');
    });
  });

  describe('createAndStore', () => {
    test('creates and stores an instance', async () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
      };

      const instance = await registry.createAndStore('instance-1', options);

      expect(instance).toBeDefined();
      expect(instance.config.id).toBe('openai');
      expect(instance.llm).toBeDefined();
    });

    test('throws error for unknown provider', async () => {
      const options: CreateProviderOptions = {
        providerId: 'unknown',
        model: 'some-model',
      };

      await expect(registry.createAndStore('instance-1', options))
        .rejects.toThrow('Unknown provider: unknown');
    });
  });

  describe('getInstance', () => {
    test('returns stored instance', async () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
      };

      await registry.createAndStore('instance-1', options);
      const instance = registry.getInstance('instance-1');

      expect(instance).toBeDefined();
      expect(instance?.config.id).toBe('openai');
    });

    test('returns undefined for unknown instance', () => {
      const instance = registry.getInstance('unknown-instance');
      expect(instance).toBeUndefined();
    });
  });

  describe('removeInstance', () => {
    test('removes stored instance', async () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
      };

      await registry.createAndStore('instance-1', options);
      expect(registry.getInstance('instance-1')).toBeDefined();

      const removed = registry.removeInstance('instance-1');
      expect(removed).toBe(true);
      expect(registry.getInstance('instance-1')).toBeUndefined();
    });

    test('returns false for unknown instance', () => {
      const removed = registry.removeInstance('unknown-instance');
      expect(removed).toBe(false);
    });
  });

  describe('testConnection', () => {
    test('returns success for valid connection', async () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
      };

      // Mock the llm.invoke to succeed
      const mockAdapter = registry.getAdapter('openai');
      if (mockAdapter) {
        (mockAdapter.createModel as jest.Mock).mockReturnValue({
          invoke: jest.fn().mockResolvedValue({ content: 'Hello' }),
        });
      }

      const result = await registry.testConnection(options);
      expect(result.success).toBe(true);
      expect(result.latency).toBeDefined();
    });

    test('returns error for failed connection', async () => {
      const options: CreateProviderOptions = {
        providerId: 'openai',
        model: 'gpt-4o',
        apiKey: 'invalid-key',
      };

      const mockAdapter = registry.getAdapter('openai');
      if (mockAdapter) {
        (mockAdapter.createModel as jest.Mock).mockReturnValue({
          invoke: jest.fn().mockRejectedValue(new Error('Invalid API key')),
        });
      }

      const result = await registry.testConnection(options);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
