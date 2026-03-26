import { LLMAdapter } from '@/agent-platform/providers/adapters/base';
import { CreateProviderOptions, ProviderConfig } from '@/agent-platform/providers/types';

// Concrete implementation for testing
class TestAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions) {
    return {} as any;
  }

  getModels(): string[] {
    return ['model-a', 'model-b'];
  }

  getConfig(): ProviderConfig {
    return {
      id: 'test',
      name: 'Test Provider',
      icon: 'test-icon',
      requiresApiKey: true,
      defaultEndpoint: 'https://test.example.com',
      models: ['model-a', 'model-b'],
      langchainClass: 'TestClass',
      langchainModule: '@test/test',
      envKey: 'TEST_API_KEY',
    };
  }
}

class NoApiKeyAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions) {
    return {} as any;
  }

  getModels(): string[] {
    return ['free-model'];
  }

  getConfig(): ProviderConfig {
    return {
      id: 'free',
      name: 'Free Provider',
      icon: 'free-icon',
      requiresApiKey: false,
      defaultEndpoint: 'https://free.example.com',
      models: ['free-model'],
      langchainClass: 'FreeClass',
      langchainModule: '@test/free',
      envKey: null,
    };
  }
}

describe('LLMAdapter', () => {
  let adapter: TestAdapter;
  let noApiKeyAdapter: NoApiKeyAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
    noApiKeyAdapter = new NoApiKeyAdapter();
  });

  describe('validateOptions', () => {
    test('returns valid when all required options are provided', () => {
      const options: CreateProviderOptions = {
        providerId: 'test',
        model: 'model-a',
        apiKey: 'test-key',
      };

      const result = adapter.validateOptions(options);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('returns invalid when API key is required but not provided', () => {
      const options: CreateProviderOptions = {
        providerId: 'test',
        model: 'model-a',
      };

      const result = adapter.validateOptions(options);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires an API key');
    });

    test('returns invalid when model is not provided', () => {
      const options: CreateProviderOptions = {
        providerId: 'test',
        model: '',
        apiKey: 'test-key',
      };

      const result = adapter.validateOptions(options);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Model is required');
    });

    test('returns valid when API key is not required', () => {
      const options: CreateProviderOptions = {
        providerId: 'free',
        model: 'free-model',
      };

      const result = noApiKeyAdapter.validateOptions(options);

      expect(result.valid).toBe(true);
    });

    test('allows optional fields to be missing', () => {
      const options: CreateProviderOptions = {
        providerId: 'test',
        model: 'model-a',
        apiKey: 'test-key',
        temperature: 0.5,
        maxTokens: 1000,
      };

      const result = adapter.validateOptions(options);

      expect(result.valid).toBe(true);
    });
  });

  describe('getModels', () => {
    test('returns list of available models', () => {
      const models = adapter.getModels();

      expect(models).toEqual(['model-a', 'model-b']);
    });
  });

  describe('getConfig', () => {
    test('returns provider configuration', () => {
      const config = adapter.getConfig();

      expect(config.id).toBe('test');
      expect(config.name).toBe('Test Provider');
      expect(config.requiresApiKey).toBe(true);
      expect(config.models).toHaveLength(2);
    });
  });
});
